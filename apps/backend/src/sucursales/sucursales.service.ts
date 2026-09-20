import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { RolUsuario } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";

/** Quién puede renombrar una sucursal. No incluye SUPERVISOR: cambiar el nombre afecta a todo
 *  lo que el ERP muestra de esa sucursal, es una decisión de administración, no de turno. */
const ROLES_RENOMBRAN = [RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO];

@Injectable()
export class SucursalesService {
  constructor(private prisma: PrismaService, private auth: AuthService) {}

  listar(empresaId: string) {
    return this.prisma.sucursal.findMany({ where: { empresaId, activo: true }, orderBy: { nombre: "asc" } });
  }

  obtener(id: string) {
    return this.prisma.sucursal.findUniqueOrThrow({
      where: { id },
      include: { areas: true, cajas: true, dispositivos: true },
    });
  }

  /**
   * Sucursales con las que este usuario puede trabajar AHORA, calculado en vivo.
   *
   * Es la única fuente de verdad del selector del ERP. Antes el selector se armaba con la lista
   * que venía en la respuesta del login y quedaba congelada en localStorage: una sucursal dada
   * de alta después no aparecía hasta cerrar y volver a abrir sesión.
   *
   * ADMIN_CORPORATIVO ve todas las de su empresa (SucursalAccessGuard lo exime, así que puede
   * consultarlas todas de verdad). El resto ve solo sus filas de UsuarioSucursal: ofrecerle una
   * sucursal a la que el backend le respondería 403 sería peor que no ofrecerla.
   */
  async listarParaUsuario(usuario: { sub: string; empresaId: string; rol?: string }) {
    if (usuario.rol === RolUsuario.ADMIN_CORPORATIVO) {
      const todas = await this.prisma.sucursal.findMany({
        where: { empresaId: usuario.empresaId, activo: true },
        orderBy: { nombre: "asc" },
        select: { id: true, nombre: true },
      });
      return todas.map((s) => ({ sucursalId: s.id, nombre: s.nombre, rol: RolUsuario.ADMIN_CORPORATIVO }));
    }

    const accesos = await this.prisma.usuarioSucursal.findMany({
      where: { usuarioId: usuario.sub, activo: true, sucursal: { activo: true, empresaId: usuario.empresaId } },
      include: { sucursal: { select: { nombre: true } } },
      orderBy: { sucursal: { nombre: "asc" } },
    });
    return accesos.map((a) => ({ sucursalId: a.sucursalId, nombre: a.sucursal.nombre, rol: a.rol }));
  }

  /**
   * Alta de sucursal.
   *
   * Le da acceso a quien la crea en la misma transacción. Sin esto, la sucursal nacía sin
   * ningún UsuarioSucursal: no aparecía en el selector de nadie y `POST /auth/switch-sucursal`
   * la rechazaba con "Sin acceso a esa sucursal" incluso para el administrador corporativo que
   * acababa de darla de alta.
   */
  crear(
    data: {
      empresaId: string;
      nombre: string;
      direccion?: string;
      horarioApertura?: string;
      horarioCierre?: string;
      timezone?: string;
      moneda?: string;
      tasaImpuesto?: number;
    },
    creadorId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const sucursal = await tx.sucursal.create({ data });
      if (creadorId) {
        await tx.usuarioSucursal.create({
          data: { usuarioId: creadorId, sucursalId: sucursal.id, rol: RolUsuario.ADMIN_CORPORATIVO },
        });
      }
      return sucursal;
    });
  }

  actualizar(id: string, data: Partial<{ nombre: string; direccion: string; horarioApertura: string; horarioCierre: string; tasaImpuesto: number; activo: boolean }>) {
    return this.prisma.sucursal.update({ where: { id }, data });
  }

  /**
   * Renombra una sucursal desde una terminal (APK / POS de sucursal).
   *
   * Existe aparte de `actualizar()` porque la sesión de una terminal es un usuario-terminal con
   * rol CAJERO (ver VinculacionService), que RolesGuard no deja pasar por `PUT /sucursales/:id`.
   * Aquí lo que autoriza no es el rol de la sesión sino la contraseña de un administrador, igual
   * que hace el POS Windows para cancelar una cuenta o aplicar un descuento.
   *
   * Es un cambio online por naturaleza —el nombre vive en el ERP— así que aquí sí se puede
   * exigir contraseña real, a diferencia de la cancelación de un ticket, que debe funcionar sin
   * red y por eso se autoriza con el PIN local.
   *
   * SucursalAccessGuard ya garantiza que una terminal solo pueda renombrar SU sucursal: el
   * parámetro se llama `sucursalId` precisamente para que lo compare contra el token.
   */
  async renombrarDesdeTerminal(
    sucursalId: string,
    datos: { nombre: string; autorizadoPorId: string; password: string },
  ) {
    const nombre = datos.nombre?.trim();
    if (!nombre) throw new BadRequestException("El nombre no puede quedar vacío");
    if (nombre.length > 80) throw new BadRequestException("El nombre es demasiado largo (máximo 80 caracteres)");

    const sucursal = await this.prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });
    await this.auth.verificarAutorizacion(datos.autorizadoPorId, datos.password, sucursalId, ROLES_RENOMBRAN);

    const actualizada = await this.prisma.sucursal.update({ where: { id: sucursalId }, data: { nombre } });

    await this.prisma.auditLog.create({
      data: {
        empresaId: sucursal.empresaId,
        sucursalId,
        entidad: "SUCURSAL",
        entidadId: sucursalId,
        accion: "RENOMBRAR_DESDE_TERMINAL",
        usuarioId: datos.autorizadoPorId,
        datosAnteriores: { nombre: sucursal.nombre },
        datosNuevos: { nombre },
      },
    });

    return actualizada;
  }

  // Config del ticket (plantilla de impresión: encabezado/pie, fuentes, ancho de papel, logo —
  // ver AdminTicket.tsx) vive dentro de configJson bajo la clave "ticket" en vez de columnas
  // propias: son ~20 campos de estilo que no se consultan por separado, solo se leen/escriben
  // como un bloque completo. Se mergea sobre el configJson existente para no perder otras claves
  // que ya pudiera tener (ej. a futuro).
  async actualizarConfigTicket(sucursalId: string, configTicket: unknown) {
    const sucursal = await this.prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });
    const configJson = { ...((sucursal.configJson as Record<string, unknown>) ?? {}), ticket: configTicket };
    return this.prisma.sucursal.update({ where: { id: sucursalId }, data: { configJson: configJson as Prisma.InputJsonValue } });
  }

  // --- Áreas ---
  crearArea(sucursalId: string, data: { nombre: string; tipo: string; descripcion?: string }) {
    return this.prisma.area.create({ data: { sucursalId, nombre: data.nombre, tipo: data.tipo as any, descripcion: data.descripcion } });
  }

  listarAreas(sucursalId: string) {
    return this.prisma.area.findMany({ where: { sucursalId, activo: true } });
  }

  // --- Dispositivos ---
  registrarDispositivo(data: { sucursalId: string; areaId?: string; nombre: string; tipo: string; identificador: string }) {
    return this.prisma.dispositivo.upsert({
      where: { identificador: data.identificador },
      update: { nombre: data.nombre, sucursalId: data.sucursalId, areaId: data.areaId, ultimaConexion: new Date(), activo: true },
      create: { ...data, tipo: data.tipo as any, ultimaConexion: new Date() },
    });
  }

  listarDispositivos(sucursalId: string) {
    return this.prisma.dispositivo.findMany({ where: { sucursalId, activo: true } });
  }

  // --- Cajas ---
  crearCaja(sucursalId: string, nombre: string) {
    return this.prisma.caja.create({ data: { sucursalId, nombre } });
  }

  listarCajas(sucursalId: string) {
    return this.prisma.caja.findMany({ where: { sucursalId, activo: true } });
  }
}
