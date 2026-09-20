import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { ErrorErp, erpFetch } from "../api/erpHttp";
import { guardarSucursalErp, obtenerSucursalErp } from "../db/dispositivoLocal";

interface UsuarioErp {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

/** Roles que el backend acepta para renombrar (ROLES_RENOMBRAN en sucursales.service.ts). No
 *  incluye SUPERVISOR: cambiar el nombre afecta a todo lo que el ERP muestra de esa sucursal. */
const ROLES_RENOMBRAN = ["ADMIN_SUCURSAL", "ADMIN_CORPORATIVO"];

/**
 * Cambia el nombre de la sucursal en el ERP desde la terminal.
 *
 * Pide la CONTRASEÑA de un administrador, no el PIN local, a diferencia de cancelar un ticket.
 * El motivo es que son cosas distintas: cancelar tiene que funcionar sin red —por eso se
 * autoriza contra el hash local— mientras que renombrar es un cambio que vive en el ERP y no
 * tiene sentido offline. Al exigir conexión de todos modos, se puede validar contra el servidor,
 * que es más fuerte.
 */
export function ModalRenombrarSucursal({
  nombreActual,
  onCerrar,
  onRenombrada,
}: {
  nombreActual: string;
  onCerrar: () => void;
  onRenombrada: (nuevoNombre: string) => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [nombre, setNombre] = useState(nombreActual);
  const [admins, setAdmins] = useState<UsuarioErp[] | null>(null);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const db = await abrirBaseDeDatos();
        const sucursalId = await obtenerSucursalErp(db);
        if (!sucursalId) { setAdmins([]); return; }
        // Lista pública de personal de la sucursal (no expone contraseñas ni PINes) — la misma
        // que usa el POS Windows para elegir quién autoriza.
        const usuarios = await erpFetch<UsuarioErp[]>(`/auth/usuarios-login?sucursalId=${sucursalId}`);
        const autorizados = usuarios.filter((u) => ROLES_RENOMBRAN.includes(u.rol));
        setAdmins(autorizados);
        if (autorizados.length === 1) setAdminId(autorizados[0].id);
      } catch {
        setAdmins([]);
        setError("No se pudo contactar con el ERP. Cambiar el nombre requiere conexión.");
      }
    })();
  }, []);

  async function guardar() {
    const limpio = nombre.trim();
    if (!limpio || !adminId || !password || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const db = await abrirBaseDeDatos();
      const sucursalId = await obtenerSucursalErp(db);
      if (!sucursalId) throw new Error("Esta terminal no está enlazada a ninguna sucursal.");

      await erpFetch(`/sucursales/${sucursalId}/nombre`, {
        method: "PATCH",
        body: JSON.stringify({ nombre: limpio, autorizadoPorId: adminId, password }),
      });

      // El ERP ya tiene el nombre nuevo; se actualiza también en local para que la cabecera lo
      // refleje de inmediato sin esperar a la siguiente sincronización.
      await guardarSucursalErp(db, sucursalId, limpio);
      onRenombrada(limpio);
    } catch (e: any) {
      if (e instanceof ErrorErp && (e.status === 401 || e.status === 403)) {
        setError("Contraseña incorrecta, o ese usuario no puede renombrar la sucursal.");
      } else {
        setError(e?.message ?? "No se pudo cambiar el nombre.");
      }
      setPassword("");
    } finally {
      setGuardando(false);
    }
  }

  const listo = nombre.trim().length > 0 && nombre.trim() !== nombreActual && !!adminId && password.length > 0;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCerrar}>
      <View style={estilos.fondo}>
        <View style={estilos.hoja}>
          <View style={estilos.encabezado}>
            <Text style={estilos.titulo}>Cambiar nombre de la sucursal</Text>
            <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
          </View>
          <Text style={estilos.ayuda}>
            El cambio se guarda en el ERP, así que se ve al momento en el panel web y en las demás
            terminales de esta sucursal.
          </Text>

          <Text style={estilos.etiqueta}>Nombre</Text>
          <TextInput
            value={nombre}
            onChangeText={(v) => { setNombre(v.slice(0, 80)); setError(null); }}
            placeholder="Ej. Condesa"
            placeholderTextColor={colores.textoSecundario}
            style={estilos.input}
            accessibilityLabel="Nombre de la sucursal"
          />

          {admins === null ? (
            <ActivityIndicator color={colores.navy} style={{ marginVertical: 18 }} />
          ) : admins.length === 0 ? (
            <Text style={estilos.error}>
              {error ?? "No hay ningún administrador en esta sucursal que pueda autorizar el cambio."}
            </Text>
          ) : (
            <>
              <Text style={estilos.etiqueta}>Autoriza</Text>
              <ScrollView style={{ maxHeight: 150 }}>
                {admins.map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    onPress={() => { setAdminId(a.id); setError(null); }}
                    style={[estilos.fila, adminId === a.id && estilos.filaActiva]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[estilos.nombreAdmin, adminId === a.id && { color: "#fff" }]}>{a.nombre}</Text>
                      <Text style={[estilos.emailAdmin, adminId === a.id && { color: "rgba(255,255,255,0.8)" }]}>{a.email}</Text>
                    </View>
                    {adminId === a.id && <Text style={{ color: "#fff", fontSize: 18 }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={estilos.etiqueta}>Contraseña</Text>
              <TextInput
                value={password}
                onChangeText={(v) => { setPassword(v); setError(null); }}
                secureTextEntry
                placeholder="Contraseña del administrador"
                placeholderTextColor={colores.textoSecundario}
                style={estilos.input}
                accessibilityLabel="Contraseña del administrador"
              />

              {error && <Text style={estilos.error}>{error}</Text>}

              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <TouchableOpacity onPress={onCerrar} style={estilos.botonCancelar}>
                  <Text style={estilos.botonCancelarTexto}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={guardar} disabled={!listo || guardando} style={[estilos.botonGuardar, (!listo || guardando) && { opacity: 0.5 }]}>
                  {guardando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonGuardarTexto}>Guardar</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    hoja: { backgroundColor: colores.fondo, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "88%" },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 18, fontWeight: "800", color: colores.texto, flex: 1 },
    cerrar: { color: colores.textoSecundario, fontSize: 22, paddingHorizontal: 8 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginTop: 6, lineHeight: 17 },
    etiqueta: { fontSize: 11, color: colores.textoSecundario, fontWeight: "700", textTransform: "uppercase", marginTop: 14, marginBottom: 6 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 14, fontSize: 16, color: colores.texto },
    fila: {
      flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, marginBottom: 6,
      backgroundColor: colores.superficie, borderWidth: 1, borderColor: colores.borde, minHeight: 54,
    },
    filaActiva: { backgroundColor: colores.navy, borderColor: colores.navy },
    nombreAdmin: { fontSize: 15, fontWeight: "700", color: colores.texto },
    emailAdmin: { fontSize: 12, color: colores.textoSecundario },
    error: { color: colores.red, fontSize: 13, marginTop: 10, lineHeight: 18 },
    botonCancelar: { flex: 1, padding: 15, borderRadius: 10, backgroundColor: colores.gray50, alignItems: "center", minHeight: 50, justifyContent: "center" },
    botonCancelarTexto: { fontWeight: "700", color: colores.texto },
    botonGuardar: { flex: 2, padding: 15, borderRadius: 10, backgroundColor: colores.green, alignItems: "center", minHeight: 50, justifyContent: "center" },
    botonGuardarTexto: { color: "#fff", fontWeight: "800", fontSize: 15 },
  });
}
