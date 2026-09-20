"use client";

import { useEffect, useState } from "react";
import { useAuthCrm } from "@/lib/authClient";
import { suscribirEstadoConexion } from "@/lib/realtime";

/**
 * Dice si la pantalla se está actualizando sola o no.
 *
 * Existe porque el fallo anterior era invisible: el socket no conectaba (apuntaba a localhost),
 * el REST sí funcionaba, y la página se veía perfectamente bien mientras las ventas nuevas
 * nunca aparecían. Sin un indicador, "no llega la venta" y "no hay ventas" se ven igual.
 */
export function IndicadorEnVivo({ actualizadoEn }: { actualizadoEn?: Date | null }) {
  const { contexto } = useAuthCrm();
  const [enLinea, setEnLinea] = useState(false);

  useEffect(() => {
    if (!contexto) return;
    return suscribirEstadoConexion(contexto.usuario.empresaId, setEnLinea);
  }, [contexto]);

  return (
    <span
      title={
        enLinea
          ? "Las ventas nuevas aparecen solas, sin recargar."
          : "Sin conexión en vivo con el servidor. Usa Actualizar para ver los datos más recientes."
      }
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 12, fontWeight: 700,
        color: enLinea ? "var(--h421-green)" : "var(--h421-gray-400)",
      }}
    >
      <span style={{ fontSize: 10 }}>{enLinea ? "●" : "○"}</span>
      {enLinea ? "En vivo" : "Sin conexión en vivo"}
      {actualizadoEn && (
        <span style={{ fontWeight: 400, color: "var(--h421-gray-400)" }}>
          · {actualizadoEn.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      )}
    </span>
  );
}
