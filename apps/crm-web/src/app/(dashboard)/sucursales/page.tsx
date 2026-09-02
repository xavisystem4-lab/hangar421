"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";

interface Sucursal {
  id: string;
  nombre: string;
  direccion?: string;
  horarioApertura?: string;
  horarioCierre?: string;
  tasaImpuesto: number;
  activo: boolean;
}

export default function SucursalesPage() {
  const { contexto } = useAuthCrm();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: "", direccion: "" });

  async function cargar() {
    if (!contexto) return;
    const data = await apiFetch<Sucursal[]>(`/sucursales?empresaId=${contexto.usuario.empresaId}`);
    setSucursales(data);
  }

  useEffect(() => { cargar(); }, [contexto]); // eslint-disable-line react-hooks/exhaustive-deps

  async function crear() {
    if (!contexto || !nuevo.nombre) return;
    await apiFetch("/sucursales", {
      method: "POST",
      body: JSON.stringify({ empresaId: contexto.usuario.empresaId, nombre: nuevo.nombre, direccion: nuevo.direccion }),
    });
    setNuevo({ nombre: "", direccion: "" });
    cargar();
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Sucursales</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {sucursales.map((s) => (
          <div key={s.id} className="card">
            <strong style={{ fontSize: 16 }}>{s.nombre}</strong>
            <p style={{ color: "var(--h421-gray-400)", fontSize: 13, margin: "6px 0" }}>{s.direccion}</p>
            <p style={{ fontSize: 13 }}>Horario: {s.horarioApertura ?? "—"} – {s.horarioCierre ?? "—"}</p>
            <p style={{ fontSize: 13 }}>IVA: {(Number(s.tasaImpuesto) * 100).toFixed(0)}%</p>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 20, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Nueva sucursal</h3>
        <input placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))}
          style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        <input placeholder="Dirección" value={nuevo.direccion} onChange={(e) => setNuevo((n) => ({ ...n, direccion: e.target.value }))}
          style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        <button onClick={crear} style={{ background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>Crear sucursal</button>
      </div>
    </div>
  );
}
