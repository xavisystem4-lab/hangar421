import { useEffect, useState } from "react";
import type { RolUsuario, Sucursal } from "@hangar421/shared";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";

interface UsuarioSucursalRow {
  usuarioId: string;
  sucursalId: string;
  rol: RolUsuario;
  activo: boolean;
  usuario: { id: string; nombre: string; email: string | null; activo: boolean };
}

interface HorarioRow {
  id: string;
  usuarioId: string;
  sucursalId: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  notas: string | null;
  sucursal: { id: string; nombre: string };
}

const ROLES: RolUsuario[] = ["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL", "SUPERVISOR", "CAJERO", "MESERO", "COCINA"] as RolUsuario[];
const ETIQUETA_ROL: Record<string, string> = {
  ADMIN_CORPORATIVO: "Admin. corporativo", ADMIN_SUCURSAL: "Admin. sucursal", SUPERVISOR: "Supervisor",
  CAJERO: "Cajero", MESERO: "Mesero", COCINA: "Cocina",
};
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Alta/edición de usuarios (contraseña, PIN, rol, activo/inactivo) y horario semanal, con
 *  filtro por sucursal — mismo módulo que apps/crm-web/usuarios, dentro del propio POS. */
export function AdminUsuarios() {
  const { usuario: usuarioSesion } = useAuthStore();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [filas, setFilas] = useState<UsuarioSucursalRow[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [nuevo, setNuevo] = useState({ nombre: "", email: "", password: "", pin: "", rol: "CAJERO" as RolUsuario });
  const [creando, setCreando] = useState(false);

  const [usuarioEditando, setUsuarioEditando] = useState<UsuarioSucursalRow | null>(null);
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [nuevoPin, setNuevoPin] = useState("");

  const [horarios, setHorarios] = useState<HorarioRow[]>([]);
  const [nuevoHorario, setNuevoHorario] = useState({ diaSemana: "1", horaInicio: "09:00", horaFin: "17:00", notas: "" });

  async function cargar(suc: string) {
    if (!suc) return;
    const filas = await apiFetch<UsuarioSucursalRow[]>(`/usuarios?sucursalId=${suc}`);
    setFilas(filas);
  }

  useEffect(() => {
    if (!usuarioSesion) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuarioSesion.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargar(s[0].id); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioSesion]);

  async function crearUsuario() {
    if (!usuarioSesion || !nuevo.nombre.trim() || !nuevo.email.trim() || !sucursalId) return;
    setCreando(true);
    setMensaje(null);
    try {
      await apiFetch("/usuarios", {
        method: "POST",
        body: JSON.stringify({
          empresaId: usuarioSesion.empresaId,
          nombre: nuevo.nombre,
          email: nuevo.email,
          password: nuevo.password || undefined,
          pin: nuevo.pin || undefined,
          sucursales: [{ sucursalId, rol: nuevo.rol }],
        }),
      });
      setNuevo({ nombre: "", email: "", password: "", pin: "", rol: "CAJERO" as RolUsuario });
      cargar(sucursalId);
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setCreando(false);
    }
  }

  async function guardarPassword() {
    if (!usuarioEditando || !nuevaPassword) return;
    await apiFetch(`/usuarios/${usuarioEditando.usuarioId}/password`, { method: "PATCH", body: JSON.stringify({ password: nuevaPassword }) });
    setNuevaPassword("");
    setMensaje("Contraseña actualizada.");
  }

  async function guardarPin() {
    if (!usuarioEditando || !nuevoPin) return;
    await apiFetch(`/usuarios/${usuarioEditando.usuarioId}/pin`, { method: "PATCH", body: JSON.stringify({ pin: nuevoPin }) });
    setNuevoPin("");
    setMensaje("PIN actualizado.");
  }

  async function toggleActivo(fila: UsuarioSucursalRow) {
    const accion = fila.usuario.activo ? "desactivar" : "activar";
    await apiFetch(`/usuarios/${fila.usuarioId}/${accion}`, { method: "PATCH" });
    cargar(sucursalId);
  }

  async function seleccionarUsuario(fila: UsuarioSucursalRow) {
    setUsuarioEditando(fila);
    setNuevaPassword("");
    setNuevoPin("");
    const h = await apiFetch<HorarioRow[]>(`/usuarios/${fila.usuarioId}/horarios`);
    setHorarios(h);
  }

  async function agregarHorario() {
    if (!usuarioEditando) return;
    await apiFetch(`/usuarios/${usuarioEditando.usuarioId}/horarios`, {
      method: "POST",
      body: JSON.stringify({
        sucursalId,
        diaSemana: Number(nuevoHorario.diaSemana),
        horaInicio: nuevoHorario.horaInicio,
        horaFin: nuevoHorario.horaFin,
        notas: nuevoHorario.notas || undefined,
      }),
    });
    setNuevoHorario({ diaSemana: "1", horaInicio: "09:00", horaFin: "17:00", notas: "" });
    const h = await apiFetch<HorarioRow[]>(`/usuarios/${usuarioEditando.usuarioId}/horarios`);
    setHorarios(h);
  }

  async function eliminarHorario(id: string) {
    if (!usuarioEditando) return;
    await apiFetch(`/usuarios/horarios/${id}`, { method: "DELETE" });
    setHorarios((h) => h.filter((x) => x.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Usuarios</h2>
        <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setUsuarioEditando(null); cargar(e.target.value); }} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {mensaje && <p style={{ color: "var(--h421-navy)" }}>{mensaje}</p>}

      <div style={{ display: "grid", gridTemplateColumns: usuarioEditando ? "1.4fr 1fr" : "1fr", gap: 16, marginTop: 12 }}>
        <div>
          <div className="card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <th style={{ padding: 8 }}>Nombre</th>
                  <th style={{ padding: 8 }}>Email</th>
                  <th style={{ padding: 8 }}>Rol</th>
                  <th style={{ padding: 8 }}>Estado</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.usuarioId} style={{ borderBottom: "1px solid var(--h421-gray-200)", background: usuarioEditando?.usuarioId === f.usuarioId ? "var(--h421-gray-50)" : "transparent" }}>
                    <td style={{ padding: 8 }}>{f.usuario.nombre}</td>
                    <td style={{ padding: 8 }}>{f.usuario.email}</td>
                    <td style={{ padding: 8 }}>{ETIQUETA_ROL[f.rol] ?? f.rol}</td>
                    <td style={{ padding: 8, color: f.usuario.activo ? "var(--h421-green)" : "var(--h421-red)" }}>{f.usuario.activo ? "Activo" : "Inactivo"}</td>
                    <td style={{ padding: 8, display: "flex", gap: 6 }}>
                      <button onClick={() => seleccionarUsuario(f)} style={{ background: "var(--h421-navy)", color: "#fff", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>Editar</button>
                      <button onClick={() => toggleActivo(f)} style={{ background: f.usuario.activo ? "var(--h421-red)" : "var(--h421-green)", color: "#fff", padding: "6px 10px", fontSize: 12, minHeight: 0 }}>
                        {f.usuario.activo ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin usuarios en esta sucursal.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ maxWidth: 460, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Nuevo usuario</h3>
            <input placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))}
              style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            <input placeholder="Correo" value={nuevo.email} onChange={(e) => setNuevo((n) => ({ ...n, email: e.target.value }))}
              style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            <input placeholder="Contraseña" type="password" value={nuevo.password} onChange={(e) => setNuevo((n) => ({ ...n, password: e.target.value }))}
              style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            <input placeholder="PIN (4 dígitos)" value={nuevo.pin} onChange={(e) => setNuevo((n) => ({ ...n, pin: e.target.value }))}
              style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            <select value={nuevo.rol} onChange={(e) => setNuevo((n) => ({ ...n, rol: e.target.value as RolUsuario }))}
              style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
              {ROLES.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
            </select>
            <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "0 0 8px" }}>Se asigna a la sucursal seleccionada arriba: <strong>{sucursales.find((s) => s.id === sucursalId)?.nombre}</strong>.</p>
            <button onClick={crearUsuario} disabled={creando} style={{ width: "100%", background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>
              {creando ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        </div>

        {usuarioEditando && (
          <div>
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ marginTop: 0 }}>{usuarioEditando.usuario.nombre}</h3>
                <button onClick={() => setUsuarioEditando(null)} style={{ background: "none", color: "var(--h421-gray-400)", minHeight: 0 }}>✕</button>
              </div>

              <label style={{ fontSize: 13, color: "var(--h421-gray-600)" }}>Nueva contraseña</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4, marginBottom: 12 }}>
                <input type="password" value={nuevaPassword} onChange={(e) => setNuevaPassword(e.target.value)}
                  style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <button onClick={guardarPassword} style={{ background: "var(--h421-navy)", color: "#fff", padding: "0 14px" }}>Guardar</button>
              </div>

              <label style={{ fontSize: 13, color: "var(--h421-gray-600)" }}>Nuevo PIN</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <input value={nuevoPin} onChange={(e) => setNuevoPin(e.target.value)}
                  style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <button onClick={guardarPin} style={{ background: "var(--h421-navy)", color: "#fff", padding: "0 14px" }}>Guardar</button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Horario semanal</h3>
              {horarios.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Sin horario definido.</p>}
              {horarios.map((h) => (
                <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--h421-gray-200)", fontSize: 14 }}>
                  <span>{DIAS[h.diaSemana]} · {h.horaInicio}–{h.horaFin} · {h.sucursal.nombre}{h.notas ? ` (${h.notas})` : ""}</span>
                  <button onClick={() => eliminarHorario(h.id)} style={{ background: "#fee2e2", color: "var(--h421-red)", padding: "4px 8px", fontSize: 12, minHeight: 0 }}>Quitar</button>
                </div>
              ))}

              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <select value={nuevoHorario.diaSemana} onChange={(e) => setNuevoHorario((n) => ({ ...n, diaSemana: e.target.value }))} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
                  {DIAS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
                <input type="time" value={nuevoHorario.horaInicio} onChange={(e) => setNuevoHorario((n) => ({ ...n, horaInicio: e.target.value }))} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <input type="time" value={nuevoHorario.horaFin} onChange={(e) => setNuevoHorario((n) => ({ ...n, horaFin: e.target.value }))} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <input placeholder="Notas (opcional)" value={nuevoHorario.notas} onChange={(e) => setNuevoHorario((n) => ({ ...n, notas: e.target.value }))}
                  style={{ flex: 1, minWidth: 120, padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
              </div>
              <button onClick={agregarHorario} style={{ marginTop: 8, background: "var(--h421-green)", color: "#fff", padding: "8px 14px" }}>Agregar horario</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
