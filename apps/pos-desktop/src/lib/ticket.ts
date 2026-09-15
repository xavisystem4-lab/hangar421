import type { ConfigTicket, EstiloTexto } from "@hangar421/shared";

export interface ItemTicket {
  cantidad: number;
  nombre: string;
  precioTotal?: number; // ausente en la comanda (no lleva precios)
  notas?: string;
}

export interface DatosTicketCliente {
  empresaNombre: string;
  sucursalNombre: string;
  logoUrl?: string | null;
  mesaNombre?: string | null;
  meseroNombre?: string | null;
  folio: string;
  fecha: Date;
  items: ItemTicket[];
  subtotal: number;
  impuesto: number;
  total: number;
}

export interface DatosComanda {
  mesaNombre?: string | null;
  fecha: Date;
  items: ItemTicket[];
}

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function estiloCss(e: EstiloTexto): string {
  return `font-family:'${e.fuente}',monospace;font-size:${e.tamano}px;font-weight:${e.negrita ? 700 : 400};` +
    `font-style:${e.cursiva ? "italic" : "normal"};text-decoration:${e.subrayado ? "underline" : "none"};`;
}

function envolverHtml(anchoMM: number, cuerpo: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${anchoMM}mm 297mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; width: ${anchoMM}mm; padding: 3mm; color: #000; background: #fff; }
  .fila { display: flex; justify-content: space-between; gap: 6px; }
  .centro { text-align: center; }
  .linea { border-top: 1px dashed #000; margin: 6px 0; }
  .logo { max-width: 100%; max-height: 60px; display: block; margin: 0 auto 6px; }
</style>
</head>
<body>${cuerpo}</body>
</html>`;
}

export function generarHtmlTicketCliente(config: ConfigTicket, d: DatosTicketCliente): string {
  const c = config.cliente;
  const items = d.items.map((i) => `
    <div class="fila" style="${estiloCss(c.estiloCuerpo)}">
      <span>${i.cantidad}x ${escaparHtml(i.nombre)}</span>
      <span>$${(i.precioTotal ?? 0).toFixed(2)}</span>
    </div>`).join("");

  const cuerpo = `
    ${config.mostrarLogo && d.logoUrl ? `<img class="logo" src="${d.logoUrl}" />` : ""}
    <div class="centro" style="${estiloCss(c.estiloEncabezado)}">
      <div>${escaparHtml(c.encabezadoLinea1 || d.empresaNombre)}</div>
      ${(c.encabezadoLinea2 || d.sucursalNombre) ? `<div>${escaparHtml(c.encabezadoLinea2 || d.sucursalNombre)}</div>` : ""}
    </div>
    <div class="linea"></div>
    <div class="centro" style="${estiloCss(c.estiloFechaHoraMesa)}">
      <div>${d.fecha.toLocaleDateString("es-MX")} ${d.fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}${d.mesaNombre ? ` · Mesa ${escaparHtml(d.mesaNombre)}` : ""}</div>
      <div>${d.meseroNombre ? `Mesero: ${escaparHtml(d.meseroNombre)} · ` : ""}Folio: ${escaparHtml(d.folio)}</div>
    </div>
    <div class="linea"></div>
    ${items}
    <div class="linea"></div>
    <div class="fila" style="${estiloCss(c.estiloTotales)}"><span>Subtotal</span><span>$${d.subtotal.toFixed(2)}</span></div>
    <div class="fila" style="${estiloCss(c.estiloTotales)}"><span>IVA</span><span>$${d.impuesto.toFixed(2)}</span></div>
    <div class="fila" style="${estiloCss({ ...c.estiloTotales, negrita: true })}"><span>Total</span><span>$${d.total.toFixed(2)}</span></div>
    <div class="centro" style="${estiloCss(c.estiloPie)}; margin-top:8px;">
      ${c.pieLinea1 ? `<div>${escaparHtml(c.pieLinea1)}</div>` : ""}
      ${c.pieLinea2 ? `<div>${escaparHtml(c.pieLinea2)}</div>` : ""}
    </div>`;

  return envolverHtml(config.anchoImpresoraMM, cuerpo);
}

export function generarHtmlComanda(config: ConfigTicket, d: DatosComanda): string {
  const co = config.comanda;
  const items = d.items.map((i) => `
    <div style="${estiloCss(co.estiloCuerpo)}">
      ${i.cantidad}x ${escaparHtml(i.nombre)}
      ${i.notas ? `<div style="font-size:${Math.max(co.estiloCuerpo.tamano - 3, 9)}px;">Nota: ${escaparHtml(i.notas)}</div>` : ""}
    </div>`).join("");

  const cuerpo = `
    <div class="centro" style="${estiloCss(co.estiloEncabezado)}">
      <div>${escaparHtml(co.titulo)}</div>
    </div>
    <div class="linea"></div>
    <div class="centro" style="${estiloCss(co.estiloCuerpo)}">
      ${d.mesaNombre ? `Mesa ${escaparHtml(d.mesaNombre)} · ` : ""}${d.fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
    </div>
    <div class="linea"></div>
    ${items}`;

  return envolverHtml(config.anchoImpresoraMM, cuerpo);
}

async function obtenerImpresoraGuardada(clave: string): Promise<string> {
  return (await window.hangar.config.obtener(clave)) || "";
}

export async function imprimirTicketCliente(config: ConfigTicket, datos: DatosTicketCliente): Promise<{ ok: boolean; error?: string }> {
  const html = generarHtmlTicketCliente(config, datos);
  const impresora = await obtenerImpresoraGuardada("impresora_recibos");
  return window.hangar.impresion.imprimir({ html, impresora, anchoMM: config.anchoImpresoraMM });
}

export async function imprimirComanda(config: ConfigTicket, datos: DatosComanda): Promise<{ ok: boolean; error?: string }> {
  const html = generarHtmlComanda(config, datos);
  const impresora = await obtenerImpresoraGuardada("impresora_cocina");
  // Sin impresora de cocina asignada, la comanda simplemente no se imprime (a diferencia del
  // recibo, que sí cae al diálogo del sistema) — muchas sucursales no tienen impresora de
  // cocina separada, y no tendría sentido interrumpir el flujo de cobro con un diálogo de
  // impresión que nadie pidió (ver "Sin asignar (no imprime comanda)" en AdminTicket.tsx).
  if (!impresora) return { ok: true };
  return window.hangar.impresion.imprimir({ html, impresora, anchoMM: config.anchoImpresoraMM });
}
