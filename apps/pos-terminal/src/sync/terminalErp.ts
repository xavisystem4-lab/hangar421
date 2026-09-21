import { abrirBaseDeDatos } from "../db/database";
import { erpFetch, guardarTokensErp, obtenerTokensErp } from "../api/erpHttp";
import { decodificarJwt } from "../auth/jwt";
import { obtenerSucursalErp } from "../db/dispositivoLocal";
import {
  aplicarPreciosDeSucursal,
  esTerminalMultisucursal,
  guardarContextoTerminal,
  guardarPreciosSucursal,
  type ContextoTerminal,
  type PrecioSucursal,
} from "../db/multisucursalRepo";

/**
 * Parte en línea de la terminal multisucursal (código de empresa). Todo best-effort: sin red la
 * tablet sigue funcionando con lo último que guardó; esto solo lo actualiza.
 */

/** Trae del ERP las sucursales de la terminal, quién tiene asignada cada una y los precios de
 *  todas, y deja aplicados los de la sucursal activa. No hace nada en una terminal de una sola
 *  sucursal. */
export async function refrescarTerminalMultisucursal(): Promise<void> {
  const db = await abrirBaseDeDatos();
  if (!(await esTerminalMultisucursal(db)) || !(await obtenerTokensErp())) return;

  const [contexto, precios] = await Promise.all([
    erpFetch<ContextoTerminal>("/auth/terminal/contexto"),
    erpFetch<PrecioSucursal[]>("/auth/terminal/precios"),
  ]);
  await guardarContextoTerminal(db, contexto);
  await guardarPreciosSucursal(db, precios);
  const activa = await obtenerSucursalErp(db);
  if (activa) await aplicarPreciosDeSucursal(db, activa);
}

/**
 * Deja la sesión de la terminal con el ERP en la sucursal activa de la tablet.
 *
 * El token lleva UNA sucursal activa y el ERP rechaza (403) pedir el catálogo, el inventario o
 * las mesas de otra. Si la persona cambió de sucursal sin conexión, el token quedó en la
 * anterior: antes de consultar se mueve con `switch-sucursal`, que el ERP revalida contra las
 * sucursales de la terminal. Las ventas no dependen de esto: cada una viaja con su sucursal.
 */
export async function asegurarSesionEnSucursalActiva(): Promise<void> {
  const db = await abrirBaseDeDatos();
  const [activa, tokens] = await Promise.all([obtenerSucursalErp(db), obtenerTokensErp()]);
  if (!activa || !tokens) return;
  const { sucursalId } = decodificarJwt<{ sucursalId?: string }>(tokens.accessToken);
  if (sucursalId === activa) return;
  const sesion = await erpFetch<{ accessToken: string; refreshToken: string }>("/auth/switch-sucursal", {
    method: "POST",
    body: JSON.stringify({ sucursalId: activa }),
  });
  await guardarTokensErp(sesion.accessToken, sesion.refreshToken);
}

/** Primera entrada de una persona del ERP en esta tablet: valida su PIN en línea. */
export async function verificarPinEnErp(usuarioId: string, pin: string) {
  return erpFetch<{ id: string; nombre: string; sucursales: { sucursalId: string; rol: string }[] }>("/auth/terminal/verificar-pin", {
    method: "POST",
    body: JSON.stringify({ usuarioId, pin }),
  });
}
