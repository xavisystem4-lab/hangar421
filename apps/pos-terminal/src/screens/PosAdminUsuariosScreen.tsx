import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { RolUsuario } from "@hangar421/shared";
import { usarColores } from "../store/temaStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { abrirBaseDeDatos } from "../db/database";
import { listarUsuariosLocales, eliminarUsuarioLocal, crearUsuarioLocal, guardarRolYPermisos, type UsuarioLocal } from "../db/usuariosLocalesRepo";
import { sincronizarPronto } from "../sync/syncEngine";
import { GRUPOS_PERMISOS, PERMISOS_DEFECTO_POR_ROL, esRolAdmin, permisosEfectivos } from "../auth/permisosTerminal";

/** Roles que se pueden asignar desde la tablet, en el orden en que se ofrecen. */
const ROLES: { rol: RolUsuario; etiqueta: string }[] = [
  { rol: RolUsuario.CAJERO, etiqueta: "Cajero" },
  { rol: RolUsuario.MESERO, etiqueta: "Mesero" },
  { rol: RolUsuario.SUPERVISOR, etiqueta: "Supervisor" },
  { rol: RolUsuario.ADMIN_SUCURSAL, etiqueta: "Admin" },
];

const ETIQUETA_ROL: Record<string, string> = {
  ...Object.fromEntries(ROLES.map((r) => [r.rol, r.etiqueta])),
  [RolUsuario.ADMIN_CORPORATIVO]: "Admin corporativo",
  [RolUsuario.COCINA]: "Cocina",
};

/** Usuarios locales de este dispositivo — quiénes pueden entrar con PIN aquí, con qué rol y qué
 *  funciones tiene cada uno, y si ya quedaron registrados como Usuario real en el ERP (columna
 *  "erp_usuario_id"). El registro es automático: el alta viaja por la cola de sincronización con
 *  el mismo id (ver crearUsuarioLocal), así que un usuario creado sin conexión llega al ERP en
 *  cuanto vuelve la red, sin volver a pedir el PIN.
 *
 *  Solo la ve un administrador (ver SECCIONES_ADMIN en PosNavigator): si un cajero pudiera
 *  entrar aquí, se daría a sí mismo todas las funciones. */
export function PosAdminUsuariosScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const yo = useAuthLocalStore((s) => s.usuario);
  const [usuarios, setUsuarios] = useState<UsuarioLocal[]>([]);

  const [nombreNuevo, setNombreNuevo] = useState("");
  const [pinNuevo, setPinNuevo] = useState("");
  const [rolNuevo, setRolNuevo] = useState<RolUsuario>(RolUsuario.CAJERO);

  // Edición de rol y funciones: una persona a la vez.
  const [editando, setEditando] = useState<UsuarioLocal | null>(null);
  const [rolBorrador, setRolBorrador] = useState<string>(RolUsuario.CAJERO);
  const [permisosBorrador, setPermisosBorrador] = useState<Set<string>>(new Set());

  async function cargar() {
    const db = await abrirBaseDeDatos();
    setUsuarios(await listarUsuariosLocales(db));
  }

  useEffect(() => {
    cargar();
  }, []);

  function confirmarEliminar(u: UsuarioLocal) {
    Alert.alert("Quitar acceso local", `¿"${u.nombre}" deja de poder entrar en ESTE dispositivo? (no borra su cuenta del ERP si ya la tiene)`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Quitar acceso",
        style: "destructive",
        onPress: async () => {
          const db = await abrirBaseDeDatos();
          await eliminarUsuarioLocal(db, u.id);
          cargar();
        },
      },
    ]);
  }

  async function crearUsuario() {
    if (!nombreNuevo.trim() || pinNuevo.length < 4) return;
    const db = await abrirBaseDeDatos();
    await crearUsuarioLocal(db, { nombre: nombreNuevo.trim(), rol: rolNuevo, pin: pinNuevo });
    sincronizarPronto();
    setNombreNuevo("");
    setPinNuevo("");
    setRolNuevo(RolUsuario.CAJERO);
    cargar();
  }

  function empezarEdicion(u: UsuarioLocal) {
    setEditando(u);
    setRolBorrador(u.rol);
    setPermisosBorrador(new Set(permisosEfectivos(u.rol, u.permisos)));
  }

  /** Al cambiar de rol las casillas pasan a las de ese rol: es lo que se espera al "hacer
   *  supervisor" a alguien. Después se pueden ajustar una por una. */
  function cambiarRolBorrador(rol: string) {
    setRolBorrador(rol);
    setPermisosBorrador(new Set(permisosEfectivos(rol, null)));
  }

  function alternarPermiso(clave: string) {
    setPermisosBorrador((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else nuevo.add(clave);
      return nuevo;
    });
  }

  async function guardarEdicion() {
    if (!editando) return;
    const lista = [...permisosBorrador].sort();
    const delRol = [...(PERMISOS_DEFECTO_POR_ROL[rolBorrador] ?? [])].sort();
    // Si queda igual que el rol se guarda null: así, si algún día cambian los permisos por
    // defecto de ese rol, esta persona los recibe en vez de quedarse con una copia vieja.
    const personalizados = esRolAdmin(rolBorrador) || lista.join() === delRol.join() ? null : lista;
    const db = await abrirBaseDeDatos();
    await guardarRolYPermisos(db, editando.id, {
      rol: editando.rolDesdeErp ? undefined : rolBorrador,
      permisos: personalizados,
    });
    const nombre = editando.nombre;
    setEditando(null);
    await cargar();
    Alert.alert("Guardado", `Los cambios de ${nombre} aplican la próxima vez que entre con su PIN.`);
  }

  function resumenPermisos(u: UsuarioLocal): string {
    if (esRolAdmin(u.rol)) return "Todas las funciones";
    const n = permisosEfectivos(u.rol, u.permisos).size;
    const total = GRUPOS_PERMISOS.reduce((s, g) => s + g.permisos.length, 0);
    return `${n} de ${total} funciones${u.permisos ? " · personalizado" : ""}`;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Usuarios y permisos</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>

      {usuarios.map((u) => (
        <View key={u.id} style={estilos.tarjeta}>
          <View style={estilos.filaEncabezado}>
            <Text style={estilos.nombre}>{u.nombre}</Text>
            <Text style={[estilos.pildora, u.erpUsuarioId ? estilos.pildoraOk : estilos.pildoraPendiente]}>
              {u.erpUsuarioId ? "✓ En el ERP" : "Pendiente de sincronizar"}
            </Text>
          </View>
          <Text style={estilos.rol}>{ETIQUETA_ROL[u.rol] ?? u.rol} · {resumenPermisos(u)}</Text>

          {editando?.id === u.id ? (
            <EditorPermisos
              usuario={u}
              esYo={yo?.id === u.id}
              rol={rolBorrador}
              permisos={permisosBorrador}
              onRol={cambiarRolBorrador}
              onAlternar={alternarPermiso}
              onRestablecer={() => setPermisosBorrador(new Set(permisosEfectivos(rolBorrador, null)))}
              onGuardar={guardarEdicion}
              onCancelar={() => setEditando(null)}
            />
          ) : (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <TouchableOpacity onPress={() => empezarEdicion(u)} style={[estilos.botonChico, { backgroundColor: colores.navy }]}>
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Rol y funciones</Text>
              </TouchableOpacity>
              {yo?.id !== u.id && (
                <TouchableOpacity onPress={() => confirmarEliminar(u)} style={[estilos.botonChico, { backgroundColor: colores.red + "22" }]}>
                  <Text style={{ color: colores.red, fontSize: 12 }}>Quitar acceso local</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      ))}

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Nuevo usuario</Text>
        <Text style={estilos.ayuda}>Se registra en el ERP automáticamente, también si ahora no hay conexión: sale en cuanto vuelva la red. Arranca con las funciones de su rol; luego puedes ajustarlas.</Text>
        <TextInput placeholder="Nombre" placeholderTextColor={colores.textoSecundario} value={nombreNuevo} onChangeText={setNombreNuevo} style={estilos.input} />
        <TextInput placeholder="PIN (mínimo 4 dígitos)" placeholderTextColor={colores.textoSecundario} value={pinNuevo} onChangeText={setPinNuevo} secureTextEntry keyboardType="number-pad" style={estilos.input} />
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {ROLES.map(({ rol, etiqueta }) => (
            <TouchableOpacity key={rol} onPress={() => setRolNuevo(rol)} style={[estilos.chipRol, rolNuevo === rol && estilos.chipRolActivo]}>
              <Text style={{ color: rolNuevo === rol ? "#fff" : colores.texto, fontSize: 13 }}>{etiqueta}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={crearUsuario} disabled={!nombreNuevo.trim() || pinNuevo.length < 4} style={estilos.botonPrincipal}>
          <Text style={estilos.botonPrincipalTexto}>Crear usuario</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function EditorPermisos({
  usuario,
  esYo,
  rol,
  permisos,
  onRol,
  onAlternar,
  onRestablecer,
  onGuardar,
  onCancelar,
}: {
  usuario: UsuarioLocal;
  esYo: boolean;
  rol: string;
  permisos: Set<string>;
  onRol: (rol: string) => void;
  onAlternar: (clave: string) => void;
  onRestablecer: () => void;
  onGuardar: () => void;
  onCancelar: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const admin = esRolAdmin(rol);
  // Nadie se quita a sí mismo el rol de admin: dejaría la tablet sin quien la administre.
  // Y a quien el ERP le asignó sucursales, el ERP le reescribe el rol en cada sincronización.
  const rolBloqueado = esYo || !!usuario.rolDesdeErp;

  return (
    <View style={estilos.editor}>
      <Text style={estilos.subtitulo}>Rol</Text>
      {rolBloqueado ? (
        <Text style={estilos.ayuda}>
          {esYo
            ? "No puedes cambiar tu propio rol."
            : "Su rol lo asigna el ERP para esta sucursal; cámbialo allá (Usuarios). Sus funciones sí se ajustan aquí."}
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            {ROLES.map(({ rol: r, etiqueta }) => (
              <TouchableOpacity key={r} onPress={() => onRol(r)} style={[estilos.chipRol, rol === r && estilos.chipRolActivo]}>
                <Text style={{ color: rol === r ? "#fff" : colores.texto, fontSize: 13 }}>{etiqueta}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {rol !== usuario.rol && (rol === RolUsuario.SUPERVISOR || admin) && (
            <Text style={estilos.ayuda}>
              El cambio de rol es solo en esta tablet. Para que el ERP acepte las cancelaciones y
              cortesías que autorice, cámbiale también el rol en el ERP.
            </Text>
          )}
        </>
      )}

      <Text style={[estilos.subtitulo, { marginTop: 12 }]}>¿Qué puede hacer?</Text>
      {admin && <Text style={estilos.ayuda}>Un administrador tiene todas las funciones, incluida la gestión de usuarios.</Text>}

      {GRUPOS_PERMISOS.map((grupo) => (
        <View key={grupo.titulo} style={{ marginTop: 8 }}>
          <Text style={estilos.tituloGrupo}>{grupo.titulo}</Text>
          {grupo.permisos.map((p) => {
            const marcado = admin || permisos.has(p.clave);
            return (
              <TouchableOpacity
                key={p.clave}
                onPress={() => onAlternar(p.clave)}
                disabled={admin}
                style={[estilos.filaCheck, admin && { opacity: 0.6 }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: marcado, disabled: admin }}
              >
                <View style={[estilos.check, marcado && estilos.checkMarcado]}>
                  {marcado && <Text style={estilos.checkPalomita}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={estilos.etiquetaCheck}>{p.etiqueta}</Text>
                  {p.ayuda && <Text style={estilos.ayuda}>{p.ayuda}</Text>}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <Text style={[estilos.ayuda, { marginTop: 8 }]}>
        Si toca una función sin palomita, la tablet le pedirá el PIN de un supervisor o administrador.
      </Text>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {!admin && (
          <TouchableOpacity onPress={onRestablecer} style={[estilos.botonChico, { backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde }]}>
            <Text style={{ color: colores.texto, fontSize: 12 }}>Restablecer a las del rol</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onCancelar} style={[estilos.botonChico, { backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde }]}>
          <Text style={{ color: colores.texto, fontSize: 12 }}>Cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onGuardar} style={[estilos.botonChico, { backgroundColor: colores.green }]}>
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Guardar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    titulo: { fontSize: 20, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    nombre: { fontSize: 16, fontWeight: "800", color: colores.texto },
    rol: { fontSize: 12, color: colores.textoSecundario, marginTop: 2 },
    pildora: { fontSize: 11, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
    pildoraOk: { backgroundColor: "#1F9D5522", color: "#1F9D55" },
    pildoraPendiente: { backgroundColor: "#9CA3AF22", color: "#6B7280" },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginBottom: 6 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginBottom: 10 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 12 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonChico: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, minHeight: 40, justifyContent: "center" },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
    chipRol: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipRolActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    editor: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colores.borde },
    tituloGrupo: { fontSize: 13, fontWeight: "800", color: colores.textoSecundario, textTransform: "uppercase", marginBottom: 2 },
    filaCheck: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, minHeight: 44 },
    check: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colores.borde, alignItems: "center", justifyContent: "center" },
    checkMarcado: { backgroundColor: colores.navy, borderColor: colores.navy },
    checkPalomita: { color: "#fff", fontWeight: "900", fontSize: 15 },
    etiquetaCheck: { fontSize: 14, color: colores.texto },
  });
}
