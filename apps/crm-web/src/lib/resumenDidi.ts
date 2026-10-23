"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ReporteDidi } from "@/lib/exportarVentas";

export type ResumenDidi = ReporteDidi["resumen"];

/**
 * Lo vendido en DiDi y la ganancia real del rango, para la tarjeta de Ventas y de Reportes.
 * null mientras carga o si el servidor todavía no tiene el reporte (no rompe la pantalla).
 */
export function useResumenDidi(sucursalId: string | null | undefined, desde: string, hasta: string, refresco?: unknown): ResumenDidi | null {
  const [resumen, setResumen] = useState<ResumenDidi | null>(null);
  useEffect(() => {
    const q = new URLSearchParams({ desde, hasta });
    if (sucursalId) q.set("sucursalId", sucursalId);
    let vigente = true;
    apiFetch<ReporteDidi>(`/reportes/didi?${q}`)
      .then((r) => { if (vigente) setResumen(r.resumen); })
      .catch(() => { if (vigente) setResumen(null); });
    return () => { vigente = false; };
  }, [sucursalId, desde, hasta, refresco]);
  return resumen;
}

const dinero = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Tarjeta "Vendido en DiDi" con la ganancia real debajo y enlace al reporte completo. */
export function textoTarjetaDidi(r: ResumenDidi) {
  return {
    valor: dinero(r.pagadoCliente),
    detalle: `${r.tickets} pedido${r.tickets === 1 ? "" : "s"} · ganancia real ${dinero(r.neto)} (${r.porcentajeNeto.toFixed(0)}%)`,
  };
}
