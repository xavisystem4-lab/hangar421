import { JwtPayload, RolUsuario, SyncEntidad, SyncEnvelope, SyncOperacion } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Comprueba que una operación de `/sync/push` solo toque datos de la empresa y de una sucursal a
 * la que la sesión tiene acceso.
 *
 * Existe porque el push confiaba en lo que decía el cuerpo: `empresaId` salía del payload y
 * `sucursalId` del sobre, y ninguno se comparaba con el token. `SucursalAccessGuard` no lo
 * cubría porque solo mira `body.sucursalId`, y aquí la sucursal va anidada en `items[]`.
 * Cualquier sesión válida podía escribir pedidos, cobros o cortes en otra sucursal u otra
 * empresa, o cobrar un pedido ajeno nombrando su id.
 *
 * La sucursal del item NO se compara con la sucursal activa del token sino con las sucursales a
 * las que el usuario tiene acceso: la cola offline puede drenar ventas hechas en una sucursal
 * después de que la sesión cambió a otra, y esas ventas son legítimas.
 *
 * Una referencia a algo que todavía no existe en el ERP no se rechaza aquí: la operación fallará
 * por su cuenta con su propio mensaje (o es un usuario dado de alta sin conexión, que se resuelve
 * aparte). Solo se rechaza lo que existe y pertenece a otro.
 */
export class AlcanceSync {
  private readonly sucursales = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sesion: JwtPayload,
  ) {}

  get empresaId(): string {
    return this.sesion.empresaId;
  }

  /** null si el item está dentro del alcance de la sesión; si no, el motivo del rechazo. */
  async motivoDeRechazo(item: SyncEnvelope): Promise<string | null> {
    if (!item.sucursalId) return "La operación no indica sucursal";
    if (!(await this.sucursalAccesible(item.sucursalId))) return "No tienes acceso a esta sucursal";

    const p = (item.payload ?? {}) as any;
    const ajena = await this.referenciaAjena(item, p);
    if (ajena) return ajena;

    for (const usuarioId of [item.usuarioId, p.meseroId, p.cajeroId, p.usuarioId, p.autorizadoPorId, p.nuevoUsuarioId, p.solicitadoPorId]) {
      if (usuarioId && !(await this.usuarioDeLaEmpresa(usuarioId))) return "El usuario indicado pertenece a otra empresa";
    }
    return null;
  }

  private async sucursalAccesible(sucursalId: string): Promise<boolean> {
    const cacheado = this.sucursales.get(sucursalId);
    if (cacheado !== undefined) return cacheado;

    const sucursal = await this.prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { empresaId: true } });
    let accesible = !!sucursal && sucursal.empresaId === this.sesion.empresaId;
    if (accesible && this.sesion.rol !== RolUsuario.ADMIN_CORPORATIVO) {
      const acceso = await this.prisma.usuarioSucursal.findFirst({
        where: { usuarioId: this.sesion.sub, sucursalId, activo: true },
        select: { id: true },
      });
      accesible = !!acceso;
    }
    this.sucursales.set(sucursalId, accesible);
    return accesible;
  }

  private async referenciaAjena(item: SyncEnvelope, p: any): Promise<string | null> {
    const suc = item.sucursalId;
    switch (item.entidad) {
      case SyncEntidad.PEDIDO:
        if (await this.deOtraSucursal("pedido", item.operacion === SyncOperacion.CREATE ? item.id : (p.pedidoId ?? item.id), suc)) {
          return "El pedido pertenece a otra sucursal";
        }
        if (p.mesaId && (await this.deOtraSucursal("mesa", p.mesaId, suc))) return "La mesa pertenece a otra sucursal";
        if (p.turnoId && (await this.deOtraSucursal("turno", p.turnoId, suc))) return "El turno pertenece a otra sucursal";
        return null;
      case SyncEntidad.PEDIDO_ITEM:
      case SyncEntidad.PAGO:
      case SyncEntidad.DESCUENTO:
        return (await this.deOtraSucursal("pedido", p.pedidoId, suc)) ? "El pedido pertenece a otra sucursal" : null;
      case SyncEntidad.MESA:
        return (await this.deOtraSucursal("mesa", item.id, suc)) ? "La mesa pertenece a otra sucursal" : null;
      case SyncEntidad.TURNO:
        if (p.cajaId && (await this.deOtraSucursal("caja", p.cajaId, suc))) return "La caja pertenece a otra sucursal";
        return (await this.deOtraSucursal("turno", p.turnoId ?? item.id, suc)) ? "El turno pertenece a otra sucursal" : null;
      case SyncEntidad.MOVIMIENTO_CAJA:
        return (await this.deOtraSucursal("turno", p.turnoId, suc)) ? "El turno pertenece a otra sucursal" : null;
      case SyncEntidad.MOVIMIENTO_INVENTARIO:
        return (await this.deOtraEmpresa("insumo", p.insumoId)) ? "El insumo pertenece a otra empresa" : null;
      case SyncEntidad.PRODUCTO_SUCURSAL:
        return (await this.deOtraEmpresa("producto", p.productoId)) ? "El producto pertenece a otra empresa" : null;
      case SyncEntidad.VENTA_HUB:
        return (await this.deOtraSucursal("pedido", item.id, suc)) ? "La venta pertenece a otra sucursal" : null;
      case SyncEntidad.SOLICITUD_PRODUCTO:
        return (await this.deOtraSucursal("solicitudProducto", item.id, suc)) ? "La solicitud pertenece a otra sucursal" : null;
      case SyncEntidad.USUARIO:
        return (await this.usuarioDeLaEmpresa(item.id)) ? null : "El usuario indicado pertenece a otra empresa";
      default:
        return null;
    }
  }

  /** true solo si la fila EXISTE y es de otra sucursal. */
  private async deOtraSucursal(modelo: "pedido" | "mesa" | "turno" | "caja" | "solicitudProducto", id: string | undefined, sucursalId: string): Promise<boolean> {
    if (!id) return false;
    const fila = await (this.prisma[modelo] as any).findUnique({ where: { id }, select: { sucursalId: true } });
    return !!fila && fila.sucursalId !== sucursalId;
  }

  private async deOtraEmpresa(modelo: "insumo" | "producto", id: string | undefined): Promise<boolean> {
    if (!id) return false;
    const fila = await (this.prisma[modelo] as any).findUnique({ where: { id }, select: { empresaId: true } });
    return !!fila && fila.empresaId !== this.sesion.empresaId;
  }

  private async usuarioDeLaEmpresa(usuarioId: string): Promise<boolean> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { empresaId: true } });
    return !usuario || usuario.empresaId === this.sesion.empresaId;
  }
}
