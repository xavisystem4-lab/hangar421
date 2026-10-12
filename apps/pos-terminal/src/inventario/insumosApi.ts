import { erpFetch, obtenerTokensErp } from "../api/erpHttp";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerEmpresaErp } from "../sync/pullEngine";
import { sincronizarPronto } from "../sync/syncEngine";
import { useAuthLocalStore } from "../store/authLocalStore";
import {
  actualizarInsumoLocal, cambiarActivoInsumoLocal, crearInsumoLocal, proveedoresLocales,
} from "../db/insumosLocalesRepo";
import type { InsumoValidado } from "./altaInsumo";

/**
 * Alta y edición de insumos desde la terminal: SIEMPRE local primero.
 *
 * Se guarda en la base de la tablet (se ve al instante) y se encola hacia el ERP; si hay red sale
 * en segundos, si no, cuando vuelva. Ya no depende de que el ERP responda ni del rol que tenga en
 * el ERP la cuenta con la que se enlazó la tablet — antes eso producía "Forbidden resource".
 */

export interface ProveedorErp {
  id: string;
  nombre: string;
}

function usuarioActual(): string | null {
  return useAuthLocalStore.getState().usuario?.id ?? null;
}

/** Del ERP si hay conexión; si no, los que la tablet ya conoce por sus insumos. */
export async function listarProveedores(): Promise<ProveedorErp[]> {
  const db = await abrirBaseDeDatos();
  const locales = await proveedoresLocales(db);
  try {
    const [empresaId, tokens] = await Promise.all([obtenerEmpresaErp(db), obtenerTokensErp()]);
    if (!empresaId || !tokens) return locales;
    const lista = await erpFetch<any[]>(`/proveedores?empresaId=${empresaId}`);
    return lista.filter((p) => p.activo !== false).map((p) => ({ id: p.id, nombre: p.nombre }));
  } catch {
    return locales;
  }
}

async function nombreProveedor(proveedorId: string | null): Promise<string | null> {
  if (!proveedorId) return null;
  const lista = await listarProveedores().catch(() => [] as ProveedorErp[]);
  return lista.find((p) => p.id === proveedorId)?.nombre ?? null;
}

export async function crearInsumo(datos: InsumoValidado): Promise<void> {
  const db = await abrirBaseDeDatos();
  await crearInsumoLocal(db, datos, await nombreProveedor(datos.proveedorId), usuarioActual());
  sincronizarPronto();
}

/**
 * `cambioUnidad` solo cuando la unidad cambió: con `convertir` se reescalan aquí y en el ERP las
 * existencias, mínimos, costo, empaque y recetas (240 l pasan a 240 000 ml).
 */
export async function actualizarInsumo(
  id: string,
  datos: InsumoValidado,
  cambioUnidad?: { convertir: boolean; unidadAnterior?: string },
): Promise<void> {
  const db = await abrirBaseDeDatos();
  const anterior = await db.getFirstAsync<{ unidad_medida: string }>("SELECT unidad_medida FROM insumos WHERE id = ?", id);
  await actualizarInsumoLocal(db, id, datos, {
    unidadAnterior: anterior?.unidad_medida ?? datos.unidadMedida,
    convertir: cambioUnidad?.convertir ?? false,
    proveedorNombre: await nombreProveedor(datos.proveedorId),
    usuarioId: usuarioActual(),
  });
  sincronizarPronto();
}

/** Baja lógica (o reactivación): nunca se borra, conserva su historial. */
export async function cambiarActivoInsumo(id: string, activo: boolean): Promise<void> {
  const db = await abrirBaseDeDatos();
  await cambiarActivoInsumoLocal(db, id, activo, usuarioActual());
  sincronizarPronto();
}
