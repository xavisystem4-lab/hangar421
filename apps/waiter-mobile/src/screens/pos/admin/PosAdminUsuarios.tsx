import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { Perfil, RolUsuario, Sucursal, TurnoTrabajo } from "@hangar421/shared";
import { PERMISOS } from "@hangar421/shared";
import { apiFetch } from "../../../api/http";
import { useAuthStore } from "../../../store/authStore";
import { usarColores } from "../../../store/temaStore";

interface UsuarioSucursalRow {
  usuarioId: string; sucursalId: string; rol: RolUsuario; turno: TurnoTrabajo | null; perfilId: string | null; activo: boolean;
  usuario: { id: string; nombre: string; email: string | null; username: string | null; activo: boolean };
  perfil: { id: string; nombre: string } | null;
}
interface HorarioRow { id: string; usuarioId: string; sucursalId: string; diaSemana: number; horaInicio: string; horaFin: string; notas: string | null; sucursal: { id: string; nombre: string } }

const ROLES: RolUsuario[] = ["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL", "SUPERVISOR", "CAJERO", "MESERO", "COCINA"] as RolUsuario[];
const ETIQUETA_ROL: Record<string, string> = {
  ADMIN_CORPORATIVO: "Admin. corporativo", ADMIN_SUCURSAL: "Admin. sucursal", SUPERVISOR: "Supervisor", CAJERO: "Cajero", MESERO: "Mesero", COCINA: "Cocina",
};
const TURNOS: TurnoTrabajo[] = ["MATUTINO", "VESPERTINO", "NOCTURNO", "MIXTO"] as TurnoTrabajo[];
const ETIQUETA_TURNO: Record<string, string> = { MATUTINO: "Matutino", VESPERTINO: "Vespertino", NOCTURNO: "Nocturno", MIXTO: "Mixto" };
const ETIQUETA_PERMISO: Record<string, string> = {
  [PERMISOS.VENTA_CREAR]: "Crear pedidos", [PERMISOS.VENTA_COBRAR]: "Cobrar pedidos", [PERMISOS.VENTA_DESCUENTO]: "Aplicar descuentos",
  [PERMISOS.VENTA_CANCELAR]: "Cancelar pedidos", [PERMISOS.VENTA_DEVOLUCION]: "Hacer devoluciones", [PERMISOS.CAJA_APERTURA]: "Abrir caja",
  [PERMISOS.CAJA_CORTE]: "Cerrar/cortar caja", [PERMISOS.MESA_TRANSFERIR]: "Transferir mesas", [PERMISOS.PEDIDO_REABRIR]: "Reabrir pedidos cobrados",
  [PERMISOS.CATALOGO_EDITAR]: "Editar catálogo", [PERMISOS.INVENTARIO_AJUSTAR]: "Ajustar inventario", [PERMISOS.TRASPASO_AUTORIZAR]: "Autorizar traspasos",
  [PERMISOS.USUARIOS_ADMINISTRAR]: "Administrar usuarios", [PERMISOS.REPORTES_GLOBALES]: "Ver reportes globales",
};
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Alta/edición de usuarios, perfiles de permisos y horario semanal — mismo módulo que
 *  AdminUsuarios.tsx del POS Windows. El panel de edición va debajo de la tabla en vez de al
 *  lado (no hay ancho de escritorio en tablet). */
export function PosAdminUsuarios() {
  const { usuario: usuarioSesion } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [filas, setFilas] = useState<UsuarioSucursalRow[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [mostrarPerfiles, setMostrarPerfiles] = useState(false);
  const [nuevoPerfil, setNuevoPerfil] = useState<{ nombre: string; descripcion: string; permisos: string[] }>({ nombre: "", descripcion: "", permisos: [] });
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);

  const [nuevo, setNuevo] = useState({ nombre: "", email: "", username: "", password: "", pin: "", rol: "CAJERO" as RolUsuario, turno: "" as TurnoTrabajo | "", perfilId: "" });
  const [creando, setCreando] = useState(false);

  const [usuarioEditando, setUsuarioEditando] = useState<UsuarioSucursalRow | null>(null);
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [nuevoPin, setNuevoPin] = useState("");

  const [horarios, setHorarios] = useState<HorarioRow[]>([]);
  const [nuevoHorario, setNuevoHorario] = useState({ diaSemana: 1, horaInicio: "09:00", horaFin: "17:00", notas: "" });

  async function cargar(suc: string) {
    if (!suc) return;
    setFilas(await apiFetch<UsuarioSucursalRow[]>(`/usuarios?sucursalId=${suc}`));
  }
  async function cargarPerfiles() {
    if (!usuarioSesion) return;
    setPerfiles(await apiFetch<Perfil[]>(`/perfiles?empresaId=${usuarioSesion.empresaId}`));
  }

  useEffect(() => {
    if (!usuarioSesion) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuarioSesion.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargar(s[0].id); }
    });
    cargarPerfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioSesion]);

  async function crearUsuario() {
    if (!usuarioSesion || !nuevo.nombre.trim() || (!nuevo.email.trim() && !nuevo.username.trim()) || !sucursalId) return;
    setCreando(true);
    setMensaje(null);
    try {
      await apiFetch("/usuarios", {
        method: "POST",
        body: JSON.stringify({
          empresaId: usuarioSesion.empresaId, nombre: nuevo.nombre, email: nuevo.email || undefined, username: nuevo.username || undefined,
          password: nuevo.password || undefined, pin: nuevo.pin || undefined,
          sucursales: [{ sucursalId, rol: nuevo.rol, turno: nuevo.turno || undefined, perfilId: nuevo.perfilId || undefined }],
        }),
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
    setNuevaPassword("");
    setMensaje("Contraseña actualizada.");
  }
  async function guardarPin() {
    if (!usuarioEditando || !nuevoPin) return;
    await apiFetch(`/usuarios/${usuarioEditando.usuarioId}/pin`, { method: "PATCH", body: JSON.stringify({ pin: nuevoPin }) });
    setNuevoPin("");
    setMensaje("PIN actualizado.");
  }
  async function guardarAsignacion(cambios: Partial<{ rol: RolUsuario; turno: TurnoTrabajo | null; perfilId: string | null }>) {
    if (!usuarioEditando) return;
    await apiFetch(`/usuarios/${usuarioEditando.usuarioId}/sucursales/${usuarioEditando.sucursalId}`, { method: "PATCH", body: JSON.stringify(cambios) });
    await cargar(sucursalId);
    setMensaje("Actualizado.");
  }
  async function toggleActivo(fila: UsuarioSucursalRow) {
    await apiFetch(`/usuarios/${fila.usuarioId}/${fila.usuario.activo ? "desactivar" : "activar"}`, { method: "PATCH" });
    cargar(sucursalId);
  }
  function confirmarEliminar(fila: UsuarioSucursalRow) {
    Alert.alert("Eliminar usuario", `¿Eliminar a "${fila.usuario.nombre}"? No podrá volver a iniciar sesión; su historial de pedidos, turnos de caja y auditoría se conserva.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => { await apiFetch(`/usuarios/${fila.usuarioId}`, { method: "DELETE" }); if (usuarioEditando?.usuarioId === fila.usuarioId) setUsuarioEditando(null); cargar(sucursalId); } },
    ]);
  }
  async function seleccionarUsuario(fila: UsuarioSucursalRow) {
    setUsuarioEditando(fila);
    setNuevaPassword("");
    setNuevoPin("");
    setHorarios(await apiFetch<HorarioRow[]>(`/usuarios/${fila.usuarioId}/horarios`));
  }
  async function agregarHorario() {
    if (!usuarioEditando) return;
    await apiFetch(`/usuarios/${usuarioEditando.usuarioId}/horarios`, { method: "POST", body: JSON.stringify({ sucursalId, diaSemana: nuevoHorario.diaSemana, horaInicio: nuevoHorario.horaInicio, horaFin: nuevoHorario.horaFin, notas: nuevoHorario.notas || undefined }) });
    setNuevoHorario({ diaSemana: 1, horaInicio: "09:00", horaFin: "17:00", notas: "" });
    setHorarios(await apiFetch<HorarioRow[]>(`/usuarios/${usuarioEditando.usuarioId}/horarios`));
  }
  async function eliminarHorario(id: string) {
    await apiFetch(`/usuarios/horarios/${id}`, { method: "DELETE" });
    setHorarios((h) => h.filter((x) => x.id !== id));
  }
  function togglePermisoNuevo(clave: string) {
    setNuevoPerfil((p) => ({ ...p, permisos: p.permisos.includes(clave) ? p.permisos.filter((x) => x !== clave) : [...p.permisos, clave] }));
  }
  async function crearPerfil() {
    if (!usuarioSesion || !nuevoPerfil.nombre.trim()) return;
    setGuardandoPerfil(true);
    setMensaje(null);
    try {
      await apiFetch("/perfiles", { method: "POST", body: JSON.stringify({ empresaId: usuarioSesion.empresaId, nombre: nuevoPerfil.nombre, descripcion: nuevoPerfil.descripcion || undefined, permisos: nuevoPerfil.permisos }) });
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
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.filaEncabezado}>
        <Text style={estilos.titulo}>Usuarios</Text>
        <TouchableOpacity onPress={() => setMostrarPerfiles((v) => !v)} style={[estilos.botonChico, { backgroundColor: colores.navy }]}><Text style={{ color: "#fff", fontSize: 13 }}>Perfiles</Text></TouchableOpacity>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 10 }}>
        {sucursales.map((s) => (
          <TouchableOpacity key={s.id} onPress={() => { setSucursalId(s.id); setUsuarioEditando(null); cargar(s.id); }} style={[estilos.chip, sucursalId === s.id && estilos.chipActivo]}>
            <Text style={{ color: sucursalId === s.id ? "#fff" : colores.texto, fontSize: 13 }}>{s.nombre}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mensaje && <Text style={estilos.mensaje}>{mensaje}</Text>}

      {mostrarPerfiles && (
        <View style={estilos.tarjeta}>
          <View style={estilos.filaEncabezado}>
            <Text style={estilos.subtitulo}>Perfiles de permisos</Text>
            <TouchableOpacity onPress={() => setMostrarPerfiles(false)}><Text style={{ color: colores.textoSecundario, fontSize: 18 }}>✕</Text></TouchableOpacity>
          </View>
          {perfiles.length === 0 && <Text style={estilos.ayuda}>Aún no hay perfiles creados.</Text>}
          {perfiles.map((p) => (
            <View key={p.id} style={{ borderBottomWidth: 1, borderBottomColor: colores.borde, paddingVertical: 8 }}>
              <View style={estilos.filaEncabezado}>
                <Text style={{ color: colores.texto, fontWeight: "700" }}>{p.nombre}{p.descripcion ? ` — ${p.descripcion}` : ""}</Text>
                <TouchableOpacity onPress={() => togglePerfilActivo(p)} style={[estilos.botonChico, { backgroundColor: p.activo ? colores.red : colores.green }]}><Text style={{ color: "#fff", fontSize: 12 }}>{p.activo ? "Desactivar" : "Activar"}</Text></TouchableOpacity>
              </View>
              <Text style={estilos.ayuda}>{p.permisos.length === 0 ? "Sin permisos asignados" : p.permisos.map((c) => ETIQUETA_PERMISO[c] ?? c).join(", ")}</Text>
            </View>
          ))}

          <Text style={[estilos.subtitulo, { marginTop: 12 }]}>Nuevo perfil</Text>
          <TextInput placeholder="Nombre del perfil (ej. Cajero senior)" placeholderTextColor={colores.textoSecundario} value={nuevoPerfil.nombre} onChangeText={(v) => setNuevoPerfil((p) => ({ ...p, nombre: v }))} style={estilos.input} />
          <TextInput placeholder="Descripción (opcional)" placeholderTextColor={colores.textoSecundario} value={nuevoPerfil.descripcion} onChangeText={(v) => setNuevoPerfil((p) => ({ ...p, descripcion: v }))} style={estilos.input} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {Object.values(PERMISOS).map((clave) => (
              <TouchableOpacity key={clave} onPress={() => togglePermisoNuevo(clave)} style={[estilos.chip, nuevoPerfil.permisos.includes(clave) && estilos.chipActivo]}>
                <Text style={{ color: nuevoPerfil.permisos.includes(clave) ? "#fff" : colores.texto, fontSize: 12 }}>{ETIQUETA_PERMISO[clave] ?? clave}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={crearPerfil} disabled={guardandoPerfil || !nuevoPerfil.nombre.trim()} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>{guardandoPerfil ? "Guardando…" : "Crear perfil"}</Text></TouchableOpacity>
        </View>
      )}

      <View style={estilos.tarjeta}>
        {filas.map((f) => (
          <View key={f.usuarioId} style={[estilos.filaUsuario, usuarioEditando?.usuarioId === f.usuarioId && { backgroundColor: colores.gray50 }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colores.texto, fontWeight: "700" }}>{f.usuario.nombre}</Text>
              <Text style={estilos.ayuda}>{f.usuario.username ?? f.usuario.email ?? "—"} · {ETIQUETA_ROL[f.rol] ?? f.rol}{f.turno ? ` · ${ETIQUETA_TURNO[f.turno]}` : ""}{f.perfil ? ` · ${f.perfil.nombre}` : ""}</Text>
              <Text style={{ fontSize: 12, color: f.usuario.activo ? colores.green : colores.red, marginTop: 2 }}>{f.usuario.activo ? "Activo" : "Inactivo"}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <TouchableOpacity onPress={() => seleccionarUsuario(f)} style={[estilos.botonChico, { backgroundColor: colores.navy }]}><Text style={{ color: "#fff", fontSize: 12 }}>Editar</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => toggleActivo(f)} style={[estilos.botonChico, { backgroundColor: f.usuario.activo ? colores.red : colores.green }]}><Text style={{ color: "#fff", fontSize: 12 }}>{f.usuario.activo ? "Desactivar" : "Activar"}</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => confirmarEliminar(f)} style={[estilos.botonChico, { backgroundColor: colores.red + "22" }]}><Text style={{ color: colores.red, fontSize: 12 }}>Eliminar</Text></TouchableOpacity>
            </View>
          </View>
        ))}
        {filas.length === 0 && <Text style={estilos.ayuda}>Sin usuarios en esta sucursal.</Text>}
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Nuevo usuario</Text>
        <TextInput placeholder="Nombre" placeholderTextColor={colores.textoSecundario} value={nuevo.nombre} onChangeText={(v) => setNuevo((n) => ({ ...n, nombre: v }))} style={estilos.input} />
        <TextInput placeholder="Nombre de usuario" placeholderTextColor={colores.textoSecundario} value={nuevo.username} onChangeText={(v) => setNuevo((n) => ({ ...n, username: v }))} style={estilos.input} autoCapitalize="none" />
        <TextInput placeholder="Correo (opcional si ya diste nombre de usuario)" placeholderTextColor={colores.textoSecundario} value={nuevo.email} onChangeText={(v) => setNuevo((n) => ({ ...n, email: v }))} style={estilos.input} autoCapitalize="none" keyboardType="email-address" />
        <TextInput placeholder="Contraseña" placeholderTextColor={colores.textoSecundario} value={nuevo.password} onChangeText={(v) => setNuevo((n) => ({ ...n, password: v }))} secureTextEntry style={estilos.input} />
        <TextInput placeholder="PIN (4 dígitos)" placeholderTextColor={colores.textoSecundario} value={nuevo.pin} onChangeText={(v) => setNuevo((n) => ({ ...n, pin: v }))} keyboardType="number-pad" style={estilos.input} />
        <Text style={estilos.ayuda}>Rol</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 8 }}>
          {ROLES.map((r) => (
            <TouchableOpacity key={r} onPress={() => setNuevo((n) => ({ ...n, rol: r }))} style={[estilos.chip, nuevo.rol === r && estilos.chipActivo]}>
              <Text style={{ color: nuevo.rol === r ? "#fff" : colores.texto, fontSize: 12 }}>{ETIQUETA_ROL[r]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={estilos.ayuda}>Turno (opcional)</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 8 }}>
          {TURNOS.map((t) => (
            <TouchableOpacity key={t} onPress={() => setNuevo((n) => ({ ...n, turno: n.turno === t ? "" : t }))} style={[estilos.chip, nuevo.turno === t && estilos.chipActivo]}>
              <Text style={{ color: nuevo.turno === t ? "#fff" : colores.texto, fontSize: 12 }}>{ETIQUETA_TURNO[t]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={estilos.ayuda}>Perfil de permisos (opcional)</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 10 }}>
          {perfiles.filter((p) => p.activo).map((p) => (
            <TouchableOpacity key={p.id} onPress={() => setNuevo((n) => ({ ...n, perfilId: n.perfilId === p.id ? "" : p.id }))} style={[estilos.chip, nuevo.perfilId === p.id && estilos.chipActivo]}>
              <Text style={{ color: nuevo.perfilId === p.id ? "#fff" : colores.texto, fontSize: 12 }}>{p.nombre}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={estilos.ayuda}>Se asigna a la sucursal seleccionada arriba: {sucursales.find((s) => s.id === sucursalId)?.nombre}.</Text>
        <TouchableOpacity onPress={crearUsuario} disabled={creando} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>{creando ? "Creando…" : "Crear usuario"}</Text></TouchableOpacity>
      </View>

      {usuarioEditando && (
        <>
          <View style={estilos.tarjeta}>
            <View style={estilos.filaEncabezado}>
              <Text style={estilos.subtitulo}>{usuarioEditando.usuario.nombre}</Text>
              <TouchableOpacity onPress={() => setUsuarioEditando(null)}><Text style={{ color: colores.textoSecundario, fontSize: 18 }}>✕</Text></TouchableOpacity>
            </View>

            <Text style={estilos.ayuda}>Rol</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 10 }}>
              {ROLES.map((r) => (
                <TouchableOpacity key={r} onPress={() => { setUsuarioEditando((u) => u && { ...u, rol: r }); guardarAsignacion({ rol: r }); }} style={[estilos.chip, usuarioEditando.rol === r && estilos.chipActivo]}>
                  <Text style={{ color: usuarioEditando.rol === r ? "#fff" : colores.texto, fontSize: 12 }}>{ETIQUETA_ROL[r]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={estilos.ayuda}>Turno</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 10 }}>
              {TURNOS.map((t) => (
                <TouchableOpacity key={t} onPress={() => { const turno = usuarioEditando.turno === t ? null : t; setUsuarioEditando((u) => u && { ...u, turno }); guardarAsignacion({ turno }); }} style={[estilos.chip, usuarioEditando.turno === t && estilos.chipActivo]}>
                  <Text style={{ color: usuarioEditando.turno === t ? "#fff" : colores.texto, fontSize: 12 }}>{ETIQUETA_TURNO[t]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={estilos.ayuda}>Perfil de permisos</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 10 }}>
              {perfiles.filter((p) => p.activo).map((p) => (
                <TouchableOpacity key={p.id} onPress={() => { const perfilId = usuarioEditando.perfilId === p.id ? null : p.id; setUsuarioEditando((u) => u && { ...u, perfilId }); guardarAsignacion({ perfilId }); }} style={[estilos.chip, usuarioEditando.perfilId === p.id && estilos.chipActivo]}>
                  <Text style={{ color: usuarioEditando.perfilId === p.id ? "#fff" : colores.texto, fontSize: 12 }}>{p.nombre}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={estilos.ayuda}>Nueva contraseña</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6, marginBottom: 10 }}>
              <TextInput value={nuevaPassword} onChangeText={setNuevaPassword} secureTextEntry style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
              <TouchableOpacity onPress={guardarPassword} style={[estilos.botonChico, { backgroundColor: colores.navy }]}><Text style={{ color: "#fff" }}>Guardar</Text></TouchableOpacity>
            </View>

            <Text style={estilos.ayuda}>Nuevo PIN</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              <TextInput value={nuevoPin} onChangeText={setNuevoPin} keyboardType="number-pad" style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
              <TouchableOpacity onPress={guardarPin} style={[estilos.botonChico, { backgroundColor: colores.navy }]}><Text style={{ color: "#fff" }}>Guardar</Text></TouchableOpacity>
            </View>
          </View>

          <View style={estilos.tarjeta}>
            <Text style={estilos.subtitulo}>Horario semanal</Text>
            {horarios.length === 0 && <Text style={estilos.ayuda}>Sin horario definido.</Text>}
            {horarios.map((h) => (
              <View key={h.id} style={estilos.filaReceta}>
                <Text style={{ color: colores.texto, fontSize: 13 }}>{DIAS[h.diaSemana]} · {h.horaInicio}–{h.horaFin} · {h.sucursal.nombre}{h.notas ? ` (${h.notas})` : ""}</Text>
                <TouchableOpacity onPress={() => eliminarHorario(h.id)}><Text style={{ color: colores.red, fontSize: 12 }}>Quitar</Text></TouchableOpacity>
              </View>
            ))}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {DIAS.map((d, i) => (
                <TouchableOpacity key={i} onPress={() => setNuevoHorario((n) => ({ ...n, diaSemana: i }))} style={[estilos.chip, nuevoHorario.diaSemana === i && estilos.chipActivo]}>
                  <Text style={{ color: nuevoHorario.diaSemana === i ? "#fff" : colores.texto, fontSize: 12 }}>{d.slice(0, 3)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <TextInput placeholder="09:00" placeholderTextColor={colores.textoSecundario} value={nuevoHorario.horaInicio} onChangeText={(v) => setNuevoHorario((n) => ({ ...n, horaInicio: v }))} style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
              <TextInput placeholder="17:00" placeholderTextColor={colores.textoSecundario} value={nuevoHorario.horaFin} onChangeText={(v) => setNuevoHorario((n) => ({ ...n, horaFin: v }))} style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
            </View>
            <TextInput placeholder="Notas (opcional)" placeholderTextColor={colores.textoSecundario} value={nuevoHorario.notas} onChangeText={(v) => setNuevoHorario((n) => ({ ...n, notas: v }))} style={[estilos.input, { marginTop: 8 }]} />
            <TouchableOpacity onPress={agregarHorario} style={[estilos.botonPrincipal, { marginTop: 4 }]}><Text style={estilos.botonPrincipalTexto}>Agregar horario</Text></TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto },
    subtitulo: { fontSize: 16, fontWeight: "800", color: colores.texto, marginBottom: 8 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginTop: 4 },
    mensaje: { color: colores.navyTexto, marginBottom: 10 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 14 },
    filaUsuario: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde, gap: 8 },
    filaReceta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colores.borde },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonChico: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
  });
}
