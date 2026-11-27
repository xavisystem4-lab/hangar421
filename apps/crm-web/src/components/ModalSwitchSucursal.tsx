"use client";

import { useEffect, useState } from "react";
import type { Sucursal } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";

/**
 * ERP → Usuarios → 🔁 SWITCH: intercambiar de sucursal a dos empleadas, o mover a una sola.
 * Se van con su rol, turno, permisos, horarios y crédito de empleado. El backend no lo permite si
 * alguna tiene un turno de caja abierto.
 */

interface Fila {
  usuarioId: string;
  sucursalId: string;
  rol: string;
  usuario: { id: string; nombre: string; username: string | null; activo: boolean };
}

const ETIQUETA_ROL: Record<string, string> = {
  ADMIN_CORPORATIVO: "Admin. corporativo", ADMIN_SUCURSAL: "Admin. sucursal", SUPERVISOR: "Supervisor", CAJERO: "Cajero", MESERO: "Mesero", COCINA: "Cocina",
};
const selectStyle: React.CSSProperties = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" };

/** Empleadas reales de la sucursal: activas y sin los usuarios internos de las terminales. */
async function personasDe(sucursalId: string): Promise<Fila[]> {
  if (!sucursalId) return [];
  const filas = await apiFetch<Fila[]>(`/usuarios?sucursalId=${sucursalId}`).catch(() => []);
  return filas
    .filter((f) => f.usuario.activo && !(f.usuario.username ?? "").startsWith("terminal."))
    .sort((a, b) => a.usuario.nombre.localeCompare(b.usuario.nombre, "es"));
}

export function ModalSwitchSucursal({ sucursales, sucursalInicial, onCerrar, onHecho }: {
  sucursales: Sucursal[];
  sucursalInicial: string;
  onCerrar: () => void;
  onHecho: (movimientos: string[]) => void;
}) {
  const [sucA, setSucA] = useState(sucursalInicial || sucursales[0]?.id || "");
  const [sucB, setSucB] = useState(() => sucursales.find((s) => s.id !== (sucursalInicial || sucursales[0]?.id))?.id ?? "");
  const [personasA, setPersonasA] = useState<Fila[]>([]);
  const [personasB, setPersonasB] = useState<Fila[]>([]);
  const [usuarioA, setUsuarioA] = useState("");
  const [usuarioB, setUsuarioB] = useState(""); // "" = solo mover
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setUsuarioA(""); personasDe(sucA).then(setPersonasA); }, [sucA]);
  useEffect(() => { setUsuarioB(""); personasDe(sucB).then(setPersonasB); }, [sucB]);

  const nombreSuc = (id: string) => sucursales.find((s) => s.id === id)?.nombre ?? "";
  const a = personasA.find((p) => p.usuarioId === usuarioA);
  const b = personasB.find((p) => p.usuarioId === usuarioB);
  const listo = !!a && !!sucB && sucA !== sucB;

  async function aplicar() {
    if (!listo) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch<{ movimientos: string[] }>("/usuarios/switch", {
        method: "POST",
        body: JSON.stringify({ usuarioAId: usuarioA, sucursalAId: sucA, sucursalBId: sucB, usuarioBId: usuarioB || null }),
      });
      onHecho(r.movimientos);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo hacer el cambio.");
    } finally {
      setGuardando(false);
    }
  }

  // Función (no componente) para que React no vuelva a montar los selects en cada render.
  const columna = ({ titulo, suc, setSuc, personas, valor, setValor, opcional }: {
    titulo: string; suc: string; setSuc: (v: string) => void; personas: Fila[]; valor: string; setValor: (v: string) => void; opcional?: boolean;
  }) => (
    <div className="card" style={{ flex: 1, minWidth: 220, margin: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--h421-gray-400)", marginBottom: 6 }}>{titulo}</div>
      <select value={suc} onChange={(e) => setSuc(e.target.value)} style={{ ...selectStyle, marginBottom: 8, fontWeight: 700 }}>
        {sucursales.map((s) => <option key={s.id} value={s.id}>🏪 {s.nombre}</option>)}
      </select>
      <select value={valor} onChange={(e) => setValor(e.target.value)} style={selectStyle}>
        <option value="">{opcional ? "— Nadie (solo mover) —" : "— Elige a la persona —"}</option>
        {personas.map((p) => <option key={p.usuarioId} value={p.usuarioId}>{p.usuario.nombre} · {ETIQUETA_ROL[p.rol] ?? p.rol}</option>)}
      </select>
      {personas.length === 0 && <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "6px 0 0" }}>No hay personal activo en esta sucursal.</p>}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div className="card" style={{ width: 620, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>🔁 SWITCH de sucursal</h2>
          <button onClick={onCerrar} style={{ background: "none", fontSize: 20 }}>✕</button>
        </div>
        <p style={{ fontSize: 13, color: "var(--h421-gray-400)", marginTop: 0 }}>
          Intercambia a dos personas de sucursal, o mueve a una sola. Se van con su rol, permisos, horarios y crédito de empleado. Las tablets lo toman en su siguiente sincronización.
        </p>

        <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
          {columna({ titulo: "PERSONA 1", suc: sucA, setSuc: setSucA, personas: personasA, valor: usuarioA, setValor: setUsuarioA })}
          <div style={{ display: "flex", alignItems: "center", fontSize: 26 }}>⇄</div>
          {columna({ titulo: "SE VA A / INTERCAMBIA CON", suc: sucB, setSuc: setSucB, personas: personasB, valor: usuarioB, setValor: setUsuarioB, opcional: true })}
        </div>

        {sucA === sucB && <p style={{ color: "var(--h421-red)", fontSize: 13 }}>Elige dos sucursales distintas.</p>}

        {listo && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "rgba(232,163,61,0.12)", border: "1px solid var(--h421-amber)", fontSize: 14 }}>
            <div><strong>{a!.usuario.nombre}</strong>: {nombreSuc(sucA)} → <strong>{nombreSuc(sucB)}</strong></div>
            {b && <div><strong>{b.usuario.nombre}</strong>: {nombreSuc(sucB)} → <strong>{nombreSuc(sucA)}</strong></div>}
          </div>
        )}

        {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

        <button disabled={!listo || guardando} onClick={aplicar}
          style={{ width: "100%", marginTop: 12, background: "var(--h421-navy)", color: "#fff", padding: "12px 16px", fontWeight: 800, opacity: !listo || guardando ? 0.5 : 1 }}>
          {guardando ? "Aplicando…" : b ? "🔁 Hacer SWITCH" : "Mover de sucursal"}
        </button>
      </div>
    </div>
  );
}
