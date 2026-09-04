import { useEffect, useState } from "react";
import type { Sucursal } from "@hangar421/shared";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";

interface Existencia {
  insumoId: string;
  existencia: string;
  minimo: string;
  insumo: { nombre: string; unidadMedida: string };
}

interface Insumo {
  id: string;
  nombre: string;
  unidadMedida: string;
  costoUnitario: string;
}

interface Movimiento {
  id: string;
  tipo: string;
  cantidad: string;
  motivo: string | null;
  createdAt: string;
  insumo: { nombre: string; unidadMedida: string };
}

const TIPOS_MOVIMIENTO = ["ENTRADA", "SALIDA", "AJUSTE", "MERMA", "CONTEO"];

/** Inventario (existencias, insumos, movimientos, mínimos) con filtro por sucursal — mismo
 *  módulo que apps/crm-web/inventario, dentro del propio POS. */
export function AdminInventario() {
  const { usuario } = useAuthStore();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [alertas, setAlertas] = useState<Existencia[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [nuevoInsumo, setNuevoInsumo] = useState({ nombre: "", unidadMedida: "pz", costoUnitario: "" });
  const [mov, setMov] = useState({ insumoId: "", tipo: "ENTRADA", cantidad: "", motivo: "" });
  const [minimos, setMinimos] = useState<Record<string, string>>({});

  async function cargar(suc: string) {
    if (!usuario || !suc) return;
    const [ex, al, ins, movs] = await Promise.all([
      apiFetch<Existencia[]>(`/inventario/existencias?sucursalId=${suc}`),
      apiFetch<Existencia[]>(`/inventario/alertas?sucursalId=${suc}`),
      apiFetch<Insumo[]>(`/inventario/insumos?empresaId=${usuario.empresaId}`),
      apiFetch<Movimiento[]>(`/inventario/movimientos?sucursalId=${suc}`),
    ]);
    setExistencias(ex);
    setAlertas(al);
    setInsumos(ins);
    setMovimientos(movs);
    setMov((m) => (m.insumoId ? m : { ...m, insumoId: ins[0]?.id ?? "" }));
  }

  useEffect(() => {
    if (!usuario) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargar(s[0].id); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  async function crearInsumo() {
    if (!usuario || !nuevoInsumo.nombre.trim()) return;
    await apiFetch("/inventario/insumos", {
      method: "POST",
      body: JSON.stringify({
        empresaId: usuario.empresaId,
        nombre: nuevoInsumo.nombre,
        unidadMedida: nuevoInsumo.unidadMedida,
        costoUnitario: nuevoInsumo.costoUnitario ? Number(nuevoInsumo.costoUnitario) : undefined,
      }),
    });
    setNuevoInsumo({ nombre: "", unidadMedida: "pz", costoUnitario: "" });
    setMensaje("Insumo creado.");
    cargar(sucursalId);
  }

  async function registrarMovimiento() {
    if (!usuario || !mov.insumoId || !mov.cantidad) return;
    await apiFetch("/inventario/movimientos", {
      method: "POST",
      body: JSON.stringify({
        sucursalId,
        insumoId: mov.insumoId,
        tipo: mov.tipo,
        cantidad: Number(mov.cantidad),
        motivo: mov.motivo || undefined,
        usuarioId: usuario.id,
      }),
    });
    setMov((m) => ({ ...m, cantidad: "", motivo: "" }));
    setMensaje("Movimiento registrado.");
    cargar(sucursalId);
  }

  async function guardarMinimo(insumoId: string) {
    const valor = minimos[insumoId];
    if (valor === undefined) return;
    await apiFetch("/inventario/minimos", {
      method: "POST",
      body: JSON.stringify({ sucursalId, insumoId, minimo: Number(valor) }),
    });
    cargar(sucursalId);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Inventario</h2>
        <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); cargar(e.target.value); }} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {mensaje && <p style={{ color: "var(--h421-navy)" }}>{mensaje}</p>}

      {alertas.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid var(--h421-yellow)", marginBottom: 16, marginTop: 12 }}>
          <strong style={{ color: "#92400e" }}>⚠ {alertas.length} insumo(s) en nivel mínimo</strong>
          <ul>
            {alertas.map((a) => <li key={a.insumoId}>{a.insumo.nombre}: {a.existencia} {a.insumo.unidadMedida}</li>)}
          </ul>
        </div>
      )}

      <div className="card" style={{ overflowX: "auto", marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Existencias por sucursal</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
              <th style={{ padding: 8 }}>Insumo</th>
              <th style={{ padding: 8 }}>Existencia</th>
              <th style={{ padding: 8 }}>Mínimo</th>
              <th style={{ padding: 8 }}>Estado</th>
              <th style={{ padding: 8 }}>Cambiar mínimo</th>
            </tr>
          </thead>
          <tbody>
            {existencias.map((e) => {
              const bajo = Number(e.existencia) <= Number(e.minimo);
              return (
                <tr key={e.insumoId} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <td style={{ padding: 8 }}>{e.insumo.nombre}</td>
                  <td style={{ padding: 8 }}>{e.existencia} {e.insumo.unidadMedida}</td>
                  <td style={{ padding: 8 }}>{e.minimo}</td>
                  <td style={{ padding: 8, color: bajo ? "var(--h421-red)" : "var(--h421-green)" }}>{bajo ? "Bajo" : "OK"}</td>
                  <td style={{ padding: 8, display: "flex", gap: 6 }}>
                    <input type="number" placeholder={e.minimo} value={minimos[e.insumoId] ?? ""} onChange={(ev) => setMinimos((m) => ({ ...m, [e.insumoId]: ev.target.value }))}
                      style={{ width: 70, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    <button onClick={() => guardarMinimo(e.insumoId)} style={{ background: "var(--h421-navy)", color: "#fff", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>Guardar</button>
                  </td>
                </tr>
              );
            })}
            {existencias.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin existencias registradas todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Nuevo insumo</h3>
          <input placeholder="Nombre (ej. Leche entera)" value={nuevoInsumo.nombre} onChange={(e) => setNuevoInsumo((n) => ({ ...n, nombre: e.target.value }))}
            style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <select value={nuevoInsumo.unidadMedida} onChange={(e) => setNuevoInsumo((n) => ({ ...n, unidadMedida: e.target.value }))} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
              <option value="pz">pz</option>
              <option value="g">g</option>
              <option value="kg">kg</option>
              <option value="ml">ml</option>
              <option value="l">l</option>
            </select>
            <input placeholder="Costo unitario (opcional)" type="number" value={nuevoInsumo.costoUnitario} onChange={(e) => setNuevoInsumo((n) => ({ ...n, costoUnitario: e.target.value }))}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          </div>
          <button onClick={crearInsumo} style={{ width: "100%", marginTop: 8, background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>Crear insumo</button>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Registrar movimiento</h3>
          <select value={mov.insumoId} onChange={(e) => setMov((m) => ({ ...m, insumoId: e.target.value }))} style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
            {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={mov.tipo} onChange={(e) => setMov((m) => ({ ...m, tipo: e.target.value }))} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
              {TIPOS_MOVIMIENTO.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Cantidad" type="number" value={mov.cantidad} onChange={(e) => setMov((m) => ({ ...m, cantidad: e.target.value }))}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          </div>
          <input placeholder="Motivo (opcional)" value={mov.motivo} onChange={(e) => setMov((m) => ({ ...m, motivo: e.target.value }))}
            style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          <button onClick={registrarMovimiento} style={{ width: "100%", background: "var(--h421-navy)", color: "#fff", padding: "10px 16px" }}>Registrar</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Movimientos recientes</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
              <th style={{ padding: 8 }}>Fecha</th>
              <th style={{ padding: 8 }}>Insumo</th>
              <th style={{ padding: 8 }}>Tipo</th>
              <th style={{ padding: 8 }}>Cantidad</th>
              <th style={{ padding: 8 }}>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.slice(0, 30).map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                <td style={{ padding: 8 }}>{new Date(m.createdAt).toLocaleString("es-MX")}</td>
                <td style={{ padding: 8 }}>{m.insumo.nombre}</td>
                <td style={{ padding: 8 }}>{m.tipo}</td>
                <td style={{ padding: 8 }}>{m.cantidad} {m.insumo.unidadMedida}</td>
                <td style={{ padding: 8, color: "var(--h421-gray-400)" }}>{m.motivo ?? "—"}</td>
              </tr>
            ))}
            {movimientos.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin movimientos todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
