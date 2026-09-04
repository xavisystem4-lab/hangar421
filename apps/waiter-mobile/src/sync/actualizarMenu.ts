import type { CategoriaProducto, Producto } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import * as outbox from "../db/outbox";
import { useAuthStore } from "../store/authStore";
import { guardarMetaMenu, useConexionStore } from "../store/conexionStore";

export interface ResultadoActualizarMenu {
  ok: boolean;
  productos?: number;
  error?: string;
}

/** Trae el catálogo (categorías + productos) REAL desde el servicio/API que corre en la
 *  Estación — no es una descarga manual de archivo: es la misma llamada HTTP autenticada que ya
 *  usa TomaPedidoScreen.tsx al abrir la pantalla de pedido, solo que aquí se dispara a mano
 *  desde el módulo Conexión (botón "Actualizar menú") y deja registrado cuándo fue la última vez
 *  y cuántos productos trajo, para que se pueda ver ese estado sin tener que ir a pedir algo.
 *
 *  Arquitectura real de esta llamada:
 *    APK (fetch) -> Estación: NestJS (`/catalogo/productos`) -> Prisma -> Postgres -> respuesta
 *    JSON -> APK cachea en SQLite local (outbox) para seguir funcionando offline.
 *  El APK nunca toca la base de datos directo — solo habla con la API HTTP del backend. */
export async function actualizarMenu(): Promise<ResultadoActualizarMenu> {
  const auth = useAuthStore.getState();
  if (!auth.usuario || !auth.sucursalId) {
    return { ok: false, error: "Inicia sesión primero — el menú es por sucursal." };
  }

  useConexionStore.setState({ sincronizandoMenu: true });
  try {
    const [categorias, productos] = await Promise.all([
      apiFetch<CategoriaProducto[]>(`/catalogo/categorias?empresaId=${auth.usuario.empresaId}`),
      apiFetch<Producto[]>(`/catalogo/productos?empresaId=${auth.usuario.empresaId}&sucursalId=${auth.sucursalId}`),
    ]);
    await outbox.guardarEnCache("categorias", categorias);
    await outbox.guardarEnCache("productos", productos);
    await guardarMetaMenu(productos.length);
    return { ok: true, productos: productos.length };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "No se pudo actualizar el menú" };
  } finally {
    useConexionStore.setState({ sincronizandoMenu: false });
  }
}
