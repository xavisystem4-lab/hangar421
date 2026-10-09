"use client";

import { useEffect, useState } from "react";
import type { Perfil, RolUsuario, Sucursal, TurnoTrabajo } from "@hangar421/shared";
import { PERMISOS } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";

interface UsuarioSucursalRow {
  usuarioId: string;
  sucursalId: string;
  rol: RolUsuario;
  turno: TurnoTrabajo | null;
  perfilId: string | null;
  activo: boolean;
  usuario: { id: string; nombre: string; email: string | null; username: string | null; activo: boolean; tienePassword?: boolean; tienePin?: boolean };
  perfil: { id: string; nombre: string } | null;
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
const TURNOS: TurnoTrabajo[] = ["MATUTINO", "VESPERTINO", "NOCTURNO", "MIXTO"] as TurnoTrabajo[];
const ETIQUETA_TURNO: Record<string, string> = {
  MATUTINO: "Matutino", VESPERTINO: "Vespertino", NOCTURNO: "Nocturno", MIXTO: "Mixto",
};
const ETIQUETA_PERMISO: Record<string, string> = {
  [PERMISOS.VENTA_CREAR]: "Crear pedidos",
  [PERMISOS.VENTA_COBRAR]: "Cobrar pedidos",
  [PERMISOS.VENTA_DESCUENTO]: "Aplicar descuentos",
  [PERMISOS.VENTA_CANCELAR]: "Cancelar pedidos",
  [PERMISOS.VENTA_DEVOLUCION]: "Hacer devoluciones",
  [PERMISOS.CAJA_APERTURA]: "Abrir caja",
  [PERMISOS.CAJA_CORTE]: "Cerrar/cortar caja",
  [PERMISOS.MESA_TRANSFERIR]: "Transferir mesas",
  [PERMISOS.PEDIDO_REABRIR]: "Reabrir pedidos cobrados",
  [PERMISOS.CATALOGO_EDITAR]: "Editar catálogo",
  [PERMISOS.INVENTARIO_AJUSTAR]: "Ajustar inventario",
  [PERMISOS.TRASPASO_AUTORIZAR]: "Autorizar traspasos",
  [PERMISOS.USUARIOS_ADMINISTRAR]: "Administrar usuarios",
  [PERMISOS.REPORTES_GLOBALES]: "Ver reportes globales",
};
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const inputStyle = { width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" } as const;

/** Roles que ven el panel del ERP (los demás entran pero solo a Ventas). Mismo criterio que el
 *  menú (Sidebar.tsx) y los @Roles() del backend. */
const ROLES_DASHBOARD: RolUsuario[] = ["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL", "SUPERVISOR"] as RolUsuario[];

/** Contraseña legible para dictarla o anotarla: 10 caracteres sin los que se confunden (0/O, 1/l/I). */
function generarPassword(): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const digitos = "23456789";
  const todo = letras + digitos;
  const al = (c: string) => c[Math.floor(Math.random() * c.length)];
  let p = al(letras.toUpperCase()) + al(letras.toLowerCase()) + al(digitos) + al(digitos);
  while (p.length < 10) p += al(todo);
  return p.split("").sort(() => Math.random() - 0.5).join("");
}

/** Campo de contraseña/PIN con botón para verla mientras se escribe. La guardada no se puede
 *  mostrar (solo existe cifrada), así que lo que se ve es siempre lo que se está asignando. */
function CampoSecreto({ valor, onCambio, placeholder, style, autoComplete }: { valor: string; onCambio: (v: string) => void; placeholder: string; style?: React.CSSProperties; autoComplete?: string }) {
  const [ver, setVer] = useState(false);
  return (
    <div style={{ position: "relative", ...(style ?? {}) }}>
      <input
        placeholder={placeholder}
        type={ver ? "text" : "password"}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete={autoComplete ?? "new-password"}
        style={{ ...inputStyle, paddingRight: 44, marginBottom: 0, boxSizing: "border-box" }}
      />
      <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar" : "Mostrar"} title={ver ? "Ocultar" : "Mostrar"}
        style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", background: "none", color: "var(--h421-gray-400)", padding: "6px 8px", fontSize: 15 }}>
        {ver ? "🙈" : "👁"}
      </button>
    </div>
  );
}

export default function UsuariosPage() {
  const { contexto } = useAuthCrm();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [filas, setFilas] = useState<UsuarioSucursalRow[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [mostrarPerfiles, setMostrarPerfiles] = useState(false);
  const [nuevoPerfil, setNuevoPerfil] = useState<{ nombre: string; descripcion: string; permisos: string[] }>({
    nombre: "", descripcion: "", permisos: [],
  });
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);

  const [nuevo, setNuevo] = useState({
    nombre: "", email: "", username: "", password: "", pin: "",
    rol: "CAJERO" as RolUsuario, turno: "" as TurnoTrabajo | "", perfilId: "",
  });
  const [creando, setCreando] = useState(false);
  // Lo recién creado se muestra UNA vez con la contraseña en claro: es el único momento en que
  // el sistema la conoce (después solo guarda el cifrado), y así el admin la dicta o la anota.
  const [credencialesCreadas, setCredencialesCreadas] = useState<{ nombre: string; usuario: string; password: string | null; pin: string | null; entraAlErp: boolean } | null>(null);

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

  async function cargarPerfiles() {
    if (!contexto) return;
    const p = await apiFetch<Perfil[]>(`/perfiles?empresaId=${contexto.usuario.empresaId}`);
    setPerfiles(p);
  }

  useEffect(() => {
    if (!contexto) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${contexto.usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargar(s[0].id); }
    });
    cargarPerfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto]);

  async function crearUsuario() {
    if (!contexto || !nuevo.nombre.trim() || (!nuevo.email.trim() && !nuevo.username.trim()) || !sucursalId) return;
    setCreando(true);
    setMensaje(null);
    try {
      await apiFetch("/usuarios", {
        method: "POST",
        body: JSON.stringify({
          empresaId: contexto.usuario.empresaId,
          nombre: nuevo.nombre,
          email: nuevo.email || undefined,
          username: nuevo.username || undefined,
          password: nuevo.password || undefined,
          pin: nuevo.pin || undefined,
          sucursales: [{
            sucursalId, rol: nuevo.rol,
            turno: nuevo.turno || undefined,
            perfilId: nuevo.perfilId || undefined,
          }],
        }),
      });
      setCredencialesCreadas({
        nombre: nuevo.nombre,
        usuario: nuevo.username.trim() || nuevo.email.trim(),
        password: nuevo.password || null,
        pin: nuevo.pin || null,
        entraAlErp: !!nuevo.password && ROLES_DASHBOARD.includes(nuevo.rol),
      });
      setNuevo({ nombre: "", email: "", username: "", password: "", pin: "", rol: "CAJERO" as RolUsuario, turno: "", perfilId: "" });
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
    const asignada = nuevaPassword;
    setNuevaPassword("");
    setMensaje(`Contraseña actualizada para ${usuarioEditando.usuario.nombre}: ${asignada} — anótala, no se vuelve a mostrar.`);
    await cargar(sucursalId);
  }

  async function guardarPin() {
    if (!usuarioEditando || !nuevoPin) return;
    await apiFetch(`/usuarios/${usuarioEditando.usuarioId}/pin`, { method: "PATCH", body: JSON.stringify({ pin: nuevoPin }) });
    const asignado = nuevoPin;
    setNuevoPin("");
    setMensaje(`PIN actualizado para ${usuarioEditando.usuario.nombre}: ${asignado}.`);
    await cargar(sucursalId);
  }

  async function guardarAsignacion(cambios: Partial<{ rol: RolUsuario; turno: TurnoTrabajo | null; perfilId: string | null }>) {
    if (!usuarioEditando) return;
    await apiFetch(`/usuarios/${usuarioEditando.usuarioId}/sucursales/${usuarioEditando.sucursalId}`, {
      method: "PATCH",
      body: JSON.stringify(cambios),
    });
    await cargar(sucursalId);
    setMensaje("Actualizado.");
  }

  async function toggleActivo(fila: UsuarioSucursalRow) {
    const accion = fila.usuario.activo ? "desactivar" : "activar";
    await apiFetch(`/usuarios/${fila.usuarioId}/${accion}`, { method: "PATCH" });
    cargar(sucursalId);
  }

  async function eliminarUsuario(fila: UsuarioSucursalRow) {
    if (!confirm(`¿Eliminar a "${fila.usuario.nombre}"? No podrá volver a iniciar sesión; su historial de pedidos, turnos de caja y auditoría se conserva.`)) return;
    await apiFetch(`/usuarios/${fila.usuarioId}`, { method: "DELETE" });
    if (usuarioEditando?.usuarioId === fila.usuarioId) setUsuarioEditando(null);
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

  function togglePermisoNuevo(clave: string) {
    setNuevoPerfil((p) => ({
      ...p,
      permisos: p.permisos.includes(clave) ? p.permisos.filter((x) => x !== clave) : [...p.permisos, clave],
    }));
  }

  async function crearPerfil() {
    if (!contexto || !nuevoPerfil.nombre.trim()) return;
    setGuardandoPerfil(true);
    setMensaje(null);
    try {
      await apiFetch("/perfiles", {
        method: "POST",
        body: JSON.stringify({
          empresaId: contexto.usuario.empresaId,
          nombre: nuevoPerfil.nombre,
          descripcion: nuevoPerfil.descripcion || undefined,
          permisos: nuevoPerfil.permisos,
        }),
      });
      setNuevoPerfil({ nombre: "", descripcion: "", permisos: [] });
      cargarPerfiles();
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setGuardandoPerfil(false);
    }
  }

  async function togglePerfilActivo(perfil: Perfil) {
    await apiFetch(`/perfiles/${perfil.id}`, { method: "PATCH", body: JSON.stringify({ activo: !perfil.activo }) });
    cargarPerfiles();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ marginTop: 0 }}>Usuarios</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setMostrarPerfiles((v) => !v)} style={{ background: "var(--h421-navy)", color: "#fff", padding: "8px 14px" }}>
            Perfiles
          </button>
          <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setUsuarioEditando(null); cargar(e.target.value); }} style={{ padding: 8 }}>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      </div>

      {mensaje && <p style={{ color: "var(--h421-navy-texto)" }}>{mensaje}</p>}

      {mostrarPerfiles && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ marginTop: 0 }}>Perfiles de permisos</h3>
            <button onClick={() => setMostrarPerfiles(false)} style={{ background: "none", color: "var(--h421-gray-400)" }}>✕</button>
          </div>

          {perfiles.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Aún no hay perfiles creados.</p>}
          {perfiles.map((p) => (
            <div key={p.id} style={{ borderBottom: "1px solid var(--h421-gray-200)", padding: "10px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{p.nombre}</strong>{p.descripcion ? <span style={{ color: "var(--h421-gray-400)", fontSize: 13 }}> — {p.descripcion}</span> : null}
                </div>
                <button onClick={() => togglePerfilActivo(p)} style={{ background: p.activo ? "var(--h421-red)" : "var(--h421-green)", color: "#fff", padding: "4px 10px", fontSize: 12 }}>
                  {p.activo ? "Desactivar" : "Activar"}
                </button>
              </div>
              <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "4px 0 0" }}>
                {p.permisos.length === 0 ? "Sin permisos asignados" : p.permisos.map((c) => ETIQUETA_PERMISO[c] ?? c).join(", ")}
              </p>
            </div>
          ))}

          <h4 style={{ marginBottom: 8 }}>Nuevo perfil</h4>
          <input placeholder="Nombre del perfil (ej. Cajero senior)" value={nuevoPerfil.nombre}
            onChange={(e) => setNuevoPerfil((p) => ({ ...p, nombre: e.target.value }))} style={inputStyle} />
          <input placeholder="Descripción (opcional)" value={nuevoPerfil.descripcion}
            onChange={(e) => setNuevoPerfil((p) => ({ ...p, descripcion: e.target.value }))} style={inputStyle} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6, marginBottom: 12 }}>
            {Object.values(PERMISOS).map((clave) => (
              <label key={clave} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={nuevoPerfil.permisos.includes(clave)} onChange={() => togglePermisoNuevo(clave)} />
                {ETIQUETA_PERMISO[clave] ?? clave}
              </label>
            ))}
          </div>
          <button onClick={crearPerfil} disabled={guardandoPerfil || !nuevoPerfil.nombre.trim()} style={{ background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>
            {guardandoPerfil ? "Guardando…" : "Crear perfil"}
          </button>
        </div>
      )}

      <div className="h421-grid-2col" style={{ display: "grid", gridTemplateColumns: usuarioEditando ? "1.4fr 1fr" : "1fr", gap: 16 }}>
        <div>
          <div className="card h421-tabla-wrap" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <th style={{ padding: 8 }}>Nombre</th>
                  <th style={{ padding: 8 }}>Usuario / Email</th>
                  <th style={{ padding: 8 }}>Rol</th>
                  <th style={{ padding: 8 }}>Turno</th>
                  <th style={{ padding: 8 }}>Perfil</th>
                  <th style={{ padding: 8 }}>Acceso</th>
                  <th style={{ padding: 8 }}>Estado</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.usuarioId} style={{ borderBottom: "1px solid var(--h421-gray-200)", background: usuarioEditando?.usuarioId === f.usuarioId ? "var(--h421-gray-50)" : "transparent" }}>
                    <td style={{ padding: 8 }}>{f.usuario.nombre}</td>
                    <td style={{ padding: 8 }}>{f.usuario.username ?? f.usuario.email ?? "—"}</td>
                    <td style={{ padding: 8 }}>{ETIQUETA_ROL[f.rol] ?? f.rol}</td>
                    <td style={{ padding: 8 }}>{f.turno ? ETIQUETA_TURNO[f.turno] : "—"}</td>
                    <td style={{ padding: 8 }}>{f.perfil?.nombre ?? "—"}</td>
                    {/* Con qué entra: al ERP (contraseña + rol con panel) y/o a la terminal (PIN). */}
                    <td style={{ padding: 8, fontSize: 12, whiteSpace: "nowrap" }}>
                      {f.usuario.tienePassword && ROLES_DASHBOARD.includes(f.rol) ? <span style={{ color: "var(--h421-green)" }}>🖥 ERP</span>
                        : f.usuario.tienePassword ? <span style={{ color: "var(--h421-gray-400)" }} title="Tiene contraseña pero su rol solo ve Ventas en el ERP">🖥 solo Ventas</span>
                        : <span style={{ color: "var(--h421-gray-400)" }} title="Sin contraseña: no puede entrar al ERP">🖥 —</span>}
                      {" · "}
                      {f.usuario.tienePin ? <span style={{ color: "var(--h421-green)" }}>📱 PIN</span> : <span style={{ color: "var(--h421-gray-400)" }}>📱 —</span>}
                    </td>
                    <td style={{ padding: 8, color: f.usuario.activo ? "var(--h421-green)" : "var(--h421-red-texto)" }}>{f.usuario.activo ? "Activo" : "Inactivo"}</td>
                    <td style={{ padding: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => seleccionarUsuario(f)} style={{ background: "var(--h421-navy)", color: "#fff", padding: "6px 10px", fontSize: 12 }}>Editar</button>
                      <button onClick={() => toggleActivo(f)} style={{ background: f.usuario.activo ? "var(--h421-red)" : "var(--h421-green)", color: "#fff", padding: "6px 10px", fontSize: 12 }}>
                        {f.usuario.activo ? "Desactivar" : "Activar"}
                      </button>
                      <button onClick={() => eliminarUsuario(f)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "6px 10px", fontSize: 12 }}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin usuarios en esta sucursal.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ maxWidth: 460, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Nuevo usuario</h3>
            <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "0 0 10px", lineHeight: 1.5 }}>
              Para que entre al <strong>ERP (este panel)</strong> necesita usuario o correo, <strong>contraseña</strong> y rol Admin. corporativo, Admin. sucursal o Supervisor.
              Para la <strong>terminal (tablet)</strong> basta el PIN. Puede tener los dos.
            </p>
            {credencialesCreadas && (
              <div style={{ background: "var(--h421-green-bg)", border: "1px solid var(--h421-green)", borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13, textAlign: "left" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>✓ {credencialesCreadas.nombre} creado</strong>
                  <button onClick={() => setCredencialesCreadas(null)} style={{ background: "none", color: "var(--h421-gray-400)", padding: 0 }}>✕</button>
                </div>
                <div style={{ marginTop: 6 }}>Usuario: <code style={{ fontWeight: 700 }}>{credencialesCreadas.usuario}</code></div>
                {credencialesCreadas.password && <div>Contraseña: <code style={{ fontWeight: 700 }}>{credencialesCreadas.password}</code></div>}
                {credencialesCreadas.pin && <div>PIN: <code style={{ fontWeight: 700 }}>{credencialesCreadas.pin}</code></div>}
                <div style={{ marginTop: 6, color: "var(--h421-gray-400)" }}>
                  {credencialesCreadas.entraAlErp ? "Ya puede entrar al ERP desde cualquier dispositivo con estos datos." : credencialesCreadas.password ? "Tiene contraseña, pero con ese rol en el ERP solo verá Ventas." : "Sin contraseña no puede entrar al ERP (solo a la terminal con PIN)."}
                  {" "}Anótalos ahora: la contraseña no se vuelve a mostrar (se guarda cifrada); si se olvida, asígnale una nueva desde Editar.
                </div>
              </div>
            )}
            <input placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} style={inputStyle} />
            <input placeholder="Nombre de usuario" value={nuevo.username} onChange={(e) => setNuevo((n) => ({ ...n, username: e.target.value }))} autoCapitalize="none" autoCorrect="off" spellCheck={false} style={inputStyle} />
            <input placeholder="Correo (opcional si ya diste nombre de usuario)" value={nuevo.email} onChange={(e) => setNuevo((n) => ({ ...n, email: e.target.value }))} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" style={inputStyle} />
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <CampoSecreto valor={nuevo.password} onCambio={(v) => setNuevo((n) => ({ ...n, password: v }))} placeholder="Contraseña (para el ERP)" style={{ flex: 1 }} />
              <button type="button" onClick={() => setNuevo((n) => ({ ...n, password: generarPassword() }))} title="Generar una contraseña segura y legible"
                style={{ background: "var(--h421-gray-50)", border: "1px solid var(--h421-gray-200)", padding: "0 12px", fontSize: 12, whiteSpace: "nowrap" }}>Generar</button>
            </div>
            <CampoSecreto valor={nuevo.pin} onCambio={(v) => setNuevo((n) => ({ ...n, pin: v.replace(/\D/g, "").slice(0, 6) }))} placeholder="PIN (4 dígitos, para la terminal)" style={{ marginBottom: 8 }} autoComplete="off" />
            <select value={nuevo.rol} onChange={(e) => setNuevo((n) => ({ ...n, rol: e.target.value as RolUsuario }))} style={inputStyle}>
              {ROLES.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
            </select>
            <select value={nuevo.turno} onChange={(e) => setNuevo((n) => ({ ...n, turno: e.target.value as TurnoTrabajo | "" }))} style={inputStyle}>
              <option value="">Turno (opcional)</option>
              {TURNOS.map((t) => <option key={t} value={t}>{ETIQUETA_TURNO[t]}</option>)}
            </select>
            <select value={nuevo.perfilId} onChange={(e) => setNuevo((n) => ({ ...n, perfilId: e.target.value }))} style={inputStyle}>
              <option value="">Perfil de permisos (opcional)</option>
              {perfiles.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
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
                <button onClick={() => setUsuarioEditando(null)} style={{ background: "none", color: "var(--h421-gray-400)" }}>✕</button>
              </div>

              <label style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Rol</label>
              <select value={usuarioEditando.rol} onChange={(e) => { const rol = e.target.value as RolUsuario; setUsuarioEditando((u) => u && { ...u, rol }); guardarAsignacion({ rol }); }}
                style={{ width: "100%", padding: 8, marginTop: 4, marginBottom: 12, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
                {ROLES.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
              </select>

              <label style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Turno</label>
              <select value={usuarioEditando.turno ?? ""} onChange={(e) => { const turno = (e.target.value || null) as TurnoTrabajo | null; setUsuarioEditando((u) => u && { ...u, turno }); guardarAsignacion({ turno }); }}
                style={{ width: "100%", padding: 8, marginTop: 4, marginBottom: 12, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
                <option value="">Sin turno</option>
                {TURNOS.map((t) => <option key={t} value={t}>{ETIQUETA_TURNO[t]}</option>)}
              </select>

              <label style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Perfil de permisos</label>
              <select value={usuarioEditando.perfilId ?? ""} onChange={(e) => { const perfilId = e.target.value || null; setUsuarioEditando((u) => u && { ...u, perfilId }); guardarAsignacion({ perfilId }); }}
                style={{ width: "100%", padding: 8, marginTop: 4, marginBottom: 12, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
                <option value="">Sin perfil</option>
                {perfiles.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>

              <label style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Nueva contraseña (acceso al ERP)</label>
              <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "2px 0 6px" }}>
                {usuarioEditando.usuario.tienePassword ? "Ya tiene contraseña. " : "Todavía no tiene contraseña: sin ella no puede entrar al ERP. "}
                La contraseña guardada no se puede ver (se guarda cifrada); aquí se asigna una nueva y la ves mientras la escribes.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 4, marginBottom: 12 }}>
                <CampoSecreto valor={nuevaPassword} onCambio={setNuevaPassword} placeholder="Nueva contraseña" style={{ flex: 1 }} />
                <button type="button" onClick={() => setNuevaPassword(generarPassword())} title="Generar una contraseña segura y legible"
                  style={{ background: "var(--h421-gray-50)", border: "1px solid var(--h421-gray-200)", padding: "0 10px", fontSize: 12 }}>Generar</button>
                <button onClick={guardarPassword} disabled={nuevaPassword.length < 6} style={{ background: "var(--h421-navy)", color: "#fff", padding: "0 14px", opacity: nuevaPassword.length < 6 ? 0.5 : 1 }}>Guardar</button>
              </div>
              {!ROLES_DASHBOARD.includes(usuarioEditando.rol) && (
                <p style={{ fontSize: 12, color: "var(--h421-amber-texto)", margin: "-6px 0 10px" }}>
                  Con el rol {ETIQUETA_ROL[usuarioEditando.rol]} solo verá Ventas en el ERP. Para el panel completo cámbialo a Supervisor o Administrador.
                </p>
              )}

              <label style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Nuevo PIN (acceso a la terminal)</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <CampoSecreto valor={nuevoPin} onCambio={(v) => setNuevoPin(v.replace(/\D/g, "").slice(0, 6))} placeholder="PIN (4 dígitos)" style={{ flex: 1 }} autoComplete="off" />
                <button onClick={guardarPin} disabled={nuevoPin.length < 4} style={{ background: "var(--h421-navy)", color: "#fff", padding: "0 14px", opacity: nuevoPin.length < 4 ? 0.5 : 1 }}>Guardar</button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Horario semanal</h3>
              {horarios.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Sin horario definido.</p>}
              {horarios.map((h) => (
                <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--h421-gray-200)", fontSize: 14 }}>
                  <span>{DIAS[h.diaSemana]} · {h.horaInicio}–{h.horaFin} · {h.sucursal.nombre}{h.notas ? ` (${h.notas})` : ""}</span>
                  <button onClick={() => eliminarHorario(h.id)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "4px 8px", fontSize: 12 }}>Quitar</button>
                </div>
              ))}

              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <select value={nuevoHorario.diaSemana} onChange={(e) => setNuevoHorario((n) => ({ ...n, diaSemana: e.target.value }))} style={{ padding: 8 }}>
                  {DIAS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
                <input type="time" value={nuevoHorario.horaInicio} onChange={(e) => setNuevoHorario((n) => ({ ...n, horaInicio: e.target.value }))} style={{ padding: 8 }} />
                <input type="time" value={nuevoHorario.horaFin} onChange={(e) => setNuevoHorario((n) => ({ ...n, horaFin: e.target.value }))} style={{ padding: 8 }} />
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
