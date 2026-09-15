import { useEffect, useState } from "react";
import type { Sucursal } from "@hangar421/shared";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";

interface Mesa {
  id: string;
  nombre: string;
  capacidad: number;
  estado: string;
}

const ETIQUETA_ESTADO: Record<string, string> = {
  LIBRE: "Libre",
  OCUPADA: "Ocupada",
  RESERVADA: "Reservada",
  POR_COBRAR: "Por cobrar",
  PEDIDO_LISTO: "Pedido listo",
};

/** Alta, edición y baja de mesas por sucursal — mismo módulo que apps/crm-web/mesas, dentro del
 *  propio POS. Antes no había ninguna pantalla para esto (solo existía el endpoint POST /mesas,
 *  sin usar desde ningún lado), así que una siembra de datos demo corrida más de una vez sobre la
 *  misma sucursal dejaba mesas duplicadas sin forma de limpiarlas salvo tocando la base a mano.
 *  "Eliminar" es baja lógica y el backend la rechaza si la mesa no está Libre. */
export function AdminMesas() {
  const { usuario } = useAuthStore();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [nueva, setNueva] = useState({ nombre: "", capacidad: "4" });
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [borrador, setBorrador] = useState({ nombre: "", capacidad: "4" });

  async function cargar(suc: string) {
    if (!suc) return;
    const data = await apiFetch<Mesa[]>(`/mesas?sucursalId=${suc}`);
    setMesas(data);
  }

  useEffect(() => {
    if (!usuario) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargar(s[0].id); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  async function crear() {
    if (!nueva.nombre.trim()) return;
    await apiFetch("/mesas", {
      method: "POST",
      body: JSON.stringify({ sucursalId, nombre: nueva.nombre.trim(), capacidad: Number(nueva.capacidad) || 4 }),
    });
    setNueva({ nombre: "", capacidad: "4" });
    setMensaje("Mesa creada.");
    cargar(sucursalId);
  }

  function empezarEdicion(m: Mesa) {
    setEditandoId(m.id);
    setBorrador({ nombre: m.nombre, capacidad: String(m.capacidad) });
  }

  async function guardarEdicion(id: string) {
    if (!borrador.nombre.trim()) return;
    await apiFetch(`/mesas/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ nombre: borrador.nombre.trim(), capacidad: Number(borrador.capacidad) || 4 }),
    });
    setEditandoId(null);
    setMensaje("Mesa actualizada.");
    cargar(sucursalId);
  }

  async function eliminar(m: Mesa) {
    if (!confirm(`¿Eliminar "${m.nombre}"?`)) return;
    setError(null);
    try {
      await apiFetch(`/mesas/${m.id}`, { method: "PATCH", body: JSON.stringify({ activo: false }) });
      setMensaje("Mesa eliminada.");
      cargar(sucursalId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar la mesa.");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Mesas</h2>
        <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); cargar(e.target.value); }} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {mensaje && <p style={{ color: "var(--h421-navy-texto)" }}>{mensaje}</p>}
      {error && <p style={{ color: "var(--h421-red-texto)" }}>{error}</p>}

      <div className="card" style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
              <th style={{ padding: 8 }}>Nombre</th>
              <th style={{ padding: 8 }}>Capacidad</th>
              <th style={{ padding: 8 }}>Estado</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {mesas.map((m) => {
              if (editandoId === m.id) {
                return (
                  <tr key={m.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                    <td style={{ padding: 8 }}>
                      <input value={borrador.nombre} onChange={(e) => setBorrador((b) => ({ ...b, nombre: e.target.value }))}
                        style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                    <td style={{ padding: 8 }}>
                      <input type="number" value={borrador.capacidad} onChange={(e) => setBorrador((b) => ({ ...b, capacidad: e.target.value }))}
                        style={{ width: 70, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                    <td style={{ padding: 8, color: "var(--h421-gray-400)" }}>{ETIQUETA_ESTADO[m.estado] ?? m.estado}</td>
                    <td style={{ padding: 8, display: "flex", gap: 6 }}>
                      <button onClick={() => guardarEdicion(m.id)} style={{ background: "var(--h421-green)", color: "#fff", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>Guardar</button>
                      <button onClick={() => setEditandoId(null)} style={{ background: "var(--h421-gray-200)", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>Cancelar</button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={m.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{m.nombre}</td>
                  <td style={{ padding: 8 }}>{m.capacidad} personas</td>
                  <td style={{ padding: 8 }}>{ETIQUETA_ESTADO[m.estado] ?? m.estado}</td>
                  <td style={{ padding: 8, display: "flex", gap: 6 }}>
                    <button onClick={() => empezarEdicion(m)} style={{ background: "var(--h421-gray-50)", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>Editar</button>
                    <button onClick={() => eliminar(m)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>Eliminar</button>
                  </td>
                </tr>
              );
            })}
            {mesas.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin mesas todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Nueva mesa</h3>
        <input placeholder="Nombre (ej. Mesa 9)" value={nueva.nombre} onChange={(e) => setNueva((n) => ({ ...n, nombre: e.target.value }))}
          style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        <input placeholder="Capacidad" type="number" value={nueva.capacidad} onChange={(e) => setNueva((n) => ({ ...n, capacidad: e.target.value }))}
          style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        <button onClick={crear} style={{ width: "100%", background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>Crear mesa</button>
      </div>
    </div>
  );
}
