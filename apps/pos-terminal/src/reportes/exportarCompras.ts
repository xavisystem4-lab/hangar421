import * as FileSystem from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";
import type { LineaCompra } from "../inventario/niveles";
import { escaparHtml, formatearFechaHora, formatearDinero } from "./armarReporte";

export interface DatosCompras {
  sucursal: string;
  fecha: string;
  grupos: { proveedor: string; lineas: LineaCompra[]; costo: number }[];
  costoTotal: number;
}

function nombreArchivoCompras(datos: DatosCompras, extension: string): string {
  const limpio = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const dia = datos.fecha.slice(0, 10);
  return `Compras-${limpio(datos.sucursal || "HANGAR421")}-${dia}.${extension}`;
}

/** Filas del Excel: agrupadas por proveedor, con la cantidad sugerida como NÚMERO para que se
 *  pueda editar y sumar antes de mandar el pedido — es una lista de trabajo, no un informe. */
export function filasCompras(datos: DatosCompras): (string | number)[][] {
  const filas: (string | number)[][] = [
    ["Lista de compras"],
    ["Sucursal", datos.sucursal],
    ["Generada", formatearFechaHora(datos.fecha)],
    [],
    ["Proveedor", "Insumo", "Existencia", "Mínimo", "Comprar", "Unidad", "Costo estimado"],
  ];
  for (const g of datos.grupos) {
    for (const l of g.lineas) {
      filas.push([g.proveedor, l.nombre, l.existencia, l.minimo, l.sugerido, l.unidadMedida, l.costoEstimado]);
    }
  }
  filas.push([], ["", "", "", "", "", "TOTAL", datos.costoTotal]);
  return filas;
}

export function htmlCompras(datos: DatosCompras): string {
  const grupos = datos.grupos
    .map(
      (g) => `
    <h2>${escaparHtml(g.proveedor)} <span class="costo">${formatearDinero(g.costo)}</span></h2>
    <table><thead><tr><th>Insumo</th><th class="num">Hay</th><th class="num">Mínimo</th><th class="num">Comprar</th><th class="num">Costo</th></tr></thead>
    <tbody>${g.lineas
      .map(
        (l) =>
          `<tr class="n-${l.nivel}"><td>${escaparHtml(l.nombre)}</td><td class="num">${l.existencia}</td>` +
          `<td class="num">${l.minimo}</td><td class="num fuerte">${l.sugerido} ${escaparHtml(l.unidadMedida)}</td>` +
          `<td class="num">${formatearDinero(l.costoEstimado)}</td></tr>`,
      )
      .join("")}</tbody></table>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #0B1E33; padding: 24px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #666; margin-bottom: 18px; }
  h2 { font-size: 14px; margin: 18px 0 6px; display: flex; justify-content: space-between; }
  .costo { color: #666; font-weight: normal; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #E5E7EB; padding: 6px 4px; text-align: left; }
  th { background: #F3F4F6; font-size: 11px; text-transform: uppercase; }
  .num { text-align: right; white-space: nowrap; }
  .fuerte { font-weight: 700; }
  /* Mismo semáforo que en la app: el que hace la compra ve de un vistazo qué es urgente. */
  .n-agotado td:first-child { border-left: 4px solid #DC2626; padding-left: 6px; }
  .n-critico td:first-child { border-left: 4px solid #DC2626; padding-left: 6px; }
  .n-bajo td:first-child { border-left: 4px solid #E8A33D; padding-left: 6px; }
  .total { margin-top: 20px; font-size: 15px; font-weight: 700; text-align: right; }
  footer { margin-top: 22px; color: #999; font-size: 10px; }
</style></head>
<body>
  <h1>Lista de compras — ${escaparHtml(datos.sucursal)}</h1>
  <div class="sub">Generada el ${escaparHtml(formatearFechaHora(datos.fecha))} a partir del inventario de la terminal</div>
  ${grupos || "<p>No hay insumos por debajo de su mínimo.</p>"}
  <div class="total">Costo estimado total: ${formatearDinero(datos.costoTotal)}</div>
  <footer>Las cantidades son una sugerencia: reponen hasta el máximo, o al doble del mínimo si no hay máximo definido.</footer>
</body></html>`;
}

async function compartir(uri: string, tipoMime: string, titulo: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Este dispositivo no permite compartir archivos.");
  }
  await Sharing.shareAsync(uri, { mimeType: tipoMime, dialogTitle: titulo, UTI: tipoMime });
}

export async function exportarComprasPdf(datos: DatosCompras): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: htmlCompras(datos) });
  const destino = `${FileSystem.cacheDirectory}${nombreArchivoCompras(datos, "pdf")}`;
  await FileSystem.moveAsync({ from: uri, to: destino }).catch(() => undefined);
  const final = (await FileSystem.getInfoAsync(destino)).exists ? destino : uri;
  await compartir(final, "application/pdf", "Compartir lista de compras");
}

export async function exportarComprasExcel(datos: DatosCompras): Promise<void> {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasCompras(datos)), "Compras");
  const base64 = XLSX.write(libro, { type: "base64", bookType: "xlsx" });
  const destino = `${FileSystem.cacheDirectory}${nombreArchivoCompras(datos, "xlsx")}`;
  await FileSystem.writeAsStringAsync(destino, base64, { encoding: FileSystem.EncodingType.Base64 });
  await compartir(destino, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Compartir lista de compras");
}
