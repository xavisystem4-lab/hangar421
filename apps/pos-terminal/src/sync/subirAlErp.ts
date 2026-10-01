import { abrirBaseDeDatos } from "../db/database";
import { repararProductosLocalesEnOutbox } from "../db/catalogoSyncRepo";
import {
  contarPendientes,
  corregirVentasConTurnoDesconocido,
  listarProblemasSync,
  reintentarTodosLosProblemas,
  type ProblemaSync,
} from "../db/outboxRepo";
import { obtenerTokensErp } from "../api/erpHttp";
import { useSyncStatusStore } from "../store/syncStatusStore";
import { refrescarCatalogo } from "./pullEngine";
import { procesarCola } from "./syncEngine";

export interface ResumenSubida {
  /** La terminal no está enlazada al ERP: no se intentó nada. */
  sinEnlace: boolean;
  /** Eventos que estaban por subir y ya están en el ERP. */
  enviados: number;
  /** Eventos que siguen en la tablet (rechazados o sin red). */
  pendientes: number;
  /** Ventas corregidas antes de reenviar (producto de la tablet → producto del ERP, turno desconocido). */
  corregidas: number;
  problemas: ProblemaSync[];
  /** Error general (sin red, ERP caído) — distinto de los rechazos por venta de `problemas`. */
  errorGeneral: string | null;
}

/**
 * Botón "Subir a ERP": hace en un toque todo lo que antes había que combinar a mano.
 *
 * 1. Descarga el catálogo del ERP (sin él no se pueden corregir los productos de la tablet).
 * 2. Corrige las ventas que el ERP ya rechazó por causas que la tablet puede arreglar:
 *    productos sembrados en la tablet (`hangar-prod-…`) que en el ERP tienen otro id, y ventas
 *    con un turno que el ERP no conoce.
 * 3. Devuelve a la cola todo lo que estaba en error y lo manda, sin esperar el backoff.
 * 4. Dice qué subió y qué no, con el motivo del ERP para lo que sigue rechazado.
 *
 * Nunca borra ni descarta ventas: lo que no se pueda subir se queda en la tablet, visible en
 * Admin → Sincronización.
 */
export async function subirAlErp(): Promise<ResumenSubida> {
  const db = await abrirBaseDeDatos();
  if (!(await obtenerTokensErp())) {
    return { sinEnlace: true, enviados: 0, pendientes: await contarPendientes(db), corregidas: 0, problemas: [], errorGeneral: null };
  }

  const antes = await contarPendientes(db);
  let errorCatalogo: string | null = null;
  await refrescarCatalogo().catch((e: any) => {
    errorCatalogo = e?.message ?? "No se pudo descargar el catálogo del ERP";
  });

  const corregidas = (await repararProductosLocalesEnOutbox(db).catch(() => 0)) + (await corregirVentasConTurnoDesconocido(db).catch(() => 0));
  await reintentarTodosLosProblemas(db);
  await procesarCola(true);

  const pendientes = await contarPendientes(db);
  const estado = useSyncStatusStore.getState();
  const errorGeneral = estado.estado === "SIN_CONEXION" || estado.estado === "ERROR" ? estado.ultimoError ?? "El ERP no respondió." : errorCatalogo;

  return {
    sinEnlace: false,
    enviados: Math.max(0, antes - pendientes),
    pendientes,
    corregidas,
    problemas: await listarProblemasSync(db),
    errorGeneral,
  };
}

/** Texto para el aviso que ve el cajero después de tocar el botón. */
export function textoResumenSubida(r: ResumenSubida): { titulo: string; detalle: string } {
  if (r.sinEnlace) {
    return { titulo: "Terminal sin enlazar", detalle: "Esta tablet no está conectada al ERP. Enlázala con un código desde el indicador de conexión." };
  }
  const partes: string[] = [];
  if (r.enviados > 0) partes.push(`✓ Se subieron ${r.enviados} evento(s) al ERP (ventas, cobros y movimientos de caja).`);
  if (r.corregidas > 0) partes.push(`Se corrigieron ${r.corregidas} venta(s) antes de reenviarlas.`);
  if (r.errorGeneral) partes.push(`No se pudo completar: ${r.errorGeneral}`);
  if (r.problemas.length > 0) {
    const muestra = r.problemas.slice(0, 3).map((p) => `• ${p.folioLocal != null ? `Venta #${p.folioLocal}` : p.entidad}: ${p.ultimoError}`);
    partes.push(`El ERP sigue rechazando ${r.problemas.length}:\n${muestra.join("\n")}${r.problemas.length > 3 ? "\n…" : ""}`);
  }
  if (r.pendientes === 0) partes.push("Todo lo registrado en esta tablet ya está en el ERP.");
  else partes.push(`Quedan ${r.pendientes} evento(s) en la tablet. No se pierde nada: puedes volver a intentarlo.`);

  const titulo = r.pendientes === 0 ? "Subida completa" : r.enviados > 0 ? "Subida parcial" : "No se pudo subir";
  return { titulo, detalle: partes.join("\n\n") };
}
