import type { SQLiteDatabase } from "expo-sqlite";
import type { SyncPullResponse } from "@hangar421/shared";
import { abrirBaseDeDatos } from "../db/database";
import { erpFetch, obtenerTokensErp } from "../api/erpHttp";
import { obtenerSucursalErp } from "../db/dispositivoLocal";
import { obtenerConfig, guardarConfig } from "../db/configLocalRepo";
import { upsertCatalogo, upsertMesas, repararProductosLocalesEnOutbox } from "../db/catalogoSyncRepo";
import { upsertInventario } from "../db/inventarioRepo";

const CLAVE_EMPRESA_ERP = "empresa_id_erp";
const CLAVE_CURSOR_PULL = "cursor_pull";

/** Guardarla vive en db/dispositivoLocal.guardarEmpresaErp, junto a la de sucursal: además de
 *  escribir la clave, tiene que repuntar las ventas ya encoladas que llevaban el placeholder. */
export async function obtenerEmpresaErp(db: SQLiteDatabase): Promise<string | null> {
  return obtenerConfig(db, CLAVE_EMPRESA_ERP);
}

/** Trae el catálogo completo por los mismos endpoints REST que ya usan crm-web/pos-desktop
 *  (GET /catalogo/categorias, GET /catalogo/productos) — NO por /sync/pull: ese endpoint solo
 *  trae PEDIDO/MESA/PRODUCTO_SUCURSAL/INVENTARIO_SUCURSAL (deltas operativos, no el catálogo
 *  base completo con nombre/categoría — ver sync.service.ts::pull() del backend), así que no
 *  sirve para sembrar el catálogo desde cero. Se llama al conectar y cada tanto en segundo
 *  plano (ver syncEngine). */
export async function refrescarCatalogo(): Promise<void> {
  const db = await abrirBaseDeDatos();
  const [empresaId, sucursalId, tokens] = await Promise.all([obtenerConfig(db, CLAVE_EMPRESA_ERP), obtenerSucursalErp(db), obtenerTokensErp()]);
  if (!empresaId || !sucursalId || !tokens) return;

  const [categorias, productos] = await Promise.all([
    erpFetch<any[]>(`/catalogo/categorias?empresaId=${empresaId}`),
    erpFetch<any[]>(`/catalogo/productos?empresaId=${empresaId}&sucursalId=${sucursalId}`),
  ]);

  await upsertCatalogo(
    db,
    categorias.map((c) => ({ id: c.id, nombre: c.nombre, orden: c.orden, activo: c.activo })),
    productos.map((p) => ({
      id: p.id, categoriaId: p.categoriaId, nombre: p.nombre, subcategoria: p.subcategoria ?? null, orden: p.orden ?? 0,
      precioBase: Number(p.precioBase), precioSucursal: p.precioSucursal != null ? Number(p.precioSucursal) : undefined,
      activo: p.activo, disponibleSucursal: p.disponibleSucursal,
      requierePersonalizacion: p.requierePersonalizacion, modificadores: p.modificadores,
    })),
  );
}

/** Trae insumos y existencias por los mismos endpoints REST que usa el ERP web
 *  (GET /inventario/insumos, GET /inventario/existencias). Igual que el catálogo, va aparte de
 *  /sync/pull: ese solo manda deltas de INVENTARIO_SUCURSAL, sin el nombre ni la unidad del
 *  insumo, así que no sirve para poblar la pantalla desde cero.
 *
 *  Best-effort de principio a fin: el inventario es consulta, nunca puede impedir vender. */
export async function refrescarInventario(): Promise<void> {
  const db = await abrirBaseDeDatos();
  const [empresaId, sucursalId, tokens] = await Promise.all([
    obtenerEmpresaErp(db),
    obtenerSucursalErp(db),
    obtenerTokensErp(),
  ]);
  if (!empresaId || !sucursalId || !tokens) return;

  const [insumos, existencias] = await Promise.all([
    erpFetch<any[]>(`/inventario/insumos?empresaId=${empresaId}`),
    erpFetch<any[]>(`/inventario/existencias?sucursalId=${sucursalId}`),
  ]);

  await upsertInventario(
    db,
    insumos.map((i) => ({
      id: i.id, nombre: i.nombre, unidadMedida: i.unidadMedida, costoUnitario: Number(i.costoUnitario) || 0,
      proveedorId: i.proveedorId, proveedor: i.proveedor, activo: i.activo,
    })),
    existencias.map((e) => ({ insumoId: e.insumoId, existencia: e.existencia, minimo: e.minimo, maximo: e.maximo })),
  );
}

/** Deltas operativos vía /sync/pull (mesas, por ahora — PEDIDO/INVENTARIO_SUCURSAL quedan fuera
 *  de esta fase a propósito: las ventas de este dispositivo son su propia fuente de verdad, no
 *  hace falta bajar pedidos de otros orígenes; inventario local llega en una fase posterior). */
export async function ejecutarPull(): Promise<void> {
  const db = await abrirBaseDeDatos();
  const [sucursalId, tokens, cursor] = await Promise.all([obtenerSucursalErp(db), obtenerTokensErp(), obtenerConfig(db, CLAVE_CURSOR_PULL)]);
  if (!sucursalId || !tokens) return;

  const query = cursor ? `?sucursalId=${sucursalId}&since=${encodeURIComponent(cursor)}` : `?sucursalId=${sucursalId}`;
  const resp = await erpFetch<SyncPullResponse>(`/sync/pull${query}`);

  const mesas = resp.cambios.filter((c) => c.entidad === "MESA").map((c) => c.payload as any);
  if (mesas.length > 0) {
    await upsertMesas(db, mesas.map((m) => ({ id: m.id, nombre: m.nombre, estado: m.estado })));
  }

  await guardarConfig(db, CLAVE_CURSOR_PULL, resp.cursor);
}
