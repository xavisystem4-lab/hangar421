import * as FileSystem from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";
import { filasDetalleCredito, filasResumenCredito, htmlReporteCredito, type ConsumoPorEmpleada } from "@hangar421/shared";
import { formatearFecha, formatearFechaHora } from "./armarReporte";

/**
 * Reporte de crédito de empleados en PDF o Excel desde la tablet. Se comparte con el selector del
 * sistema: ahí aparecen Gmail, Outlook o WhatsApp, así que "por correo" es elegir la app de correo
 * y el archivo ya va adjunto (mismo criterio que reportes/exportar.ts).
 */
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const dia = (iso: string) => `${DIAS[new Date(iso).getDay()]} ${formatearFecha(iso)}`;
const hora = (iso: string) => formatearFechaHora(iso).slice(-5);

function nombreArchivo(periodo: string, ext: string): string {
  return `credito-empleados_${periodo.replace(/[^\w]+/g, "-")}.${ext}`.replace(/-+\./, ".");
}

async function compartir(uri: string, tipo: string, titulo: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Este dispositivo no permite compartir archivos.");
  await Sharing.shareAsync(uri, { mimeType: tipo, dialogTitle: titulo, UTI: tipo });
}

export async function exportarCreditoPdf(grupos: ConsumoPorEmpleada[], sucursal: string, periodo: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: htmlReporteCredito(grupos, { sucursal, periodo, fecha: dia, hora }) });
  const destino = `${FileSystem.cacheDirectory}${nombreArchivo(periodo, "pdf")}`;
  await FileSystem.moveAsync({ from: uri, to: destino }).catch(() => undefined);
  const final = (await FileSystem.getInfoAsync(destino)).exists ? destino : uri;
  await compartir(final, "application/pdf", "Enviar reporte de crédito (PDF)");
}

export async function exportarCreditoExcel(grupos: ConsumoPorEmpleada[], periodo: string): Promise<void> {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasResumenCredito(grupos)), "Resumen");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasDetalleCredito(grupos, formatearFechaHora)), "Detalle");
  const base64 = XLSX.write(libro, { type: "base64", bookType: "xlsx" });
  const destino = `${FileSystem.cacheDirectory}${nombreArchivo(periodo, "xlsx")}`;
  await FileSystem.writeAsStringAsync(destino, base64, { encoding: FileSystem.EncodingType.Base64 });
  await compartir(destino, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Enviar reporte de crédito (Excel)");
}
