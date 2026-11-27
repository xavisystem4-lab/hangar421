import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { calcularCompra, seccionDeInsumo, TipoMovimientoInventario, type CompraRegistro } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { InventarioService } from "./inventario.service";
import { limiteDelDia } from "../pedidos/ventas-consulta";

/**
 * Compras de insumos con su costo real (ERP → 🛒 Compras y costos).
 *
 * Registrar una compra hace tres cosas en una sola operación lógica:
 *  1. Guarda la compra como registro histórico propio (cantidad, unidad, precio, total, proveedor,
 *     fecha y quién la capturó). Nunca se sobrescribe una compra anterior.
 *  2. Mete la mercancía al inventario con un movimiento ENTRADA ligado a la compra (motivo
 *     "Compra…", referenciaId = id de la compra), distinto de las entradas/ajustes manuales.
 *  3. Actualiza el costo vigente del insumo al de esta compra (el que usan recetas y valuación).
 *
 * Corregir una compra = anularla (queda quién, cuándo y por qué, y una SALIDA que regresa la
 * existencia) y capturar la correcta. Reenviar la misma compra (doble clic, reintento) no la
 * duplica gracias a `idempotencyKey`.
 */

export interface DatosCompra {
  sucursalId: string;
  insumoId: string;
  proveedorId?: string | null;
  /** ISO; vacío = ahora. */
  fechaCompra?: string | null;
  unidadCaptura?: string | null;
  cantidadCaptura: number;
  factor?: number | null;
  precioCaptura?: number | null;
  total?: number | null;
  notas?: string | null;
  idempotencyKey?: string | null;
}

export interface FiltroCompras {
  sucursalId?: string;
  desde?: string;
  hasta?: string;
  insumoId?: string;
  proveedorId?: string;
  usuarioId?: string;
  categoria?: string;
  incluirAnuladas?: boolean;
}

const ZONA_POR_OMISION = "America/Mexico_City";

@Injectable()
export class ComprasService {
  constructor(private prisma: PrismaService, private inventario: InventarioService) {}

  private async nombreUsuario(usuarioId: string): Promise<string | null> {
    const u = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nombre: true } });
    return u?.nombre ?? null;
  }

  async registrar(empresaId: string, usuarioId: string, datos: DatosCompra) {
    if (datos.idempotencyKey) {
      const previa = await this.prisma.compraInsumo.findUnique({ where: { idempotencyKey: datos.idempotencyKey } });
      if (previa) return this.aRegistro(previa.id);
    }

    const [insumo, sucursal] = await Promise.all([
      this.prisma.insumo.findUnique({ where: { id: datos.insumoId } }),
      this.prisma.sucursal.findUnique({ where: { id: datos.sucursalId }, select: { id: true, empresaId: true } }),
    ]);
    if (!insumo || insumo.empresaId !== empresaId) throw new NotFoundException("El insumo no existe.");
    if (!sucursal || sucursal.empresaId !== empresaId) throw new NotFoundException("La sucursal no existe.");
    if (insumo.esPreparacion) throw new BadRequestException("Una preparación de la casa no se compra: compra sus ingredientes.");
    if (datos.proveedorId) {
      const prov = await this.prisma.proveedor.findUnique({ where: { id: datos.proveedorId }, select: { empresaId: true } });
      if (!prov || prov.empresaId !== empresaId) throw new NotFoundException("El proveedor no existe.");
    }

    const factor = Number(datos.factor ?? 1) || 1;
    let calc;
    try {
      calc = calcularCompra({ cantidadCaptura: Number(datos.cantidadCaptura), factor, precioCaptura: datos.precioCaptura, total: datos.total });
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
    const fecha = datos.fechaCompra ? new Date(datos.fechaCompra) : new Date();
    if (Number.isNaN(fecha.getTime())) throw new BadRequestException("Fecha de compra inválida.");
    if (fecha.getTime() > Date.now() + 36 * 3_600_000) throw new BadRequestException("La fecha de compra no puede ser futura.");

    const proveedorNombre = datos.proveedorId
      ? (await this.prisma.proveedor.findUnique({ where: { id: datos.proveedorId }, select: { nombre: true } }))?.nombre
      : null;
    const usuarioNombre = await this.nombreUsuario(usuarioId);
    const unidadCaptura = datos.unidadCaptura?.trim() || insumo.unidadMedida;

    // La compra se crea primero (su id va en el movimiento) y, si algo falla después, se borra:
    // así nunca queda una entrada de inventario "Compra" sin su compra ni al revés.
    const compra = await this.prisma.compraInsumo.create({
      data: {
        empresaId,
        sucursalId: datos.sucursalId,
        insumoId: datos.insumoId,
        proveedorId: datos.proveedorId || null,
        fechaCompra: fecha,
        unidadCaptura,
        cantidadCaptura: Number(datos.cantidadCaptura),
        factor,
        precioCaptura: calc.precioCaptura,
        cantidadBase: calc.cantidadBase,
        costoUnitario: calc.costoUnitarioBase,
        total: calc.total,
        notas: datos.notas?.trim() || null,
        usuarioId,
        usuarioNombre,
        idempotencyKey: datos.idempotencyKey || null,
      },
    }).catch(async (e: any) => {
      // Dos envíos simultáneos con la misma llave: gana el primero.
      if (e?.code === "P2002" && datos.idempotencyKey) {
        const previa = await this.prisma.compraInsumo.findUnique({ where: { idempotencyKey: datos.idempotencyKey } });
        if (previa) return null;
      }
      throw e;
    });
    if (!compra) return this.aRegistro((await this.prisma.compraInsumo.findUnique({ where: { idempotencyKey: datos.idempotencyKey! } }))!.id);

    try {
      const motivo = `Compra${proveedorNombre ? ` · ${proveedorNombre}` : ""} · ${Number(datos.cantidadCaptura)} ${unidadCaptura} · $${calc.total.toFixed(2)}`;
      const movimiento = await this.inventario.registrarMovimiento({
        sucursalId: datos.sucursalId,
        insumoId: datos.insumoId,
        tipo: TipoMovimientoInventario.ENTRADA,
        cantidad: calc.cantidadBase,
        motivo,
        usuarioId,
        idempotencyKey: `compra:${compra.id}`,
      });
      await this.prisma.movimientoInventario.update({ where: { id: movimiento.id }, data: { referenciaId: compra.id } });
      await this.prisma.compraInsumo.update({ where: { id: compra.id }, data: { movimientoId: movimiento.id } });
      await this.actualizarCostoVigente(datos.insumoId);
    } catch (e) {
      await this.prisma.compraInsumo.delete({ where: { id: compra.id } }).catch(() => undefined);
      throw e;
    }
    return this.aRegistro(compra.id);
  }

  /** El costo vigente del insumo = el de su compra vigente más reciente (por fecha de compra). */
  private async actualizarCostoVigente(insumoId: string) {
    const ultima = await this.prisma.compraInsumo.findFirst({
      where: { insumoId, estado: "VIGENTE" },
      orderBy: [{ fechaCompra: "desc" }, { createdAt: "desc" }],
      select: { costoUnitario: true },
    });
    if (ultima) await this.prisma.insumo.update({ where: { id: insumoId }, data: { costoUnitario: Number(ultima.costoUnitario) } });
  }

  async anular(empresaId: string, usuarioId: string, id: string, motivo: string) {
    if (!motivo?.trim()) throw new BadRequestException("Escribe el motivo de la anulación.");
    const compra = await this.prisma.compraInsumo.findUnique({ where: { id } });
    if (!compra || compra.empresaId !== empresaId) throw new NotFoundException("La compra no existe.");
    if (compra.estado === "ANULADA") throw new ConflictException("Esa compra ya estaba anulada.");

    const usuarioNombre = await this.nombreUsuario(usuarioId);
    const movimiento = await this.inventario.registrarMovimiento({
      sucursalId: compra.sucursalId,
      insumoId: compra.insumoId,
      tipo: TipoMovimientoInventario.SALIDA,
      cantidad: Number(compra.cantidadBase),
      motivo: `Anulación de compra · ${motivo.trim()}`,
      usuarioId,
      idempotencyKey: `compra-anulada:${compra.id}`,
    });
    await this.prisma.movimientoInventario.update({ where: { id: movimiento.id }, data: { referenciaId: compra.id } });
    const marcada = await this.prisma.compraInsumo.updateMany({
      where: { id, estado: "VIGENTE" },
      data: { estado: "ANULADA", anuladaAt: new Date(), anuladaPorId: usuarioId, anuladaPorNombre: usuarioNombre, motivoAnulacion: motivo.trim(), movimientoAnulacionId: movimiento.id },
    });
    if (marcada.count === 0) throw new ConflictException("Esa compra ya estaba anulada.");
    await this.actualizarCostoVigente(compra.insumoId);
    return this.aRegistro(id);
  }

  private async zona(empresaId: string, sucursalId?: string): Promise<string> {
    const s = sucursalId
      ? await this.prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { timezone: true } })
      : await this.prisma.sucursal.findFirst({ where: { empresaId, activo: true }, select: { timezone: true } });
    return s?.timezone ?? ZONA_POR_OMISION;
  }

  async listar(empresaId: string, f: FiltroCompras) {
    const zona = await this.zona(empresaId, f.sucursalId);
    const fecha: Record<string, Date> = {};
    if (f.desde) fecha.gte = limiteDelDia(f.desde, zona, "inicio");
    if (f.hasta) fecha.lte = limiteDelDia(f.hasta, zona, "fin");
    const filas = await this.prisma.compraInsumo.findMany({
      where: {
        empresaId,
        ...(f.sucursalId ? { sucursalId: f.sucursalId } : {}),
        ...(f.insumoId ? { insumoId: f.insumoId } : {}),
        ...(f.proveedorId === "SIN" ? { proveedorId: null } : f.proveedorId ? { proveedorId: f.proveedorId } : {}),
        ...(f.usuarioId ? { usuarioId: f.usuarioId } : {}),
        ...(f.incluirAnuladas ? {} : { estado: "VIGENTE" as const }),
        ...(Object.keys(fecha).length ? { fechaCompra: fecha } : {}),
      },
      include: { insumo: { select: { nombre: true, unidadMedida: true, esPreparacion: true } }, proveedor: { select: { nombre: true } }, sucursal: { select: { nombre: true } } },
      orderBy: [{ fechaCompra: "desc" }, { createdAt: "desc" }],
      take: 5000,
    });
    const items = filas.map((c) => this.mapear(c)).filter((c) => !f.categoria || c.categoria === f.categoria);
    return { zona, items };
  }

  private mapear(c: any): CompraRegistro & { notas: string | null; anuladaAt: string | null; anuladaPor: string | null; motivoAnulacion: string | null; createdAt: string; usuarioId: string | null; proveedorId: string | null; sucursalId: string } {
    return {
      id: c.id,
      fechaCompra: c.fechaCompra.toISOString(),
      insumoId: c.insumoId,
      insumo: c.insumo.nombre,
      categoria: seccionDeInsumo(c.insumo),
      unidadBase: c.insumo.unidadMedida,
      cantidadBase: Number(c.cantidadBase),
      costoUnitarioBase: Number(c.costoUnitario),
      unidadCaptura: c.unidadCaptura,
      cantidadCaptura: Number(c.cantidadCaptura),
      precioCaptura: Number(c.precioCaptura),
      factor: Number(c.factor),
      total: Number(c.total),
      proveedor: c.proveedor?.nombre ?? null,
      proveedorId: c.proveedorId ?? null,
      usuario: c.usuarioNombre ?? null,
      usuarioId: c.usuarioId ?? null,
      sucursal: c.sucursal?.nombre ?? null,
      sucursalId: c.sucursalId,
      estado: c.estado,
      notas: c.notas ?? null,
      anuladaAt: c.anuladaAt ? c.anuladaAt.toISOString() : null,
      anuladaPor: c.anuladaPorNombre ?? null,
      motivoAnulacion: c.motivoAnulacion ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private async aRegistro(id: string) {
    const c = await this.prisma.compraInsumo.findUnique({
      where: { id },
      include: { insumo: { select: { nombre: true, unidadMedida: true, esPreparacion: true } }, proveedor: { select: { nombre: true } }, sucursal: { select: { nombre: true } } },
    });
    if (!c) throw new NotFoundException("La compra no existe.");
    return this.mapear(c);
  }
}
