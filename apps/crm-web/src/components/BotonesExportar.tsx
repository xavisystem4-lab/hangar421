"use client";

import { useState } from "react";

/** Botones "Exportar PDF" / "Exportar Excel" con su estado de "Generando…" y el error a la vista. */
export function BotonesExportar({ onPdf, onExcel, deshabilitado }: { onPdf: () => Promise<void>; onExcel: () => Promise<void>; deshabilitado?: boolean }) {
  const [generando, setGenerando] = useState<"pdf" | "excel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function correr(tipo: "pdf" | "excel", fn: () => Promise<void>) {
    setGenerando(tipo);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo generar el archivo.");
    } finally {
      setGenerando(null);
    }
  }

  const apagado = deshabilitado || !!generando;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button onClick={() => correr("pdf", onPdf)} disabled={apagado} title="Descargar en PDF"
        style={{ background: "transparent", color: "var(--h421-red-texto, #b91c1c)", border: "1px solid currentColor", padding: "8px 14px", fontSize: 13, fontWeight: 700, opacity: apagado ? 0.6 : 1 }}>
        {generando === "pdf" ? "Generando…" : "📄 Exportar PDF"}
      </button>
      <button onClick={() => correr("excel", onExcel)} disabled={apagado} title="Descargar en Excel"
        style={{ background: "transparent", color: "var(--h421-green)", border: "1px solid var(--h421-green)", padding: "8px 14px", fontSize: 13, fontWeight: 700, opacity: apagado ? 0.6 : 1 }}>
        {generando === "excel" ? "Generando…" : "📊 Exportar Excel"}
      </button>
      {error && <span style={{ color: "var(--h421-red)", fontSize: 12 }}>{error}</span>}
    </span>
  );
}
