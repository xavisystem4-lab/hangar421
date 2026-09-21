import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { EstadoSolicitudProducto, RolUsuario } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { resolverDispositivoId } from "../common/dispositivo.util";

/** Largo máximo del texto capturado: es lo que alguien tecleó en un buscador, no una ficha. */
const LARGO_MAXIMO = 120;

export interface NuevaSolicitudProducto {
  id: string;
  empresaId: string;
  sucursalId: string;
  usuarioId?: string | null;
  /** Huella de instalación del equipo (la misma que manda con las ventas). */
  dispositivoHuella?: string | null;
  texto: string;
  solicitadaEn?: Date;
}

/**
 * Solicitudes de alta de productos que no existen en el catálogo.
 *
 * Regla del negocio: un producto que no está en el catálogo NUNCA se da de alta solo ni se vende
 * como "artículo pendiente" — la venta se detiene y queda esta solicitud para que un
 * administrador lo registre a mano. Aquí solo se guarda y se resuelve la solicitud; el alta del
 * producto sigue siendo la de Catálogo.
 */
@Injectable()
export class SolicitudesProductoService {
  constructor(private prisma: PrismaService) {}

  /** Idempotente por `id` (se genera en el cliente y puede reenviarse por la cola offline).
   *  Empresa y sucursal ya vienen validadas contra la sesión por quien llama. */
  async crear(datos: NuevaSolicitudProducto) {
    const texto = normalizarTexto(datos.texto);
    if (!texto) throw new BadRequestException("Escribe el nombre o la descripción del producto");

    const existente = await this.prisma.solicitudProducto.findUnique({ where: { id: datos.id } });
    if (existente) {
      if (existente.sucursalId !== datos.sucursalId) throw new ConflictException("Ya existe una solicitud con ese id en otra sucursal");
      return existente;
    }

    // Quien la pidió puede no existir todavía en el ERP (usuario dado de alta en la tablet cuya
    // alta aún no llega): se guarda sin atribución antes que perder la solicitud.
    const usuario = datos.usuarioId
      ? await this.prisma.usuario.findUnique({ where: { id: datos.usuarioId }, select: { id: true } })
      : null;
    const dispositivoId = await resolverDispositivoId(this.prisma, datos.dispositivoHuella, datos.sucursalId);

    return this.prisma.solicitudProducto.create({
      data: {
        id: datos.id,
        empresaId: datos.empresaId,
        sucursalId: datos.sucursalId,
        usuarioId: usuario?.id ?? null,
        dispositivoId: dispositivoId ?? null,
        texto,
        solicitadaEn: datos.solicitadaEn && !Number.isNaN(datos.solicitadaEn.getTime()) ? datos.solicitadaEn : new Date(),
      },
    });
  }

  async listar(empresaId: string, filtro: { sucursalId?: string; estado?: EstadoSolicitudProducto }) {
    return this.prisma.solicitudProducto.findMany({
      where: {
        empresaId,
        ...(filtro.sucursalId ? { sucursalId: filtro.sucursalId } : {}),
        ...(filtro.estado ? { estado: filtro.estado } : {}),
      },
      include: {
        sucursal: { select: { id: true, nombre: true } },
        usuario: { select: { id: true, nombre: true } },
        dispositivo: { select: { id: true, nombre: true, tipo: true } },
        resueltaPor: { select: { id: true, nombre: true } },
        producto: { select: { id: true, nombre: true } },
      },
      orderBy: { solicitadaEn: "desc" },
      take: 300,
    });
  }

  /** Cuántas quedan pendientes: el número del menú del ERP. */
  async contarPendientes(empresaId: string, sucursalId?: string): Promise<{ pendientes: number }> {
    const pendientes = await this.prisma.solicitudProducto.count({
      where: { empresaId, estado: EstadoSolicitudProducto.PENDIENTE, ...(sucursalId ? { sucursalId } : {}) },
    });
    return { pendientes };
  }

  /** Marca la solicitud como atendida (opcionalmente con el producto con que se resolvió) o
   *  descartada. Un admin de sucursal solo resuelve las de su sucursal. */
  async resolver(
    id: string,
    sesion: { sub: string; empresaId: string; sucursalId?: string; rol?: string },
    datos: { estado: EstadoSolicitudProducto; productoId?: string; nota?: string },
  ) {
    if (datos.estado !== EstadoSolicitudProducto.ATENDIDA && datos.estado !== EstadoSolicitudProducto.DESCARTADA) {
      throw new BadRequestException("Estado inválido: solo ATENDIDA o DESCARTADA");
    }
    const solicitud = await this.prisma.solicitudProducto.findUnique({ where: { id } });
    if (!solicitud || solicitud.empresaId !== sesion.empresaId) throw new NotFoundException("Solicitud no encontrada");
    if (sesion.rol !== RolUsuario.ADMIN_CORPORATIVO && solicitud.sucursalId !== sesion.sucursalId) {
      throw new ForbiddenException("No tienes acceso a esta sucursal");
    }
    if (datos.productoId) {
      const producto = await this.prisma.producto.findUnique({ where: { id: datos.productoId }, select: { empresaId: true } });
      if (!producto || producto.empresaId !== sesion.empresaId) throw new BadRequestException("El producto no existe en tu catálogo");
    }

    return this.prisma.solicitudProducto.update({
      where: { id },
      data: {
        estado: datos.estado,
        resueltaEn: new Date(),
        resueltaPorId: sesion.sub,
        productoId: datos.productoId ?? null,
        notaResolucion: datos.nota?.trim().slice(0, 500) || null,
      },
    });
  }
}

/** Recorta espacios repetidos y el largo; lo demás se conserva tal cual se tecleó. */
export function normalizarTexto(texto: unknown): string {
  if (typeof texto !== "string") return "";
  return texto.replace(/\s+/g, " ").trim().slice(0, LARGO_MAXIMO);
}
