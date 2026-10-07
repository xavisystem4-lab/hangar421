import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CatalogoService {
  private readonly logger = new Logger(CatalogoService.name);

  constructor(private prisma: PrismaService) {}

  /** Todos los modificadores de la empresa con sus opciones: lo que una terminal ofrece al dar
   *  de alta un producto (Admin → Catálogo del APK). Incluye los que todavía no pregunta ningún
   *  producto, que por /catalogo/productos nunca llegarían. */
  async listarModificadores(empresaId: string) {
    const lista = await this.prisma.modificador.findMany({
      where: { empresaId },
      include: { opciones: { orderBy: { orden: "asc" } } },
      orderBy: { nombre: "asc" },
    });
    return lista.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      tipo: m.tipo,
      obligatorio: m.obligatorio,
      opciones: m.opciones.map((o) => ({ id: o.id, nombre: o.nombre, precioExtra: Number(o.precioExtra), orden: o.orden })),
    }));
  }

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

  /**
   * Alta de un producto hecha en una terminal (SyncEntidad.PRODUCTO / CREATE). Llega con el id
   * que ya tiene en la tablet, así que es idempotente: reenviar el mismo sobre no duplica nada.
   *
   * - La categoría y los modificadores deben existir en la empresa: si no, se rechaza con un
   *   mensaje claro y el item queda en ERROR (visible en "problemas de sincronización"). Es
   *   preferible a crear el producto a medias y que las ventas con esos modificadores se atoren
   *   después en PedidosService.resolverItem.
   * - Queda EN VENTA solo en la sucursal que lo dio de alta (con su precio) y en STANDBY en las
   *   demás — mismo criterio que las migraciones de catálogo: un producto nuevo no aparece de
   *   golpe en el mostrador de otra sucursal; allá se activa desde Admin → Catálogo.
   */
  async altaProductoDesdeTerminal(datos: {
    id: string;
    empresaId: string;
    sucursalId: string;
    categoriaId: string;
    nombre: string;
    precioBase: number;
    subcategoria?: string | null;
    estacionPreparacion?: "BARRA" | "COCINA" | "POSTRES" | null;
    modificadorIds?: string[];
  }) {
    const nombre = String(datos.nombre ?? "").trim();
    if (!nombre) throw new Error("El producto no tiene nombre");
    const precioBase = Number(datos.precioBase);
    if (!Number.isFinite(precioBase) || precioBase < 0) throw new Error("El precio del producto no es válido");

    const categoria = await this.prisma.categoriaProducto.findUnique({ where: { id: datos.categoriaId }, select: { empresaId: true } });
    if (!categoria || categoria.empresaId !== datos.empresaId) {
      throw new Error("La categoría del producto no existe en el ERP (créala primero en el CRM o espera a que se sincronice)");
    }
    const modificadorIds = await this.validarModificadores(datos.empresaId, datos.modificadorIds);

    const existente = await this.prisma.producto.findUnique({ where: { id: datos.id }, select: { empresaId: true } });
    if (existente && existente.empresaId !== datos.empresaId) throw new Error("El producto pertenece a otra empresa");

    const estaciones = ["BARRA", "COCINA", "POSTRES"];
    const estacionPreparacion = datos.estacionPreparacion && estaciones.includes(datos.estacionPreparacion) ? datos.estacionPreparacion : null;

    await this.prisma.$transaction(async (tx) => {
      if (!existente) {
        await tx.producto.create({
          data: {
            id: datos.id,
            empresaId: datos.empresaId,
            categoriaId: datos.categoriaId,
            nombre,
            precioBase,
            subcategoria: datos.subcategoria?.trim() || null,
            estacionPreparacion,
            requierePersonalizacion: modificadorIds.length > 0,
            activo: true,
          },
        });
      }
      await this.reemplazarModificadores(tx, datos.id, modificadorIds);

      await tx.productoSucursal.upsert({
        where: { productoId_sucursalId: { productoId: datos.id, sucursalId: datos.sucursalId } },
        update: { precio: precioBase, disponible: true },
        create: { productoId: datos.id, sucursalId: datos.sucursalId, precio: precioBase, disponible: true },
      });
      const otras = await tx.sucursal.findMany({ where: { empresaId: datos.empresaId, id: { not: datos.sucursalId } }, select: { id: true } });
      if (otras.length > 0) {
        await tx.productoSucursal.createMany({
          data: otras.map((s) => ({ productoId: datos.id, sucursalId: s.id, precio: precioBase, disponible: false })),
          skipDuplicates: true,
        });
      }
    });
    this.logger.log(`Producto "${nombre}" dado de alta desde la terminal (${datos.id}) con ${modificadorIds.length} modificador(es)`);
    return { id: datos.id, creado: !existente };
  }

  /** Cambia qué modificadores pregunta un producto (SyncEntidad.PRODUCTO / UPDATE). Reemplaza
   *  la lista completa y ajusta `requierePersonalizacion` para que el modal abra (o deje de abrir). */
  async fijarModificadoresDeProducto(empresaId: string, productoId: string, modificadorIds: string[] | undefined) {
    const producto = await this.prisma.producto.findUnique({ where: { id: productoId }, select: { empresaId: true } });
    if (!producto) throw new Error("El producto no existe en el ERP");
    if (producto.empresaId !== empresaId) throw new Error("El producto pertenece a otra empresa");
    const ids = await this.validarModificadores(empresaId, modificadorIds);
    await this.prisma.$transaction(async (tx) => {
      await this.reemplazarModificadores(tx, productoId, ids);
    });
    return { id: productoId, modificadores: ids.length };
  }

  /** Ids únicos, en el orden recibido, todos de la empresa. Lanza si alguno no existe o es ajeno. */
  private async validarModificadores(empresaId: string, ids: string[] | undefined): Promise<string[]> {
    const unicos = [...new Set((Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string" && x.length > 0))];
    if (unicos.length === 0) return [];
    const encontrados = await this.prisma.modificador.findMany({ where: { id: { in: unicos } }, select: { id: true, empresaId: true } });
    const porId = new Map(encontrados.map((m) => [m.id, m.empresaId]));
    for (const id of unicos) {
      const dueno = porId.get(id);
      if (!dueno) throw new Error("Uno de los modificadores no existe en el ERP: vuelve a sincronizar el catálogo y elígelo de nuevo");
      if (dueno !== empresaId) throw new Error("Uno de los modificadores pertenece a otra empresa");
    }
    return unicos;
  }

  private async reemplazarModificadores(tx: Prisma.TransactionClient, productoId: string, modificadorIds: string[]) {
    await tx.productoModificador.deleteMany({ where: { productoId } });
    if (modificadorIds.length > 0) {
      await tx.productoModificador.createMany({
        data: modificadorIds.map((modificadorId, i) => ({ productoId, modificadorId, orden: i + 1 })),
        skipDuplicates: true,
      });
    }
    await tx.producto.update({ where: { id: productoId }, data: { requierePersonalizacion: modificadorIds.length > 0 } });
  }

  asignarModificadorAProducto(productoId: string, modificadorId: string, orden = 0) {
    return this.prisma.productoModificador.upsert({
      where: { productoId_modificadorId: { productoId, modificadorId } },
      update: { orden },
      create: { productoId, modificadorId, orden },
    });
  }
}
