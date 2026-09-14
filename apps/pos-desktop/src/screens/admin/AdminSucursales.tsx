import { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";

interface Sucursal {
  id: string;
  nombre: string;
  direccion?: string | null;
  horarioApertura?: string | null;
  horarioCierre?: string | null;
  tasaImpuesto: number;
  activo: boolean;
}

/** Alta y edición de sucursales — mismo módulo que apps/crm-web/sucursales, dentro del propio
 *  POS. El backend ya soportaba editar (PUT /sucursales/:id); antes no había ninguna pantalla
 *  en el POS para llegar a esa acción, ni para dar de alta una sucursal nueva. */
export function AdminSucursales() {
  const { usuario } = useAuthStore();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: "", direccion: "" });

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreBorrador, setNombreBorrador] = useState("");

  async function cargar() {
    if (!usuario) return;
    const data = await apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuario.empresaId}`);
    setSucursales(data);
  }

  useEffect(() => { cargar(); }, [usuario]); // eslint-disable-line react-hooks/exhaustive-deps

  async function crear() {
    if (!usuario || !nuevo.nombre) return;
    await apiFetch("/sucursales", {
      method: "POST",
      body: JSON.stringify({ empresaId: usuario.empresaId, nombre: nuevo.nombre, direccion: nuevo.direccion }),
    });
    setNuevo({ nombre: "", direccion: "" });
    cargar();
  }

  function empezarEdicion(s: Sucursal) {
    setEditandoId(s.id);
    setNombreBorrador(s.nombre);
  }

  async function guardarNombre(id: string) {
    if (!nombreBorrador.trim()) return;
    await apiFetch(`/sucursales/${id}`, { method: "PUT", body: JSON.stringify({ nombre: nombreBorrador.trim() }) });
    setEditandoId(null);
    cargar();
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 12px" }}>Sucursales</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {sucursales.map((s) => (
          <div key={s.id} className="card">
            {editandoId === s.id ? (
              <input
                value={nombreBorrador}
                onChange={(e) => setNombreBorrador(e.target.value)}
                autoFocus
                style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontSize: 16, fontWeight: 700 }}
              />
            ) : (
              <strong style={{ fontSize: 16 }}>{s.nombre}</strong>
            )}
            <p style={{ color: "var(--h421-gray-400)", fontSize: 13, margin: "6px 0" }}>{s.direccion}</p>
            <p style={{ fontSize: 13 }}>Horario: {s.horarioApertura ?? "—"} – {s.horarioCierre ?? "—"}</p>
            <p style={{ fontSize: 13 }}>IVA: {(Number(s.tasaImpuesto) * 100).toFixed(0)}%</p>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {editandoId === s.id ? (
                <>
                  <button onClick={() => guardarNombre(s.id)} style={{ background: "var(--h421-green)", color: "#fff", padding: "6px 12px", fontSize: 13, minHeight: 0 }}>Guardar</button>
                  <button onClick={() => setEditandoId(null)} style={{ background: "var(--h421-gray-200)", padding: "6px 12px", fontSize: 13, minHeight: 0 }}>Cancelar</button>
                </>
              ) : (
                <button onClick={() => empezarEdicion(s)} style={{ background: "var(--h421-gray-50)", padding: "6px 12px", fontSize: 13, minHeight: 0 }}>Editar nombre</button>
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
