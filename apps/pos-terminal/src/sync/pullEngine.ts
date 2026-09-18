import type { SyncPullResponse } from "@hangar421/shared";
import { abrirBaseDeDatos } from "../db/database";
import { erpFetch, obtenerTokensErp } from "../api/erpHttp";
import { obtenerSucursalErp } from "../db/dispositivoLocal";
import { obtenerConfig, guardarConfig } from "../db/configLocalRepo";
import { upsertCatalogo, upsertMesas } from "../db/catalogoSyncRepo";

const CLAVE_EMPRESA_ERP = "empresa_id_erp";
const CLAVE_CURSOR_PULL = "cursor_pull";

export async function guardarEmpresaErp(empresaId: string): Promise<void> {
  const db = await abrirBaseDeDatos();
  await guardarConfig(db, CLAVE_EMPRESA_ERP, empresaId);
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
    productos.map((p) => ({ id: p.id, categoriaId: p.categoriaId, nombre: p.nombre, precioBase: Number(p.precioBase), precioSucursal: p.precioSucursal != null ? Number(p.precioSucursal) : undefined, activo: p.activo, disponibleSucursal: p.disponibleSucursal })),
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
