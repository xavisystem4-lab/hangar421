"use client";

import { useThemeStore } from "@/store/themeStore";

/** Alterna modo día / noche. Vive en la cabecera, junto al chip de sucursal, con su mismo
 *  estilo de píldora; antes estaba al fondo del menú lateral y costaba encontrarlo. */
export function BotonTema() {
  const { tema, alternar } = useThemeStore();
  const oscuro = tema === "oscuro";
  return (
    <button
      onClick={alternar}
      title={oscuro ? "Cambiar a modo día" : "Cambiar a modo noche"}
      aria-label={oscuro ? "Cambiar a modo día" : "Cambiar a modo noche"}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px",
        borderRadius: 10, background: "var(--h421-gray-50)", border: "1px solid var(--h421-gray-200)",
        color: "var(--h421-black)", fontWeight: 600, fontSize: 14, cursor: "pointer",
      }}
    >
      <span aria-hidden>{oscuro ? "☀️" : "🌙"}</span>
      <span>{oscuro ? "Modo día" : "Modo noche"}</span>
    </button>
  );
}
