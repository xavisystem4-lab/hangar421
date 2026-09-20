import * as FileSystem from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";
import { filasDetalle, filasResumen, htmlReporte, nombreArchivo, type DatosReporte } from "./armarReporte";

/** Escritura de ficheros y diálogo de compartir. Todo lo que DECIDE qué dice el reporte vive en
 *  armarReporte.ts (puro y con pruebas); aquí solo está el pegamento con los módulos nativos.
 *
 *  Nota sobre el correo: no se usa un cliente de correo propio. `Sharing.shareAsync` abre el
 *  selector del sistema, donde Gmail, Outlook y WhatsApp aparecen como destinos — el usuario
 *  elige y el adjunto ya va puesto. Meter un composer dedicado obligaría a configurar cuentas
 *  SMTP en el dispositivo para acabar en el mismo sitio, con más cosas que romper. */

async function compartir(uri: string, tipoMime: string, titulo: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Este dispositivo no permite compartir archivos. El reporte quedó guardado en la app.");
  }
  await Sharing.shareAsync(uri, { mimeType: tipoMime, dialogTitle: titulo, UTI: tipoMime });
}

/** PDF vía expo-print: convierte el HTML con el motor del sistema, así que el reporte se ve
 *  igual que en una impresión normal y no hace falta una librería de PDF aparte. */
export async function exportarPdf(datos: DatosReporte): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: htmlReporte(datos) });

  // printToFileAsync deja un nombre temporal aleatorio; se renombra para que el adjunto llegue
  // con algo legible en vez de "a1b2c3.pdf".
  const destino = `${FileSystem.cacheDirectory}${nombreArchivo(datos, "pdf")}`;
  await FileSystem.moveAsync({ from: uri, to: destino }).catch(() => undefined);
  const final = (await FileSystem.getInfoAsync(destino)).exists ? destino : uri;

  await compartir(final, "application/pdf", "Compartir reporte en PDF");
}

/** Excel real (.xlsx), no un CSV renombrado: dos hojas, resumen y detalle, que es como llega
 *  el reporte del POS Windows. Se escribe en base64 porque expo-file-system no acepta binario
 *  crudo. */
export async function exportarExcel(datos: DatosReporte): Promise<void> {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasResumen(datos)), "Resumen");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasDetalle(datos)), "Detalle");

  const base64 = XLSX.write(libro, { type: "base64", bookType: "xlsx" });
  const destino = `${FileSystem.cacheDirectory}${nombreArchivo(datos, "xlsx")}`;
  await FileSystem.writeAsStringAsync(destino, base64, { encoding: FileSystem.EncodingType.Base64 });

  await compartir(destino, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Compartir reporte en Excel");
}
