import { useEffect, useState } from "react";
import { diasDeTurnoAbierto } from "@hangar421/shared";
import { apiFetch } from "../api/http";

interface TurnoPendiente {
  id: string;
  fechaApertura: string;
  sucursal: { id: string; nombre: string };
  caja: { id: string; nombre: string };
  usuario: { id: string; nombre: string };
}

/** Cada cuánto se vuelve a consultar mientras el POS sigue abierto: el cambio de día ocurre con
 *  la app abierta (un turno que se olvidó cerrar a las 23:00 pasa a "pendiente" a medianoche). */
const INTERVALO_MS = 10 * 60_000;

/**
 * Aviso de turno de caja sin cerrar desde un día anterior, al iniciar operaciones.
 *
 * Solo avisa, no bloquea (decisión del negocio): mientras siga abierto, las ventas nuevas se
 * suman a ese mismo corte, así que quien abre la tienda tiene que saberlo. Muestra sucursal,
 * fecha de apertura, responsable y turno (caja). "Entendido" lo oculta hasta el próximo inicio de
 * sesión o la siguiente consulta; "Ir a Caja" lleva a donde se cierra.
 *
 * Se vuelve a consultar al cambiar de pantalla: al volver de Caja después de cerrarlo, desaparece.
 */
export function AvisoTurnoPendiente({
  sucursalId,
  pantalla,
  onIrACaja,
}: {
  sucursalId: string;
  pantalla: string;
  onIrACaja: () => void;
}) {
  const [pendientes, setPendientes] = useState<TurnoPendiente[]>([]);
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vigente = true;
    const consultar = () =>
      apiFetch<TurnoPendiente[]>(`/caja/turnos/pendientes?sucursalId=${sucursalId}`)
        .then((t) => vigente && setPendientes(t))
        // Un backend anterior a este endpoint o un fallo de red no deben romper la pantalla.
        .catch(() => undefined);
    consultar();
    const intervalo = setInterval(consultar, INTERVALO_MS);
    return () => {
      vigente = false;
      clearInterval(intervalo);
    };
  }, [sucursalId, pantalla]);

  const visibles = pendientes.filter((t) => !ocultos.has(t.id));
  if (visibles.length === 0) return null;

  return (
    <div role="alert" style={{ background: "var(--h421-red-bg)", borderBottom: "2px solid var(--h421-red)", padding: "10px 16px" }}>
      {visibles.map((t) => {
        const dias = diasDeTurnoAbierto(t.fechaApertura);
        return (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", color: "var(--h421-red-texto)" }}>
            <strong style={{ fontSize: 15 }}>⚠ Turno sin cerrar {dias <= 1 ? "desde ayer" : `desde hace ${dias} días`}</strong>
            <span style={{ fontSize: 14 }}>
              {t.sucursal.nombre} · {t.caja.nombre} · abierto el{" "}
              {new Date(t.fechaApertura).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}{" "}
              · responsable: <strong>{t.usuario.nombre}</strong>
            </span>
            <span style={{ flex: 1 }} />
            {pantalla !== "caja" && (
              <button onClick={onIrACaja} style={{ padding: "8px 14px", background: "var(--h421-red)", color: "#fff", fontWeight: 700, borderRadius: 8 }}>
                Ir a Caja para cerrarlo
              </button>
            )}
            <button
              onClick={() => setOcultos((o) => new Set(o).add(t.id))}
              style={{ padding: "8px 14px", background: "transparent", color: "var(--h421-red-texto)", border: "1px solid var(--h421-red)", borderRadius: 8 }}
            >
              Entendido
            </button>
          </div>
        );
      })}
    </div>
  );
}
