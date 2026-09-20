"use client";

import { create } from "zustand";
import { RolUsuario, type AccesoSucursal } from "@hangar421/shared";
import { apiFetch, guardarRefreshToken, guardarToken } from "@/lib/api";

const CLAVE = "hangar421_crm_sucursal_activa";

/** `null` = consolidado ("Todas las sucursales"). Solo ADMIN_CORPORATIVO puede estar aquí. */
export interface SeleccionSucursal {
  sucursalId: string | null;
  nombre: string;
}

interface SucursalActivaState {
  seleccion: SeleccionSucursal | null;
  cambiando: boolean;
  error: string | null;
  /** Opciones traídas del backend. `null` = todavía no se consultaron. */
  opciones: AccesoSucursal[] | null;
  cargandoOpciones: boolean;
  /** Lee lo guardado. `null` obliga a elegir antes de mostrar nada. */
  cargar: () => void;
  /** Pide al backend las sucursales que este usuario puede ver AHORA. */
  refrescarOpciones: () => Promise<void>;
  elegir: (opcion: SeleccionSucursal, esCorporativo: boolean) => Promise<void>;
  limpiar: () => void;
}

/**
 * Sucursal con la que se está trabajando en el ERP, global y persistente.
 *
 * Antes cada página tenía su propio `<select>` de sucursal: al navegar de Catálogo a Inventario
 * la elección se perdía y era fácil acabar mirando datos de otra sucursal sin darse cuenta.
 *
 * Se guarda en localStorage para que sobreviva a recargar la página. Se limpia al cerrar sesión
 * (ver authClient.logout): la siguiente persona que entre debe elegir a conciencia, no heredar
 * el contexto de quien usó el equipo antes.
 */
export const useSucursalActiva = create<SucursalActivaState>((set) => ({
  seleccion: null,
  cambiando: false,
  error: null,
  opciones: null,
  cargandoOpciones: false,

  cargar: () => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(CLAVE);
    set({ seleccion: raw ? JSON.parse(raw) : null });
  },

  // Se consulta cada vez que se abre el selector, no una sola vez al entrar: es lo que hace que
  // una sucursal recién dada de alta aparezca sin cerrar sesión.
  refrescarOpciones: async () => {
    set({ cargandoOpciones: true });
    try {
      const lista = await apiFetch<AccesoSucursal[]>("/sucursales/mias");
      set({ opciones: lista, cargandoOpciones: false });
    } catch (e: any) {
      // No se limpian las opciones que ya hubiera: un fallo de red no debe dejar al usuario sin
      // poder elegir nada si ya tenía la lista.
      set({ error: e?.message ?? "No se pudieron cargar las sucursales", cargandoOpciones: false });
    }
  },

  elegir: async (opcion, esCorporativo) => {
    set({ cambiando: true, error: null });
    try {
      // Un ADMIN_CORPORATIVO está exento de SucursalAccessGuard, así que puede consultar
      // cualquier sucursal de su empresa (y el consolidado) sin reemitir el token.
      //
      // El resto NO: el guard compara contra el `sucursalId` del JWT, así que cambiar de
      // sucursal exige un token nuevo. Si no se hiciera, la página se llenaría de 403 y
      // parecería un fallo de permisos en vez de un cambio de contexto.
      if (!esCorporativo && opcion.sucursalId) {
        const resp = await apiFetch<{ accessToken: string; refreshToken: string }>("/auth/switch-sucursal", {
          method: "POST",
          body: JSON.stringify({ sucursalId: opcion.sucursalId }),
        });
        guardarToken(resp.accessToken);
        guardarRefreshToken(resp.refreshToken);
      }

      localStorage.setItem(CLAVE, JSON.stringify(opcion));
      set({ seleccion: opcion });
    } catch (e: any) {
      set({ error: e?.message ?? "No se pudo cambiar de sucursal" });
      throw e;
    } finally {
      set({ cambiando: false });
    }
  },

  limpiar: () => {
    if (typeof window !== "undefined") localStorage.removeItem(CLAVE);
    set({ seleccion: null, error: null, opciones: null });
  },
}));

/** Opciones que puede elegir este usuario: las sucursales a las que tiene acceso, más el
 *  consolidado si es corporativo.
 *
 *  La lista viene de `GET /sucursales/mias`, que el backend calcula en vivo contra
 *  UsuarioSucursal (o contra todas las de la empresa si es corporativo). Antes se armaba con
 *  `usuario.sucursales` del login, que quedaba congelado en localStorage: una sucursal creada
 *  después no aparecía hasta cerrar y volver a abrir sesión. Sigue sin poder ofrecer una
 *  sucursal a la que el backend respondería 403 — lo que se ve es lo que se puede consultar. */
export function opcionesDisponibles(sucursales: AccesoSucursal[], rol: string): SeleccionSucursal[] {
  const propias = sucursales.map((s) => ({ sucursalId: s.sucursalId, nombre: s.nombre || "Sucursal" }));
  const esCorporativo = rol === RolUsuario.ADMIN_CORPORATIVO;
  // El consolidado solo tiene sentido con más de una sucursal, y solo para quien puede leerlas
  // todas sin chocar con el guard.
  if (esCorporativo && propias.length > 1) {
    return [...propias, { sucursalId: null, nombre: "Todas las sucursales" }];
  }
  return propias;
}
