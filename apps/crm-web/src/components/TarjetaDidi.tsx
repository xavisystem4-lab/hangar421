"use client";

import { textoTarjetaDidi, type ResumenDidi } from "@/lib/resumenDidi";

/** "🛵 Vendido en DiDi": lo que pagaron los clientes y, debajo, la ganancia real para el negocio. */
export function TarjetaDidi({ resumen, onVerReporte }: { resumen: ResumenDidi; onVerReporte?: () => void }) {
  const t = textoTarjetaDidi(resumen);
  return (
    <div className="card" style={{ minWidth: 200, borderTop: "4px solid #FF6A13" }}>
      <div style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>🛵 Vendido en DiDi</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: "var(--h421-navy-texto)" }}>{t.valor}</div>
      <div style={{ fontSize: 12, color: "var(--h421-green)", fontWeight: 700, marginTop: 2 }}>{t.detalle}</div>
      {onVerReporte && (
        <button onClick={onVerReporte} style={{ background: "transparent", border: 0, padding: 0, marginTop: 4, fontSize: 12, color: "var(--h421-blue)", textDecoration: "underline" }}>
          Ver reporte de DiDi →
        </button>
      )}
    </div>
  );
}
