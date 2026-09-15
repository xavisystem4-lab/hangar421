import type { ConfigTicket } from "@hangar421/shared";
import { CONFIG_TICKET_DEFAULT } from "@hangar421/shared";
import { apiFetch } from "../api/http";

export interface ContextoTicket {
  config: ConfigTicket;
  empresaNombre: string;
  logoUrl: string | null;
  sucursalNombre: string;
}

function clave(sucursalId: string) {
  return `hangar421_contexto_ticket_${sucursalId}`;
}

/** Trae la plantilla de ticket + nombre de empresa/sucursal desde el backend y la cachea en
 *  localStorage (mismo patrón que `hangar421_tasa_impuesto` en orderStore) — si no hay conexión
 *  al imprimir, se usa el último contexto cacheado en vez de fallar la impresión por completo. */
export async function obtenerContextoTicket(sucursalId: string, empresaId: string): Promise<ContextoTicket> {
  try {
    const [sucursal, empresa] = await Promise.all([
      apiFetch<{ nombre: string; configJson?: { ticket?: ConfigTicket } }>(`/sucursales/${sucursalId}`),
      apiFetch<{ nombre: string; logoUrl: string | null }>(`/empresas/${empresaId}`),
    ]);
    const contexto: ContextoTicket = {
      config: { ...CONFIG_TICKET_DEFAULT, ...sucursal.configJson?.ticket },
      empresaNombre: empresa.nombre,
      logoUrl: empresa.logoUrl,
      sucursalNombre: sucursal.nombre,
    };
    localStorage.setItem(clave(sucursalId), JSON.stringify(contexto));
    return contexto;
  } catch {
    const cacheado = localStorage.getItem(clave(sucursalId));
    if (cacheado) return JSON.parse(cacheado);
    return { config: CONFIG_TICKET_DEFAULT, empresaNombre: "", logoUrl: null, sucursalNombre: "" };
  }
}
