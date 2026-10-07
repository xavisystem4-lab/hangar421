import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { minutosDeHora } from "@hangar421/shared";
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
      include: { opciones: { where: { activo: true }, orderBy: { orden: "asc" } } },
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
          include: { modificador: { include: { opciones: { where: { activo: true }, orderBy: { orden: "asc" } } } } },
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

  /** Promociones de la empresa para las terminales (GET /catalogo/promociones). Incluye las
   *  apagadas: la terminal las muestra en Admin para poder reactivarlas. */
  async listarPromociones(empresaId: string) {
    const promos = await this.prisma.promocion.findMany({
      where: { empresaId },
      include: { productos: { select: { productoId: true } } },
      orderBy: { createdAt: "asc" },
    });
    return promos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      tipo: p.tipo,
      valor: Number(p.valor),
      productoIds: p.productos.map((x) => x.productoId),
      dias: p.dias,
      horaInicio: p.horaInicio,
      horaFin: p.horaFin,
      fechaInicio: p.fechaInicio,
      fechaFin: p.fechaFin,
      sucursalId: p.sucursalId,
      activo: p.activo,
    }));
  }

  /**
   * Alta o edición de una promoción hecha en una terminal (SyncEntidad.PROMOCION, CREATE y UPDATE).
   * Llega con la definición COMPLETA y con el id de la tablet, así que es un upsert idempotente:
   * reenviar el sobre deja el mismo resultado. Apagarla es mandarla con `activo: false`.
   * Los productos deben ser de la empresa; la empresa sale del token.
   */
  async guardarPromocionDesdeTerminal(datos: {
    id: string;
    empresaId: string;
    usuarioId?: string | null;
    sucursalId?: string | null;
    nombre: string;
    tipo: string;
    valor: number;
    productoIds?: string[];
    dias?: number[];
    horaInicio?: string | null;
    horaFin?: string | null;
    fechaInicio?: string | null;
    fechaFin?: string | null;
    activo?: boolean;
  }) {
    const nombre = String(datos.nombre ?? "").trim();
    if (!nombre) throw new Error("La promoción no tiene nombre");
    if (datos.tipo !== "PRECIO" && datos.tipo !== "PORCENTAJE") throw new Error("El tipo de la promoción no es válido");
    const valor = Number(datos.valor);
    if (!Number.isFinite(valor) || valor < 0) throw new Error("El valor de la promoción no es válido");
    if (datos.tipo === "PORCENTAJE" && (valor <= 0 || valor > 100)) throw new Error("El porcentaje debe ser mayor que 0 y hasta 100");

    const dias = [...new Set(Array.isArray(datos.dias) ? datos.dias.map(Number) : [])];
    if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("Los días deben ir de 0 (domingo) a 6 (sábado)");
    const hora = (h: string | null | undefined, campo: string) => {
      if (h == null || h === "") return null;
      const m = minutosDeHora(h);
      if (m === null) throw new Error(`${campo} no es una hora válida (HH:MM)`);
      return h;
    };
    const horaInicio = hora(datos.horaInicio, "La hora de inicio");
    const horaFin = hora(datos.horaFin, "La hora de fin");
    if (horaInicio && horaFin && minutosDeHora(horaInicio)! >= minutosDeHora(horaFin)!) throw new Error("La hora de fin debe ser posterior a la de inicio");
    const fecha = (f: string | null | undefined, campo: string) => {
      if (f == null || f === "") return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error(`${campo} no es una fecha válida (AAAA-MM-DD)`);
      return f;
    };
    const fechaInicio = fecha(datos.fechaInicio, "La fecha de inicio");
    const fechaFin = fecha(datos.fechaFin, "La fecha de fin");
    if (fechaInicio && fechaFin && fechaInicio > fechaFin) throw new Error("La fecha de fin debe ser igual o posterior a la de inicio");

    const productoIds = [...new Set((Array.isArray(datos.productoIds) ? datos.productoIds : []).filter((x): x is string => typeof x === "string" && x.length > 0))];
    if (productoIds.length === 0) throw new Error("La promoción necesita al menos un producto");
    const productos = await this.prisma.producto.findMany({ where: { id: { in: productoIds } }, select: { id: true, empresaId: true } });
    const empresaDe = new Map(productos.map((p) => [p.id, p.empresaId]));
    for (const id of productoIds) {
      const dueno = empresaDe.get(id);
      if (!dueno) throw new Error("Uno de los productos no existe en el ERP: vuelve a sincronizar el catálogo");
      if (dueno !== datos.empresaId) throw new Error("Uno de los productos pertenece a otra empresa");
    }

    const existente = await this.prisma.promocion.findUnique({ where: { id: datos.id }, select: { empresaId: true } });
    if (existente && existente.empresaId !== datos.empresaId) throw new Error("La promoción pertenece a otra empresa");

    const campos = {
      nombre, tipo: datos.tipo, valor, dias, horaInicio, horaFin, fechaInicio, fechaFin,
      sucursalId: datos.sucursalId || null,
      activo: datos.activo ?? true,
    };
    await this.prisma.$transaction(async (tx) => {
      if (existente) await tx.promocion.update({ where: { id: datos.id }, data: campos });
      else await tx.promocion.create({ data: { id: datos.id, empresaId: datos.empresaId, creadaPorId: datos.usuarioId ?? null, ...campos } });
      await tx.promocionProducto.deleteMany({ where: { promocionId: datos.id } });
      await tx.promocionProducto.createMany({ data: productoIds.map((productoId) => ({ promocionId: datos.id, productoId })), skipDuplicates: true });
    });
    this.logger.log(`Promoción "${nombre}" ${existente ? "editada" : "creada"} desde la terminal (${datos.id}) con ${productoIds.length} producto(s)`);
    return { id: datos.id, creada: !existente };
  }

  /**
   * Alta de un grupo de modificadores hecha en una terminal (SyncEntidad.MODIFICADOR / CREATE).
   * Conserva los ids de la terminal (grupo y opciones) para que el producto y las ventas que ya
   * los nombran resuelvan igual aquí. Idempotente: si el grupo ya existe (reenvío del lote) no se
   * toca nada. La empresa sale del token, nunca del payload.
   */
  async crearModificadorDesdeTerminal(datos: {
    id: string;
    empresaId: string;
    nombre: string;
    tipo: string;
    obligatorio?: boolean;
    opciones?: { id?: string; nombre: string; precioExtra: number; orden?: number }[];
  }) {
    const { nombre, opciones } = this.validarGrupo(datos);

    const existente = await this.prisma.modificador.findUnique({ where: { id: datos.id }, select: { empresaId: true } });
    if (existente) {
      if (existente.empresaId !== datos.empresaId) throw new Error("El modificador pertenece a otra empresa");
      return { id: datos.id, creado: false };
    }

    await this.prisma.modificador.create({
      data: {
        id: datos.id,
        empresaId: datos.empresaId,
        nombre,
        tipo: datos.tipo,
        obligatorio: datos.obligatorio ?? false,
        opciones: { create: opciones }, // id undefined → Prisma genera uno
      },
    });
    this.logger.log(`Modificador "${nombre}" dado de alta desde la terminal (${datos.id}) con ${opciones.length} opción(es)`);
    return { id: datos.id, creado: true };
  }

  /** Valida y normaliza un grupo de modificadores recibido de una terminal (alta o edición). */
  private validarGrupo(datos: { nombre: string; tipo: string; opciones?: { id?: string; nombre: string; precioExtra: number; orden?: number }[] }) {
    const nombre = String(datos.nombre ?? "").trim();
    if (!nombre) throw new Error("El modificador no tiene nombre");
    if (datos.tipo !== "SELECCION_UNICA" && datos.tipo !== "MULTIPLE") throw new Error("El tipo del modificador no es válido");
    const opciones = (Array.isArray(datos.opciones) ? datos.opciones : []).map((o, i) => ({
      id: o.id,
      nombre: String(o.nombre ?? "").trim(),
      precioExtra: Number(o.precioExtra ?? 0),
      orden: o.orden ?? i + 1,
    }));
    if (opciones.length === 0) throw new Error("El modificador necesita al menos una opción");
    for (const o of opciones) {
      if (!o.nombre) throw new Error("Una opción del modificador no tiene nombre");
      if (!Number.isFinite(o.precioExtra) || o.precioExtra < 0) throw new Error(`El precio extra de "${o.nombre}" no es válido`);
    }
    return { nombre, opciones };
  }

  /**
   * Edición de un grupo de modificadores hecha en una terminal (SyncEntidad.MODIFICADOR / UPDATE):
   * renombrar, cambiar tipo/obligatorio, agregar opciones, cambiar sus precios y quitar opciones.
   * La lista de opciones recibida es la COMPLETA: las que ya no vienen se borran, o se apagan si
   * alguna venta las usó (el historial las sigue referenciando). Idempotente: reenviar el mismo
   * sobre deja el mismo resultado.
   */
  async editarModificadorDesdeTerminal(datos: {
    id: string;
    empresaId: string;
    nombre: string;
    tipo: string;
    obligatorio?: boolean;
    opciones?: { id?: string; nombre: string; precioExtra: number; orden?: number }[];
  }) {
    const { nombre, opciones } = this.validarGrupo(datos);
    const grupo = await this.prisma.modificador.findUnique({ where: { id: datos.id }, select: { empresaId: true, opciones: { select: { id: true } } } });
    if (!grupo) throw new Error("El modificador no existe en el ERP: espera a que se sincronice su alta");
    if (grupo.empresaId !== datos.empresaId) throw new Error("El modificador pertenece a otra empresa");

    const propias = new Set(grupo.opciones.map((o) => o.id));
    const idsRecibidos = new Set<string>();
    for (const o of opciones) {
      if (!o.id) continue;
      if (!propias.has(o.id)) {
        const otra = await this.prisma.opcionModificador.findUnique({ where: { id: o.id }, select: { modificadorId: true } });
        if (otra && otra.modificadorId !== datos.id) throw new Error(`La opción "${o.nombre}" pertenece a otro modificador`);
      }
      idsRecibidos.add(o.id);
    }
    const sobrantes = [...propias].filter((id) => !idsRecibidos.has(id));

    await this.prisma.$transaction(async (tx) => {
      await tx.modificador.update({ where: { id: datos.id }, data: { nombre, tipo: datos.tipo, obligatorio: datos.obligatorio ?? false } });
      for (const o of opciones) {
        if (o.id) {
          await tx.opcionModificador.upsert({
            where: { id: o.id },
            update: { nombre: o.nombre, precioExtra: o.precioExtra, orden: o.orden, activo: true },
            create: { id: o.id, modificadorId: datos.id, nombre: o.nombre, precioExtra: o.precioExtra, orden: o.orden },
          });
        } else {
          await tx.opcionModificador.create({ data: { modificadorId: datos.id, nombre: o.nombre, precioExtra: o.precioExtra, orden: o.orden } });
        }
      }
      for (const id of sobrantes) {
        const usos = await tx.pedidoItemModificador.count({ where: { opcionModificadorId: id } });
        if (usos > 0) await tx.opcionModificador.update({ where: { id }, data: { activo: false } });
        else await tx.opcionModificador.delete({ where: { id } });
      }
    });
    this.logger.log(`Modificador "${nombre}" editado desde la terminal (${datos.id}): ${opciones.length} opción(es), ${sobrantes.length} quitada(s)`);
    return { id: datos.id, opciones: opciones.length, quitadas: sobrantes.length };
  }

  /** Cambios de datos de un producto hechos en una terminal (SyncEntidad.PRODUCTO / UPDATE):
   *  nombre y categoría. Solo toca lo que llega; el precio va por PRODUCTO_SUCURSAL. */
  async editarDatosProducto(empresaId: string, productoId: string, datos: { nombre?: string; categoriaId?: string }) {
    const producto = await this.prisma.producto.findUnique({ where: { id: productoId }, select: { empresaId: true } });
    if (!producto) throw new Error("El producto no existe en el ERP");
    if (producto.empresaId !== empresaId) throw new Error("El producto pertenece a otra empresa");
    const cambios: { nombre?: string; categoriaId?: string } = {};
    if (datos.nombre !== undefined) {
      const nombre = String(datos.nombre).trim();
      if (!nombre) throw new Error("El producto no tiene nombre");
      cambios.nombre = nombre;
    }
    if (datos.categoriaId !== undefined) {
      const categoria = await this.prisma.categoriaProducto.findUnique({ where: { id: datos.categoriaId }, select: { empresaId: true } });
      if (!categoria || categoria.empresaId !== empresaId) throw new Error("La categoría del producto no existe en el ERP");
      cambios.categoriaId = datos.categoriaId;
    }
    if (Object.keys(cambios).length === 0) return { id: productoId, cambios: 0 };
    await this.prisma.producto.update({ where: { id: productoId }, data: cambios });
    return { id: productoId, cambios: Object.keys(cambios).length };
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
