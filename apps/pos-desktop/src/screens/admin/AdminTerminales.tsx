import { useEffect, useState } from "react";
import type { AmbienteProveedorPago, Sucursal } from "@hangar421/shared";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";

interface ConfigProveedor {
  id: string;
  empresaId: string;
  sucursalId: string | null;
  proveedor: string;
  ambiente: AmbienteProveedorPago;
  identificadorComercio: string | null;
  webhookUrl: string | null;
  activo: boolean;
}

interface TerminalRow {
  id: string;
  sucursalId: string;
  nombre: string;
  zona: string | null;
  identificadorExterno: string;
  activo: boolean;
  estadoConexion: "CONECTADA" | "DESCONECTADA" | "OCUPADA" | "ERROR";
  ultimaSincronizacion: string | null;
  cajaId: string | null;
  meseroAsignado: { id: string; nombre: string } | null;
  proveedorConfig: { id: string; proveedor: string; ambiente: string };
}

interface UsuarioSucursalRow {
  usuarioId: string;
  rol: string;
  usuario: { id: string; nombre: string };
}

const PROVEEDORES = [
  { valor: "mercadopago", etiqueta: "Mercado Pago (Point Smart)" },
  { valor: "mock", etiqueta: "Prueba / demo (sin terminal real)" },
];

const ETIQUETA_ESTADO: Record<string, { texto: string; color: string }> = {
  CONECTADA: { texto: "Conectada", color: "var(--h421-esmeralda)" },
  DESCONECTADA: { texto: "Desconectada", color: "var(--h421-gray-400)" },
  OCUPADA: { texto: "Ocupada", color: "var(--h421-yellow)" },
  ERROR: { texto: "Error", color: "var(--h421-red-texto)" },
};

const inputStyle = { width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" } as const;

/** Administración > Terminales de pago: configuración de proveedores (credenciales cifradas en
 *  el backend, nunca visibles aquí después de guardarlas) y alta/edición de terminales físicas
 *  vinculadas a cada una — ver apps/backend/src/pagos/. */
export function AdminTerminales() {
  const { usuario: usuarioSesion } = useAuthStore();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [meseros, setMeseros] = useState<UsuarioSucursalRow[]>([]);

  const [configs, setConfigs] = useState<ConfigProveedor[]>([]);
  const [terminales, setTerminales] = useState<TerminalRow[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [probando, setProbando] = useState<string | null>(null);

  const [nuevoConfig, setNuevoConfig] = useState({
    proveedor: "mercadopago", ambiente: "PRUEBAS" as AmbienteProveedorPago,
    identificadorComercio: "", accessToken: "", webhookSecret: "",
  });
  const [guardandoConfig, setGuardandoConfig] = useState(false);

  const [nuevaTerminal, setNuevaTerminal] = useState({ proveedorConfigId: "", nombre: "", zona: "", meseroAsignadoId: "", identificadorExterno: "" });
  const [creandoTerminal, setCreandoTerminal] = useState(false);
  const [terminalSeleccionada, setTerminalSeleccionada] = useState<TerminalRow | null>(null);
  const [historial, setHistorial] = useState<any[]>([]);

  async function cargarConfigs() {
    if (!usuarioSesion) return;
    const c = await apiFetch<ConfigProveedor[]>(`/pagos/proveedores?empresaId=${usuarioSesion.empresaId}`);
    setConfigs(c);
  }

  async function cargarTerminales(suc: string) {
    if (!suc) return;
    const t = await apiFetch<TerminalRow[]>(`/pagos/terminales?sucursalId=${suc}`);
    setTerminales(t);
  }

  async function cargarMeseros(suc: string) {
    if (!suc) return;
    const filas = await apiFetch<UsuarioSucursalRow[]>(`/usuarios?sucursalId=${suc}`);
    setMeseros(filas.filter((f) => f.rol === "MESERO"));
  }

  useEffect(() => {
    if (!usuarioSesion) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuarioSesion.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargarTerminales(s[0].id); cargarMeseros(s[0].id); }
    });
    cargarConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioSesion]);

  async function guardarConfig() {
    if (!usuarioSesion) return;
    setGuardandoConfig(true);
    setMensaje(null);
    try {
      const credenciales: Record<string, string> =
        nuevoConfig.proveedor === "mercadopago"
          ? { accessToken: nuevoConfig.accessToken, webhookSecret: nuevoConfig.webhookSecret }
          : {};
      await apiFetch("/pagos/proveedores", {
        method: "POST",
        body: JSON.stringify({
          empresaId: usuarioSesion.empresaId,
          sucursalId: sucursalId || undefined,
          proveedor: nuevoConfig.proveedor,
          ambiente: nuevoConfig.ambiente,
          identificadorComercio: nuevoConfig.identificadorComercio || undefined,
          credenciales,
        }),
      });
      setNuevoConfig({ proveedor: "mercadopago", ambiente: "PRUEBAS" as AmbienteProveedorPago, identificadorComercio: "", accessToken: "", webhookSecret: "" });
      cargarConfigs();
      setMensaje("Configuración guardada — las credenciales quedaron cifradas en el servidor.");
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setGuardandoConfig(false);
    }
  }

  async function probarConexionConfig(id: string) {
    setProbando(id);
    try {
      const r = await apiFetch<{ ok: boolean; detalle: string }>(`/pagos/proveedores/${id}/probar-conexion`, { method: "POST" });
      setMensaje(r.ok ? `Conexión OK: ${r.detalle}` : `Falló: ${r.detalle}`);
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setProbando(null);
    }
  }

  async function crearTerminal() {
    if (!nuevaTerminal.proveedorConfigId || !nuevaTerminal.nombre.trim() || !nuevaTerminal.identificadorExterno.trim()) return;
    setCreandoTerminal(true);
    setMensaje(null);
    try {
      await apiFetch("/pagos/terminales", {
        method: "POST",
        body: JSON.stringify({
          sucursalId,
          proveedorConfigId: nuevaTerminal.proveedorConfigId,
          nombre: nuevaTerminal.nombre,
          zona: nuevaTerminal.zona || undefined,
          meseroAsignadoId: nuevaTerminal.meseroAsignadoId || undefined,
          identificadorExterno: nuevaTerminal.identificadorExterno,
        }),
      });
      setNuevaTerminal({ proveedorConfigId: "", nombre: "", zona: "", meseroAsignadoId: "", identificadorExterno: "" });
      cargarTerminales(sucursalId);
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setCreandoTerminal(false);
    }
  }

  async function toggleActivoTerminal(t: TerminalRow) {
    await apiFetch(`/pagos/terminales/${t.id}`, { method: "PATCH", body: JSON.stringify({ activo: !t.activo }) });
    cargarTerminales(sucursalId);
  }

  async function eliminarTerminal(t: TerminalRow) {
    if (!confirm(`¿Eliminar la terminal "${t.nombre}"?`)) return;
    try {
      await apiFetch(`/pagos/terminales/${t.id}/eliminar`, { method: "POST" });
      cargarTerminales(sucursalId);
    } catch (e: any) {
      setMensaje(e.message);
    }
  }

  async function probarConexionTerminal(t: TerminalRow) {
    setProbando(t.id);
    try {
      const r = await apiFetch<{ ok: boolean; detalle: string }>(`/pagos/terminales/${t.id}/probar-conexion`, { method: "POST" });
      setMensaje(r.ok ? `"${t.nombre}" conectada: ${r.detalle}` : `"${t.nombre}" con error: ${r.detalle}`);
      cargarTerminales(sucursalId);
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setProbando(null);
    }
  }

  async function verHistorial(t: TerminalRow) {
    setTerminalSeleccionada(t);
    const h = await apiFetch<any[]>(`/pagos/terminales/${t.id}/historial`);
    setHistorial(h);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Terminales de pago</h2>
        <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setTerminalSeleccionada(null); cargarTerminales(e.target.value); cargarMeseros(e.target.value); }} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {mensaje && <p style={{ color: "var(--h421-navy-texto)" }}>{mensaje}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginTop: 12 }}>
        {/* --- Configuración de proveedores --- */}
        <div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Proveedores configurados</h3>
            {configs.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Aún no hay proveedores configurados.</p>}
            {configs.map((c) => (
              <div key={c.id} style={{ borderBottom: "1px solid var(--h421-gray-200)", padding: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{PROVEEDORES.find((p) => p.valor === c.proveedor)?.etiqueta ?? c.proveedor}</strong>
                    <span style={{ color: "var(--h421-gray-400)", fontSize: 12 }}> · {c.ambiente === "PRODUCCION" ? "Producción" : "Pruebas"}{c.sucursalId ? "" : " · toda la empresa"}</span>
                  </div>
                  <button onClick={() => probarConexionConfig(c.id)} disabled={probando === c.id} style={{ background: "var(--h421-navy)", color: "#fff", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>
                    {probando === c.id ? "Probando…" : "Probar conexión"}
                  </button>
                </div>
                {c.identificadorComercio && <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--h421-gray-400)" }}>Comercio: {c.identificadorComercio}</p>}
              </div>
            ))}

            <h4 style={{ marginBottom: 8, marginTop: 16 }}>Nueva configuración</h4>
            <select value={nuevoConfig.proveedor} onChange={(e) => setNuevoConfig((n) => ({ ...n, proveedor: e.target.value }))} style={inputStyle}>
              {PROVEEDORES.map((p) => <option key={p.valor} value={p.valor}>{p.etiqueta}</option>)}
            </select>
            <select value={nuevoConfig.ambiente} onChange={(e) => setNuevoConfig((n) => ({ ...n, ambiente: e.target.value as AmbienteProveedorPago }))} style={inputStyle}>
              <option value="PRUEBAS">Pruebas (sandbox)</option>
              <option value="PRODUCCION">Producción</option>
            </select>
            <input placeholder="Identificador de comercio (opcional)" value={nuevoConfig.identificadorComercio}
              onChange={(e) => setNuevoConfig((n) => ({ ...n, identificadorComercio: e.target.value }))} style={inputStyle} />
            {nuevoConfig.proveedor === "mercadopago" && (
              <>
                <input placeholder="Access Token de Mercado Pago" value={nuevoConfig.accessToken}
                  onChange={(e) => setNuevoConfig((n) => ({ ...n, accessToken: e.target.value }))} style={inputStyle} />
                <input placeholder="Webhook Secret (Tus integraciones > Webhooks)" value={nuevoConfig.webhookSecret}
                  onChange={(e) => setNuevoConfig((n) => ({ ...n, webhookSecret: e.target.value }))} style={inputStyle} />
              </>
            )}
            <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "0 0 8px" }}>
              Se aplica a: <strong>{sucursales.find((s) => s.id === sucursalId)?.nombre}</strong>. Las credenciales se cifran en el servidor y no se vuelven a mostrar aquí.
            </p>
            <button onClick={guardarConfig} disabled={guardandoConfig} style={{ width: "100%", background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>
              {guardandoConfig ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>
        </div>

        {/* --- Terminales --- */}
        <div>
          <div className="card" style={{ overflowX: "auto" }}>
            <h3 style={{ marginTop: 0 }}>Terminales</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <th style={{ padding: 8 }}>Nombre</th>
                  <th style={{ padding: 8 }}>Mesero</th>
                  <th style={{ padding: 8 }}>Estado</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {terminales.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid var(--h421-gray-200)", opacity: t.activo ? 1 : 0.5 }}>
                    <td style={{ padding: 8 }}>{t.nombre}{t.zona ? <span style={{ color: "var(--h421-gray-400)" }}> · {t.zona}</span> : null}</td>
                    <td style={{ padding: 8 }}>{t.meseroAsignado?.nombre ?? "—"}</td>
                    <td style={{ padding: 8, color: ETIQUETA_ESTADO[t.estadoConexion].color }}>{ETIQUETA_ESTADO[t.estadoConexion].texto}</td>
                    <td style={{ padding: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => probarConexionTerminal(t)} disabled={probando === t.id} style={{ background: "var(--h421-navy)", color: "#fff", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>
                        {probando === t.id ? "…" : "Probar"}
                      </button>
                      <button onClick={() => verHistorial(t)} style={{ background: "var(--h421-gray-50)", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>Historial</button>
                      <button onClick={() => toggleActivoTerminal(t)} style={{ background: t.activo ? "var(--h421-red)" : "var(--h421-green)", color: "#fff", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>
                        {t.activo ? "Desactivar" : "Activar"}
                      </button>
                      <button onClick={() => eliminarTerminal(t)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>Eliminar</button>
                    </td>
                  </tr>
                ))}
                {terminales.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin terminales en esta sucursal.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Nueva terminal</h3>
            <select value={nuevaTerminal.proveedorConfigId} onChange={(e) => setNuevaTerminal((n) => ({ ...n, proveedorConfigId: e.target.value }))} style={inputStyle}>
              <option value="">Proveedor…</option>
              {configs.map((c) => <option key={c.id} value={c.id}>{PROVEEDORES.find((p) => p.valor === c.proveedor)?.etiqueta ?? c.proveedor} ({c.ambiente === "PRODUCCION" ? "Prod" : "Pruebas"})</option>)}
            </select>
            <input placeholder="Nombre (ej. Terminal Mostrador)" value={nuevaTerminal.nombre}
              onChange={(e) => setNuevaTerminal((n) => ({ ...n, nombre: e.target.value }))} style={inputStyle} />
            <input placeholder="Zona / caja (opcional)" value={nuevaTerminal.zona}
              onChange={(e) => setNuevaTerminal((n) => ({ ...n, zona: e.target.value }))} style={inputStyle} />
            <select value={nuevaTerminal.meseroAsignadoId} onChange={(e) => setNuevaTerminal((n) => ({ ...n, meseroAsignadoId: e.target.value }))} style={inputStyle}>
              <option value="">Mesero asignado (opcional)</option>
              {meseros.map((m) => <option key={m.usuarioId} value={m.usuarioId}>{m.usuario.nombre}</option>)}
            </select>
            <input placeholder="Identificador de la terminal (terminal_id del proveedor)" value={nuevaTerminal.identificadorExterno}
              onChange={(e) => setNuevaTerminal((n) => ({ ...n, identificadorExterno: e.target.value }))} style={inputStyle} />
            <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "0 0 8px" }}>
              El identificador lo asigna Mercado Pago al vincular la terminal a una tienda/caja desde su propio panel (no se puede automatizar por API) — cópialo de ahí.
            </p>
            <button onClick={crearTerminal} disabled={creandoTerminal} style={{ width: "100%", background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>
              {creandoTerminal ? "Creando…" : "Crear terminal"}
            </button>
          </div>

          {terminalSeleccionada && (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ marginTop: 0 }}>Historial — {terminalSeleccionada.nombre}</h3>
                <button onClick={() => setTerminalSeleccionada(null)} style={{ background: "none", color: "var(--h421-gray-400)", minHeight: 0 }}>✕</button>
              </div>
              {historial.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Sin cobros registrados todavía.</p>}
              {historial.map((h) => (
                <div key={h.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <span>{new Date(h.createdAt).toLocaleString("es-MX")}</span>
                  <span>${Number(h.importe).toFixed(2)} {h.moneda}</span>
                  <span>{h.estado}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
