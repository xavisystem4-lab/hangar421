import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { TipoMovimientoInventario, WS_EVENTS, calcularPorcionesDisponibles, deltaExistenciaInventario, factorConversionUnidad } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CorreoService } from "../correo/correo.service";

export interface ReporteInventarioPorCorreo {
  sucursalId: string;
  tipo: "reporte" | "compras";
  destinatarios: string[] | string;
  mensaje?: string;
  /** Resumen del semáforo tal como lo calculó el ERP, para el cuerpo del correo. */
  resumen: { optimo: number; bajo: number; critico: number; total: number };
  /** Insumos en rojo/amarillo para listarlos en el cuerpo (el PDF trae todo). */
  pendientes?: { nombre: string; existencia: number; unidad: string; minimo: number; nivel: "BAJO" | "CRITICO"; sugerido?: number }[];
  pdfBase64: string;
  nombreArchivo: string;
}

/** Tamaño máximo del PDF adjunto que acepta el endpoint (base64 ≈ 4/3 del binario). */
const MAX_PDF_BASE64 = 8 * 1024 * 1024;

@Injectable()
export class InventarioService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway, private correo: CorreoService) {}

  async listarInsumos(empresaId: string) {
    const insumos = await this.prisma.insumo.findMany({
      where: { empresaId, activo: true },
      include: { proveedor: true },
      orderBy: { nombre: "asc" },
    });
    // Number(...): costoUnitario/precioVenta son Decimal de Prisma — se serializan a JSON como
    // string si se devuelven crudos (ver PedidosPorCobrar.tsx, mismo bug de fondo ya corregido
    // ahí). Se convierten aquí, en el único lugar por el que pasan las respuestas de insumos.
    return insumos.map((i) => ({
      ...i,
      costoUnitario: Number(i.costoUnitario),
      precioVenta: i.precioVenta != null ? Number(i.precioVenta) : null,
    }));
  }

  /** Crea el insumo y, si se dan mínimo/máximo, siembra el registro de inventario (existencia 0)
   *  en TODAS las sucursales de la empresa con ese mismo mínimo/máximo — así, al dar de alta un
   *  insumo, el admin ya no tiene que ir sucursal por sucursal a fijarlo a mano (ver
   *  fijarMinimo, que sigue disponible aparte para ajustarlo por sucursal después). */
  async crearInsumo(data: {
    empresaId: string;
    nombre: string;
    unidadMedida: string;
    costoUnitario?: number;
    precioVenta?: number;
    proveedorId?: string;
    minimo?: number;
    maximo?: number;
  }) {
    const { minimo, maximo, ...insumoData } = data;
    const insumo = await this.prisma.insumo.create({ data: insumoData });

    if (minimo !== undefined || maximo !== undefined) {
      const sucursales = await this.prisma.sucursal.findMany({ where: { empresaId: data.empresaId }, select: { id: true } });
      await this.prisma.$transaction(
        sucursales.map((s) =>
          this.prisma.inventarioSucursal.upsert({
            where: { sucursalId_insumoId: { sucursalId: s.id, insumoId: insumo.id } },
            update: { minimo: minimo ?? 0, maximo },
            create: { sucursalId: s.id, insumoId: insumo.id, existencia: 0, minimo: minimo ?? 0, maximo },
          }),
        ),
      );
    }
    return insumo;
  }

  actualizarInsumo(
    id: string,
    data: Partial<{
      nombre: string;
      unidadMedida: string;
      costoUnitario: number;
      precioVenta: number | null;
      proveedorId: string | null;
      activo: boolean;
    }>,
  ) {
    return this.prisma.insumo.update({ where: { id }, data });
  }

  /**
   * Cambia la unidad de medida de un insumo y, cuando la conversión es conocida (l↔ml, kg↔g),
   * convierte TODO lo que estaba expresado en la unidad vieja: existencias, mínimos y máximos de
   * cada sucursal, y las cantidades de receta (del producto y de las opciones de modificador).
   *
   * Sin esto, pasar la leche de litros a mililitros dejaría "7" en el almacén queriendo decir
   * 7 ml donde hay 7 litros, y la receta descontaría 240 litros por café.
   *
   * `convertir: false` cambia solo la etiqueta (lo que hace falta al corregir una unidad mal
   * capturada, p. ej. "Cartón" → ml, donde los números hay que recapturarlos a mano).
   */
  async cambiarUnidadMedida(insumoId: string, unidadNueva: string, convertir = true) {
    const insumo = await this.prisma.insumo.findUnique({ where: { id: insumoId } });
    if (!insumo) throw new NotFoundException("Insumo no encontrado");
    const unidad = String(unidadNueva ?? "").trim();
    if (!unidad) throw new BadRequestException("Captura la unidad de medida.");

    const factor = convertir ? factorConversionUnidad(insumo.unidadMedida, unidad) : null;
    const aplicable = factor !== null && factor !== 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.insumo.update({ where: { id: insumoId }, data: { unidadMedida: unidad } });
      if (!aplicable) return;
      await tx.$executeRaw`UPDATE "inventario_sucursal" SET "existencia" = "existencia" * ${factor}, "minimo" = "minimo" * ${factor}, "maximo" = "maximo" * ${factor} WHERE "insumoId" = ${insumoId}`;
      await tx.$executeRaw`UPDATE "receta_items" SET "cantidad" = "cantidad" * ${factor} WHERE "insumoId" = ${insumoId}`;
      await tx.$executeRaw`UPDATE "receta_opciones" SET "cantidad" = "cantidad" * ${factor} WHERE "insumoId" = ${insumoId}`;
      // El costo unitario está por unidad: si la unidad se hace mil veces más chica, el costo
      // por unidad se divide entre mil.
      await tx.$executeRaw`UPDATE "insumos" SET "costoUnitario" = "costoUnitario" / ${factor} WHERE "id" = ${insumoId}`;
    });

    return {
      unidadAnterior: insumo.unidadMedida,
      unidadMedida: unidad,
      factorAplicado: aplicable ? factor : null,
      convertido: aplicable,
    };
  }

  definirReceta(productoId: string, items: { insumoId: string; cantidad: number }[]) {
    return this.prisma.$transaction(
      items.map((it) =>
        this.prisma.recetaItem.upsert({
          where: { productoId_insumoId: { productoId, insumoId: it.insumoId } },
          update: { cantidad: it.cantidad },
          create: { productoId, insumoId: it.insumoId, cantidad: it.cantidad },
        }),
      ),
    );
  }

  listarReceta(productoId: string) {
    return this.prisma.recetaItem.findMany({ where: { productoId }, include: { insumo: true } });
  }

  /**
   * Receta de una OPCIÓN de modificador: qué consume del inventario cuando el cliente la elige
   * (ej. "Leche de avena" → 240 ml de Leche-Avena). Reemplaza la lista completa de esa opción:
   * lo que no venga en `items` se borra, para que quitar un insumo sea posible desde el ERP.
   */
  async definirRecetaOpcion(opcionModificadorId: string, items: { insumoId: string; cantidad: number }[]) {
    const validos = (items ?? []).filter((i) => i.insumoId && Number(i.cantidad) > 0);
    await this.prisma.$transaction([
      this.prisma.recetaOpcion.deleteMany({
        where: { opcionModificadorId, ...(validos.length > 0 ? { insumoId: { notIn: validos.map((i) => i.insumoId) } } : {}) },
      }),
      ...validos.map((i) =>
        this.prisma.recetaOpcion.upsert({
          where: { opcionModificadorId_insumoId: { opcionModificadorId, insumoId: i.insumoId } },
          update: { cantidad: i.cantidad },
          create: { opcionModificadorId, insumoId: i.insumoId, cantidad: i.cantidad },
        }),
      ),
    ]);
    return this.listarRecetaOpcion(opcionModificadorId);
  }

  /** TODAS las recetas de la empresa, planas, para que la tablet las guarde y descuente sin
   *  conexión (ver pullEngine del POS terminal). */
  async recetasDeEmpresa(empresaId: string) {
    const [producto, opcion] = await Promise.all([
      this.prisma.recetaItem.findMany({
        where: { producto: { empresaId } },
        select: { productoId: true, insumoId: true, cantidad: true },
      }),
      this.prisma.recetaOpcion.findMany({
        where: { opcionModificador: { modificador: { empresaId } } },
        select: { opcionModificadorId: true, insumoId: true, cantidad: true },
      }),
    ]);
    return {
      porProducto: producto.map((r) => ({ productoId: r.productoId, insumoId: r.insumoId, cantidad: Number(r.cantidad) })),
      porOpcion: opcion.map((r) => ({ opcionModificadorId: r.opcionModificadorId, insumoId: r.insumoId, cantidad: Number(r.cantidad) })),
    };
  }

  listarRecetaOpcion(opcionModificadorId: string) {
    return this.prisma.recetaOpcion.findMany({ where: { opcionModificadorId }, include: { insumo: true } });
  }

  /** Recetas de todas las opciones de los modificadores de un producto, para pintarlas juntas en
   *  el ERP (Catálogo → Receta) sin una llamada por opción. */
  async recetaDeModificadoresDeProducto(productoId: string) {
    const opciones = await this.prisma.opcionModificador.findMany({
      where: { modificador: { productos: { some: { productoId } } } },
      select: {
        id: true, nombre: true, activo: true,
        modificador: { select: { id: true, nombre: true } },
        recetas: { select: { insumoId: true, cantidad: true, insumo: { select: { nombre: true, unidadMedida: true } } } },
      },
      orderBy: [{ modificadorId: "asc" }, { orden: "asc" }],
    });
    return opciones.map((o) => ({
      opcionId: o.id,
      opcion: o.nombre,
      activo: o.activo,
      modificadorId: o.modificador.id,
      modificador: o.modificador.nombre,
      receta: o.recetas.map((r) => ({ insumoId: r.insumoId, nombre: r.insumo.nombre, unidadMedida: r.insumo.unidadMedida, cantidad: Number(r.cantidad) })),
    }));
  }

  eliminarItemReceta(recetaItemId: string) {
    return this.prisma.recetaItem.delete({ where: { id: recetaItemId } });
  }

  async existencias(sucursalId: string) {
    return this.prisma.inventarioSucursal.findMany({
      where: { sucursalId },
      include: { insumo: true },
      orderBy: { insumo: { nombre: "asc" } },
    });
  }

  async alertasStockBajo(sucursalId: string) {
    const existencias = await this.existencias(sucursalId);
    return existencias.filter((e) => Number(e.existencia) <= Number(e.minimo));
  }

  /** Registra un movimiento manual (ENTRADA, AJUSTE, MERMA, CONTEO) y actualiza el saldo. */
  async registrarMovimiento(data: {
    sucursalId: string;
    insumoId: string;
    tipo: TipoMovimientoInventario;
    cantidad: number;
    motivo?: string;
    usuarioId?: string;
    dispositivoId?: string;
    idempotencyKey?: string;
  }) {
    if (data.idempotencyKey) {
      const existente = await this.prisma.movimientoInventario.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existente) return existente;
    }

    const delta = deltaExistenciaInventario(data.tipo, data.cantidad);

    const [movimiento, inventario] = await this.prisma.$transaction([
      this.prisma.movimientoInventario.create({ data }),
      this.prisma.inventarioSucursal.upsert({
        where: { sucursalId_insumoId: { sucursalId: data.sucursalId, insumoId: data.insumoId } },
        update: { existencia: { increment: delta } },
        create: { sucursalId: data.sucursalId, insumoId: data.insumoId, existencia: Math.max(delta, 0), minimo: 0 },
      }),
    ]);

    if (Number(inventario.existencia) <= Number(inventario.minimo)) {
      this.realtime.emitirASucursal(data.sucursalId, WS_EVENTS.INVENTARIO_ALERTA, inventario);
    }
    return movimiento;
  }

  async fijarMinimo(sucursalId: string, insumoId: string, minimo: number, maximo?: number) {
    return this.prisma.inventarioSucursal.upsert({
      where: { sucursalId_insumoId: { sucursalId, insumoId } },
      update: { minimo, maximo },
      create: { sucursalId, insumoId, minimo, maximo, existencia: 0 },
    });
  }

  listarMovimientos(sucursalId: string, insumoId?: string) {
    return this.prisma.movimientoInventario.findMany({
      where: { sucursalId, ...(insumoId ? { insumoId } : {}) },
      include: { insumo: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  /** Existencia "en producto" para una sucursal: cuántas unidades de cada producto alcanzan a
   *  prepararse con la existencia actual de sus insumos (según receta). Solo productos activos de
   *  la empresa de la sucursal; los que no tienen receta salen con porciones null para que el
   *  ERP los muestre como "sin receta" en vez de inventar un cero. */
  async existenciasPorProducto(sucursalId: string) {
    const sucursal = await this.prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { empresaId: true } });
    if (!sucursal) return [];
    const [productos, existencias] = await Promise.all([
      this.prisma.producto.findMany({
        where: { empresaId: sucursal.empresaId, activo: true },
        select: {
          id: true, nombre: true,
          categoria: { select: { id: true, nombre: true } },
          receta: { select: { insumoId: true, cantidad: true, insumo: { select: { nombre: true, unidadMedida: true } } } },
          sucursales: { where: { sucursalId }, select: { disponible: true } },
        },
        orderBy: [{ categoria: { orden: "asc" } }, { orden: "asc" }, { nombre: "asc" }],
      }),
      this.prisma.inventarioSucursal.findMany({ where: { sucursalId }, select: { insumoId: true, existencia: true, minimo: true, maximo: true } }),
    ]);
    const porInsumo: Record<string, number> = {};
    const nivelesInsumo: Record<string, { minimo: number; maximo: number | null }> = {};
    for (const e of existencias) {
      porInsumo[e.insumoId] = Number(e.existencia);
      nivelesInsumo[e.insumoId] = { minimo: Number(e.minimo), maximo: e.maximo != null ? Number(e.maximo) : null };
    }

    return productos.map((p) => {
      const receta = p.receta.map((r) => ({ insumoId: r.insumoId, cantidad: Number(r.cantidad) }));
      const { porciones, limitante } = calcularPorcionesDisponibles(receta, porInsumo);
      const itemLimitante = limitante ? p.receta.find((r) => r.insumoId === limitante.insumoId) : null;
      return {
        productoId: p.id,
        nombre: p.nombre,
        categoriaId: p.categoria.id,
        categoria: p.categoria.nombre,
        disponibleEnSucursal: p.sucursales[0]?.disponible ?? true,
        tieneReceta: receta.length > 0,
        porciones,
        limitante: itemLimitante
          ? {
              insumoId: itemLimitante.insumoId,
              nombre: itemLimitante.insumo.nombre,
              unidadMedida: itemLimitante.insumo.unidadMedida,
              existencia: porInsumo[itemLimitante.insumoId] ?? 0,
              minimo: nivelesInsumo[itemLimitante.insumoId]?.minimo ?? 0,
              maximo: nivelesInsumo[itemLimitante.insumoId]?.maximo ?? null,
              porUnidad: Number(itemLimitante.cantidad),
            }
          : null,
      };
    });
  }

  async estadoCorreo(sucursalId?: string) {
    const empresaId = sucursalId ? (await this.prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { empresaId: true } }))?.empresaId : undefined;
    return this.correo.estado(empresaId);
  }

  /** Envía por correo el reporte de inventario o la lista de compras que el ERP ya generó en PDF
   *  (el navegador lo arma con jspdf; aquí solo se adjunta). El cuerpo lleva el semáforo en
   *  colores y los insumos pendientes de compra, por si el destinatario lo lee desde el celular
   *  sin abrir el adjunto. */
  async enviarReportePorCorreo(datos: ReporteInventarioPorCorreo, enviadoPor?: string) {
    if (!datos.pdfBase64 || typeof datos.pdfBase64 !== "string") throw new BadRequestException("Falta el PDF del reporte.");
    if (datos.pdfBase64.length > MAX_PDF_BASE64) throw new BadRequestException("El PDF es demasiado grande para enviarse por correo.");
    const destinatarios = CorreoService.normalizarDestinatarios(datos.destinatarios);
    if (destinatarios.length === 0) throw new BadRequestException("Captura al menos un correo válido.");

    const sucursal = await this.prisma.sucursal.findUnique({ where: { id: datos.sucursalId }, select: { nombre: true, empresaId: true } });
    const nombreSucursal = sucursal?.nombre ?? "Sucursal";
    const esCompras = datos.tipo === "compras";
    const titulo = esCompras ? "Lista de compras" : "Reporte de inventario";
    const fecha = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" });
    const asunto = `${titulo} · ${nombreSucursal} · ${fecha}`;
    const r = datos.resumen ?? { optimo: 0, bajo: 0, critico: 0, total: 0 };

    const escapar = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
    const pendientes = (datos.pendientes ?? []).slice(0, 200);
    const filasPendientes = pendientes
      .map((p) => {
        const color = p.nivel === "CRITICO" ? "#dc2626" : "#d97706";
        const etiqueta = p.nivel === "CRITICO" ? "CRÍTICO" : "BAJO";
        return `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px"></span>${escapar(p.nombre)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700">${escapar(p.existencia)} ${escapar(p.unidad)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280">${escapar(p.minimo)} ${escapar(p.unidad)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:${color};font-weight:700">${etiqueta}</td>
          ${esCompras ? `<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700">${escapar(p.sugerido ?? "")} ${escapar(p.unidad)}</td>` : ""}
        </tr>`;
      })
      .join("");

    const tarjeta = (color: string, fondo: string, numero: number, texto: string) =>
      `<td style="padding:0 4px"><div style="background:${fondo};border-radius:10px;padding:12px;text-align:center"><div style="font-size:32px;font-weight:800;color:${color};line-height:1">${numero}</div><div style="font-size:12px;color:${color};font-weight:700;margin-top:4px">${texto}</div></div></td>`;

    const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111318">
      <div style="max-width:640px;margin:0 auto;padding:20px">
        <div style="background:#0b1e33;color:#fff;border-radius:12px 12px 0 0;padding:16px 20px">
          <div style="font-size:18px;font-weight:800">HANGAR 421</div>
          <div style="font-size:13px;opacity:.8">${escapar(titulo)} · ${escapar(nombreSucursal)}</div>
        </div>
        <div style="background:#fff;padding:20px;border-radius:0 0 12px 12px">
          <p style="margin:0 0 14px;color:#6b7280;font-size:13px">Generado el ${escapar(fecha)}${enviadoPor ? ` por ${escapar(enviadoPor)}` : ""}. El PDF completo va adjunto.</p>
          <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin-bottom:16px"><tr>
            ${tarjeta("#15803d", "#dcfce7", r.optimo, "VERDE · ÓPTIMO")}
            ${tarjeta("#b45309", "#fef3c7", r.bajo, "AMARILLO · BAJO")}
            ${tarjeta("#b91c1c", "#fee2e2", r.critico, "ROJO · CRÍTICO")}
          </tr></table>
          ${datos.mensaje ? `<p style="white-space:pre-wrap;background:#f9fafb;border-left:3px solid #0b1e33;padding:10px 12px;margin:0 0 16px">${escapar(datos.mensaje)}</p>` : ""}
          ${pendientes.length > 0 ? `<h3 style="margin:0 0 8px;font-size:15px">${esCompras ? "Qué comprar" : "Insumos por surtir"} (${pendientes.length})</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#f3f4f6;text-align:left"><th style="padding:6px 8px">Insumo</th><th style="padding:6px 8px;text-align:right">Existencia</th><th style="padding:6px 8px;text-align:right">Mínimo</th><th style="padding:6px 8px;text-align:center">Estado</th>${esCompras ? '<th style="padding:6px 8px;text-align:right">Comprar</th>' : ""}</tr></thead>
            <tbody>${filasPendientes}</tbody>
          </table>` : `<p style="margin:0;color:#15803d;font-weight:700">Todo el inventario está en nivel óptimo.</p>`}
          <p style="margin:18px 0 0;font-size:11px;color:#9ca3af">Enviado desde el ERP HANGAR 421.</p>
        </div>
      </div></body></html>`;

    const texto = [
      `${titulo} · ${nombreSucursal} · ${fecha}`,
      `Verde óptimo: ${r.optimo} · Amarillo bajo: ${r.bajo} · Rojo crítico: ${r.critico} (de ${r.total})`,
      datos.mensaje ?? "",
      ...pendientes.map((p) => `- [${p.nivel}] ${p.nombre}: ${p.existencia} ${p.unidad} (mínimo ${p.minimo})${esCompras && p.sugerido != null ? ` → comprar ${p.sugerido} ${p.unidad}` : ""}`),
      "El PDF completo va adjunto.",
    ].filter(Boolean).join("\n");

    const nombreArchivo = (datos.nombreArchivo || `${esCompras ? "lista-de-compras" : "reporte-inventario"}.pdf`).replace(/[^\w.-]+/g, "-");
    return this.correo.enviar({
      destinatarios,
      asunto,
      html,
      texto,
      adjuntos: [{ nombre: nombreArchivo.endsWith(".pdf") ? nombreArchivo : `${nombreArchivo}.pdf`, contenidoBase64: datos.pdfBase64, tipo: "application/pdf" }],
    }, sucursal?.empresaId);
  }
}
