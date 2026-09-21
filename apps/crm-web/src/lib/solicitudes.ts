"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

const EVENTO = "hangar421:solicitudes-cambiaron";
const INTERVALO_MS = 60_000;

/** La pantalla de Solicitudes avisa al menú que cambió algo, para que el contador baje en el
 *  momento en vez de esperar a la siguiente consulta. */
export function avisarCambioSolicitudes() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO));
}

/**
 * Solicitudes de producto pendientes para el contador del menú. Se consulta cada minuto: son
 * pocas y no urgen al segundo. `activo` en false (rol sin acceso) no consulta nada. Un fallo deja
 * el contador en 0 en vez de romper el menú.
 */
export function usarSolicitudesPendientes(activo: boolean, sucursalId: string | null | undefined): number {
  const [pendientes, setPendientes] = useState(0);
  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    const consultar = () => {
      const params = new URLSearchParams();
      if (sucursalId) params.set("sucursalId", sucursalId);
      apiFetch<{ pendientes: number }>(`/solicitudes-producto/resumen?${params}`)
        .then((r) => vigente && setPendientes(r.pendientes))
        .catch(() => vigente && setPendientes(0));
    };
    consultar();
    const intervalo = setInterval(consultar, INTERVALO_MS);
    window.addEventListener(EVENTO, consultar);
    return () => {
      vigente = false;
      clearInterval(intervalo);
      window.removeEventListener(EVENTO, consultar);
    };
  }, [activo, sucursalId]);
  return pendientes;
}
