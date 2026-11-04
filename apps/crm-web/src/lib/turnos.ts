"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

/** Turno de caja como lo devuelve /caja/turnos. */
export interface TurnoCaja {
  id: string;
  estado: "ABIERTO" | "CERRADO";
  fechaApertura: string;
  fechaCierre: string | null;
  sucursal: { id: string; nombre: string };
  caja: { id: string; nombre: string };
  usuario: { id: string; nombre: string };
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

/** "de la mañana / tarde / noche" según la hora en que abrió. */
function momento(iso: string): string {
  const h = new Date(iso).getHours();
  return h < 12 ? "de la mañana" : h < 18 ? "de la tarde" : "de la noche";
}

/** "Turno de la mañana · 07:57–15:33 · Andrea" / "🟢 En curso · 15:36–ahora · Daniela". */
export function etiquetaTurno(t: TurnoCaja, conSucursal: boolean, conFecha: boolean): string {
  const fecha = conFecha ? `${new Date(t.fechaApertura).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit" })} ` : "";
  const rango = `${hora(t.fechaApertura)}–${t.fechaCierre ? hora(t.fechaCierre) : "ahora"}`;
  const estado = t.estado === "ABIERTO" ? "🟢 En curso" : `Turno ${momento(t.fechaApertura)}`;
  return `${estado} · ${fecha}${rango} · ${t.usuario?.nombre ?? "—"}${conSucursal ? ` · ${t.sucursal?.nombre ?? ""}` : ""}`;
}

/** Turnos de caja del rango (y los que siguen abiertos desde antes), del más antiguo al más nuevo. */
export function useTurnosDelRango(activo: boolean, sucursalId: string | null | undefined, desde: string, hasta: string): TurnoCaja[] {
  const [turnos, setTurnos] = useState<TurnoCaja[]>([]);
  useEffect(() => {
    if (!activo) return;
    const q = new URLSearchParams({ desde, hasta });
    if (sucursalId) q.set("sucursalId", sucursalId);
    let vigente = true;
    apiFetch<{ items: TurnoCaja[]; pendientes: TurnoCaja[] }>(`/caja/turnos?${q}`)
      .then((r) => {
        if (!vigente) return;
        const todos = new Map<string, TurnoCaja>();
        for (const t of [...(r.pendientes ?? []), ...(r.items ?? [])]) todos.set(t.id, t);
        setTurnos([...todos.values()].sort((a, b) => a.fechaApertura.localeCompare(b.fechaApertura)));
      })
      .catch(() => { if (vigente) setTurnos([]); });
    return () => { vigente = false; };
  }, [activo, sucursalId, desde, hasta]);
  return turnos;
}
