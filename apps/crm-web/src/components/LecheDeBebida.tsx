"use client";

import { useEffect, useState } from "react";
import type { Producto } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";

type Campo = "lecheBase" | "lecheConColdFoam" | "lecheConShot" | "lecheConAmbos";

const CAMPOS: { campo: Campo; etiqueta: string; ayuda: string }[] = [
  { campo: "lecheBase", etiqueta: "Sola", ayuda: "Sin cold foam ni shot extra" },
  { campo: "lecheConColdFoam", etiqueta: "Con cold foam", ayuda: "Vacío = igual que sola" },
  { campo: "lecheConShot", etiqueta: "Con shot extra", ayuda: "Vacío = igual que sola" },
  { campo: "lecheConAmbos", etiqueta: "Con ambos", ayuda: "Vacío = como con cold foam" },
];

const aTexto = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/**
 * Gramos de leche de la bebida según su hoja de receta. La opción de "Tipo de leche" elegida dice
 * QUÉ leche baja; esto dice CUÁNTA. Vacío = se usa la cantidad de la opción (240 g).
 */
export function LecheDeBebida({ producto, onGuardado }: { producto: Producto; onGuardado: (p: Producto) => void }) {
  const inicial = () => Object.fromEntries(CAMPOS.map(({ campo }) => [campo, aTexto(producto[campo])])) as Record<Campo, string>;
  const [valores, setValores] = useState<Record<Campo, string>>(inicial);
  const [estado, setEstado] = useState<"" | "guardando" | "listo" | "error">("");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setValores(inicial()); setEstado(""); }, [producto.id]);

  async function guardar() {
    setEstado("guardando");
    const datos = Object.fromEntries(
      CAMPOS.map(({ campo }) => [campo, valores[campo].trim() === "" ? null : Number(valores[campo])]),
    ) as Record<Campo, number | null>;
    try {
      await apiFetch(`/catalogo/productos/${producto.id}`, { method: "PATCH", body: JSON.stringify(datos) });
      onGuardado({ ...producto, ...datos });
      setEstado("listo");
    } catch {
      setEstado("error");
    }
  }

  return (
    <div style={{ marginTop: 22, borderTop: "2px solid var(--h421-gray-200)", paddingTop: 14 }}>
      <h4 style={{ margin: "0 0 4px" }}>🥛 Leche de esta bebida (g)</h4>
      <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "0 0 10px" }}>
        Cuánta leche baja del inventario según la hoja de receta. La leche que eligió el cliente (Entera, Avena…) se respeta;
        aquí solo se ajusta la cantidad. Vacío en <em>Sola</em> = se usa la cantidad de la opción de leche.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
        {CAMPOS.map(({ campo, etiqueta, ayuda }) => (
          <label key={campo} style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontWeight: 600 }}>{etiqueta}</span>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={valores[campo]}
              placeholder="—"
              onChange={(e) => { setValores((v) => ({ ...v, [campo]: e.target.value })); setEstado(""); }}
              style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}
            />
            <span style={{ color: "var(--h421-gray-400)", fontSize: 11 }}>{ayuda}</span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button onClick={guardar} disabled={estado === "guardando"} style={{ background: "var(--h421-green)", color: "#fff", padding: "6px 14px" }}>
          {estado === "guardando" ? "Guardando…" : "Guardar leche"}
        </button>
        {estado === "listo" && <span style={{ fontSize: 12, color: "var(--h421-green)" }}>Guardado ✓</span>}
        {estado === "error" && <span style={{ fontSize: 12, color: "var(--h421-red-texto)" }}>No se pudo guardar</span>}
      </div>
    </div>
  );
}
