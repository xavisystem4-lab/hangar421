import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CatalogoService {
  constructor(private prisma: PrismaService) {}

  async listarCategorias(empresaId: string) {
    return this.prisma.categoriaProducto.findMany({
      where: { empresaId, activo: true },
      orderBy: { orden: "asc" },
    });
  }

  /** Catálogo resuelto para una sucursal: precio/disponibilidad de ProductoSucursal si existe,
   *  si no, el precio base del producto (catálogo centralizado con override local). */
  async listarProductosPorSucursal(empresaId: string, sucursalId: string) {
    const productos = await this.prisma.producto.findMany({
      where: { empresaId, activo: true },
      include: {
        sucursales: { where: { sucursalId } },
        modificadores: {
          orderBy: { orden: "asc" },
          include: { modificador: { include: { opciones: { orderBy: { orden: "asc" } } } } },
        },
      },
      orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    });

    return productos.map((p) => {
      const override = p.sucursales[0];
      return {
        id: p.id,
        empresaId: p.empresaId,
        categoriaId: p.categoriaId,
        nombre: p.nombre,
        descripcion: p.descripcion,
        subcategoria: p.subcategoria,
        imagenUrl: p.imagenUrl,
        precioBase: Number(p.precioBase),
        orden: p.orden,
        activo: p.activo,
        requierePersonalizacion: p.requierePersonalizacion,
        estacionPreparacion: p.estacionPreparacion,
        impuestoOverride: p.impuestoOverride != null ? Number(p.impuestoOverride) : null,
        precioSucursal: override ? Number(override.precio) : Number(p.precioBase),
        disponibleSucursal: override ? override.disponible : true,
        modificadores: p.modificadores.map((pm) => ({
          id: pm.modificador.id,
          nombre: pm.modificador.nombre,
          tipo: pm.modificador.tipo,
          obligatorio: pm.modificador.obligatorio,
          opciones: pm.modificador.opciones.map((o) => ({
            id: o.id,
            nombre: o.nombre,
            precioExtra: Number(o.precioExtra),
            orden: o.orden,
          })),
        })),
      };
    });
  }

  crearCategoria(data: { empresaId: string; nombre: string; orden?: number; icono?: string; color?: string }) {
    return this.prisma.categoriaProducto.create({ data });
  }

  crearProducto(data: {
    empresaId: string;
    categoriaId: string;
    nombre: string;
    descripcion?: string;
    subcategoria?: string;
    imagenUrl?: string;
    precioBase: number;
    orden?: number;
    requierePersonalizacion?: boolean;
    estacionPreparacion?: "BARRA" | "COCINA" | "POSTRES";
    impuestoOverride?: number;
  }) {
    return this.prisma.producto.create({ data });
  }

  actualizarProducto(
    id: string,
    data: Partial<{
      nombre: string;
      descripcion: string;
      subcategoria: string;
      imagenUrl: string;
      precioBase: number;
      orden: number;
      activo: boolean;
      categoriaId: string;
      requierePersonalizacion: boolean;
      estacionPreparacion: "BARRA" | "COCINA" | "POSTRES";
      impuestoOverride: number | null;
    }>,
  ) {
    return this.prisma.producto.update({ where: { id }, data });
  }

  async fijarPrecioSucursal(productoId: string, sucursalId: string, precio: number, disponible = true) {
    return this.prisma.productoSucursal.upsert({
      where: { productoId_sucursalId: { productoId, sucursalId } },
      update: { precio, disponible },
      create: { productoId, sucursalId, precio, disponible },
    });
  }

  async fijarDisponibilidad(productoId: string, sucursalId: string, disponible: boolean) {
    const producto = await this.prisma.producto.findUniqueOrThrow({ where: { id: productoId } });
    return this.prisma.productoSucursal.upsert({
      where: { productoId_sucursalId: { productoId, sucursalId } },
      update: { disponible },
      create: { productoId, sucursalId, disponible, precio: producto.precioBase },
    });
  }

  crearModificador(data: {
    empresaId: string;
    nombre: string;
    tipo: "SELECCION_UNICA" | "MULTIPLE";
    obligatorio?: boolean;
    opciones: { nombre: string; precioExtra: number; orden?: number }[];
  }) {
    return this.prisma.modificador.create({
      data: {
        empresaId: data.empresaId,
        nombre: data.nombre,
        tipo: data.tipo,
        obligatorio: data.obligatorio ?? false,
        opciones: { create: data.opciones },
      },
      include: { opciones: true },
    });
  }

  asignarModificadorAProducto(productoId: string, modificadorId: string, orden = 0) {
    return this.prisma.productoModificador.upsert({
      where: { productoId_modificadorId: { productoId, modificadorId } },
      update: { orden },
      create: { productoId, modificadorId, orden },
    });
  }
}
