"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

/** Respuesta de GET /auth/codigos-vinculacion/:codigo/estado. */
interface EstadoCodigo {
  estado: "PENDIENTE" | "VINCULADO" | "EXPIRADO";
  usadoAt: string | null;
  terminal: string | null;
  sucursal: string | null;
}

/** Cada cuánto se pregunta al ERP si la terminal ya canjeó el código. Corto para que la
 *  confirmación aparezca casi al instante; solo corre mientras el código está a la vista y
 *  pendiente, así que son a lo mucho unas cuantas consultas por enlace. */
const CONSULTA_MS = 3_000;

/**
 * Código de vinculación a la vista del admin, con la confirmación del ERP.
 *
 * Mientras está pendiente consulta su estado; en cuanto la terminal lo canjea cambia a
 * "Terminal enlazada" con el nombre del equipo, la sucursal y la hora, y avisa a la página
 * (`onVinculado`) para que refresque la lista de terminales. Antes el código se quedaba en
 * pantalla igual que si nadie lo hubiera usado y no había forma de saber si la tablet lo tomó.
 */
export function CodigoVinculacion({
  codigo,
  expiraAt,
  descripcion,
  onVinculado,
}: {
  codigo: string;
  expiraAt: string;
  descripcion?: string;
  onVinculado?: () => void;
}) {
  const [estado, setEstado] = useState<EstadoCodigo | null>(null);
  const [, setTic] = useState(0);
  const terminado = estado?.estado === "VINCULADO" || estado?.estado === "EXPIRADO";

  useEffect(() => {
    setEstado(null);
  }, [codigo]);

  useEffect(() => {
    if (terminado) return;
    let vivo = true;
    async function consultar() {
      try {
        const r = await apiFetch<EstadoCodigo>(`/auth/codigos-vinculacion/${encodeURIComponent(codigo)}/estado`);
        if (!vivo) return;
        setEstado(r);
        if (r.estado === "VINCULADO") onVinculado?.();
      } catch {
        // Un fallo de red puntual no cambia nada: se vuelve a preguntar en la siguiente vuelta.
      }
      if (vivo) setTic((t) => t + 1); // refresca "caduca en N min"
    }
    consultar();
    const t = setInterval(consultar, CONSULTA_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [codigo, terminado]); // eslint-disable-line react-hooks/exhaustive-deps

  const caja = { marginTop: 12, padding: 12, borderRadius: 10, textAlign: "center" as const };

  if (estado?.estado === "VINCULADO") {
    const hora = estado.usadoAt ? new Date(estado.usadoAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : null;
    return (
      <div role="status" style={{ ...caja, background: "var(--h421-green-bg)", border: "1px solid var(--h421-green)" }}>
        <div style={{ fontSize: 26, color: "var(--h421-green)", fontWeight: 800 }}>✓</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--h421-green)" }}>Terminal enlazada</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>
          {estado.terminal ?? "La terminal"} quedó enlazada
          {estado.sucursal ? <> a <strong>{estado.sucursal}</strong></> : descripcion ? <> a <strong>{descripcion}</strong></> : null}
          {hora ? <> a las {hora}</> : null}
          {/* La hora en es-MX ya termina en punto ("a.m."): no se agrega otro. */}
          {hora && /\.$/.test(hora) ? null : "."}
        </div>
        <div style={{ fontSize: 12, color: "var(--h421-gray-400)", marginTop: 4 }}>
          La terminal ya puede trabajar. Para enlazar otra, genera un código nuevo: cada código se usa una sola vez.
        </div>
      </div>
    );
  }

  const minutos = Math.max(0, Math.round((new Date(expiraAt).getTime() - Date.now()) / 60_000));
  const expirado = estado?.estado === "EXPIRADO" || minutos === 0;

  return (
    <div style={{ ...caja, background: "var(--h421-gray-50)" }}>
      <div style={{ fontSize: 11, color: "var(--h421-gray-400)", textTransform: "uppercase", fontWeight: 700 }}>
        Dictar en el Punto de Venta{descripcion ? ` · ${descripcion}` : ""}
      </div>
      {/* Partido en dos mitades y con espaciado: se lee en voz alta y se teclea en una tablet.
          La app acepta el código con o sin el guion. */}
      <div
        style={{
          fontSize: 30, fontWeight: 800, letterSpacing: 4, margin: "6px 0", fontFamily: "monospace",
          textDecoration: expirado ? "line-through" : undefined, opacity: expirado ? 0.5 : 1,
        }}
      >
        {codigo.slice(0, 4)}-{codigo.slice(4)}
      </div>
      <div style={{ fontSize: 12, color: expirado ? "var(--h421-red)" : "var(--h421-gray-400)" }}>
        {expirado ? "Caducó sin usarse · genera uno nuevo" : `Sirve una sola vez · caduca en ${minutos} min`}
      </div>
      {!expirado && (
        <div style={{ fontSize: 12, color: "var(--h421-gray-400)", marginTop: 6 }}>
          Esperando a que la terminal lo teclee…
        </div>
      )}
    </div>
  );
}
