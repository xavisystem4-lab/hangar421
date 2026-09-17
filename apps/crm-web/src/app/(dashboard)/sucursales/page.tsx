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

  // Edición inline de nombre y dirección — mismo patrón que Catálogo/Inventario: sin modal, se
  // edita en el lugar. Antes no había ninguna forma de corregir estos datos de una sucursal ya
  // creada desde el CRM (el backend sí lo soportaba vía PUT /sucursales/:id, solo faltaba
  // exponerlo aquí — la dirección solo se podía capturar al crear la sucursal, nunca después).
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreBorrador, setNombreBorrador] = useState("");
  const [direccionBorrador, setDireccionBorrador] = useState("");

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

  function empezarEdicion(s: Sucursal) {
    setEditandoId(s.id);
    setNombreBorrador(s.nombre);
    setDireccionBorrador(s.direccion ?? "");
  }

  async function guardarEdicion(id: string) {
    if (!nombreBorrador.trim()) return;
    await apiFetch(`/sucursales/${id}`, {
      method: "PUT",
      body: JSON.stringify({ nombre: nombreBorrador.trim(), direccion: direccionBorrador.trim() }),
    });
    setEditandoId(null);
    cargar();
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Sucursales</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {sucursales.map((s) => (
          <div key={s.id} className="card">
            {editandoId === s.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                <input
                  value={nombreBorrador}
                  onChange={(e) => setNombreBorrador(e.target.value)}
                  autoFocus
                  placeholder="Nombre"
                  style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontSize: 16, fontWeight: 700 }}
                />
                <input
                  value={direccionBorrador}
                  onChange={(e) => setDireccionBorrador(e.target.value)}
                  placeholder="Dirección"
                  style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontSize: 13 }}
                />
              </div>
            ) : (
              <>
                <strong style={{ fontSize: 16 }}>{s.nombre}</strong>
                <p style={{ color: "var(--h421-gray-400)", fontSize: 13, margin: "6px 0" }}>{s.direccion || "Sin dirección capturada"}</p>
              </>
            )}
            <p style={{ fontSize: 13 }}>Horario: {s.horarioApertura ?? "—"} – {s.horarioCierre ?? "—"}</p>
            <p style={{ fontSize: 13 }}>IVA: {(Number(s.tasaImpuesto) * 100).toFixed(0)}%</p>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {editandoId === s.id ? (
                <>
                  <button onClick={() => guardarEdicion(s.id)} style={{ background: "var(--h421-green)", color: "#fff", padding: "6px 12px", fontSize: 13 }}>Guardar</button>
                  <button onClick={() => setEditandoId(null)} style={{ background: "var(--h421-gray-200)", padding: "6px 12px", fontSize: 13 }}>Cancelar</button>
                </>
              ) : (
                <button onClick={() => empezarEdicion(s)} style={{ background: "var(--h421-gray-50)", padding: "6px 12px", fontSize: 13 }}>Editar nombre y dirección</button>
              )}
            </div>
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
