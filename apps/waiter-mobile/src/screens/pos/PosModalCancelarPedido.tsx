import { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { apiFetch } from "../../api/http";
import { usarColores } from "../../store/temaStore";

interface UsuarioLogin { id: string; nombre: string; rol: string | null }

// Deben coincidir con ROLES_AUTORIZAN_CANCELACION en apps/backend/src/pedidos/pedidos.service.ts.
const ROLES_AUTORIZAN = new Set(["SUPERVISOR", "ADMIN_SUCURSAL", "ADMIN_CORPORATIVO"]);
const ETIQUETA_ROL: Record<string, string> = {
  ADMIN_CORPORATIVO: "Admin. corporativo", ADMIN_SUCURSAL: "Admin. sucursal", SUPERVISOR: "Supervisor",
};

/** Cancelar una cuenta ya enviada — requiere la CONTRASEÑA de un Supervisor/Admin, verificada en
 *  el servidor (POST /pedidos/:id/cancelar). Mismo patrón que ModalCancelarPedido.tsx del POS
 *  Windows, con contraseña en vez de PIN. */
export function PosModalCancelarPedido({
  pedidoId,
  sucursalId,
  etiqueta,
  onCerrar,
  onCancelado,
}: {
  pedidoId: string;
  sucursalId: string;
  etiqueta: string;
  onCerrar: () => void;
  onCancelado: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [motivo, setMotivo] = useState("");
  const [autorizadores, setAutorizadores] = useState<UsuarioLogin[] | null>(null);
  const [usuarioAutorizaId, setUsuarioAutorizaId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  useEffect(() => {
    apiFetch<UsuarioLogin[]>(`/auth/usuarios-login?sucursalId=${encodeURIComponent(sucursalId)}`)
      .then((usuarios) => setAutorizadores(usuarios.filter((u) => u.rol && ROLES_AUTORIZAN.has(u.rol))))
      .catch(() => setAutorizadores([]));
  }, [sucursalId]);

  async function confirmar() {
    setError(null);
    if (!motivo.trim()) return setError("Indica el motivo de la cancelación");
    if (!usuarioAutorizaId) return setError("Elige quién autoriza la cancelación");
    if (!password.trim()) return setError("Indica la contraseña de autorización");
    setProcesando(true);
    try {
      await apiFetch(`/pedidos/${pedidoId}/cancelar`, { method: "POST", body: JSON.stringify({ motivo, autorizadoPorId: usuarioAutorizaId, password }) });
      onCancelado();
    } catch (e: any) {
      setError(e.message ?? "No se pudo cancelar la cuenta");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <Modal transparent animationType="fade">
      <View style={estilos.overlay}>
        <View style={estilos.modal}>
          <View style={estilos.encabezado}>
            <Text style={estilos.titulo}>Cancelar cuenta</Text>
            <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
          </View>
          <Text style={estilos.ayuda}>{etiqueta}</Text>
          <Text style={estilos.aviso}>Esta acción cancela la cuenta por completo (no se podrá cobrar después) y libera la mesa.</Text>

          <TextInput placeholder="Motivo de la cancelación (obligatorio)" placeholderTextColor={colores.textoSecundario} value={motivo} onChangeText={setMotivo} style={estilos.input} />

          <View style={estilos.cajaAutorizacion}>
            <Text style={estilos.subtitulo}>Autorización de supervisor</Text>
            {autorizadores === null && <Text style={estilos.ayuda}>Cargando…</Text>}
            {autorizadores?.length === 0 && <Text style={estilos.error}>No hay usuarios con rol de supervisor o admin dados de alta.</Text>}
            {autorizadores && autorizadores.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {autorizadores.map((u) => {
                  const activo = usuarioAutorizaId === u.id;
                  return (
                    <TouchableOpacity key={u.id} onPress={() => setUsuarioAutorizaId(u.id)} style={[estilos.chip, activo && estilos.chipActivo]}>
                      <Text style={{ color: activo ? "#fff" : colores.texto, fontSize: 13 }}>{u.nombre}{u.rol ? ` · ${ETIQUETA_ROL[u.rol] ?? u.rol}` : ""}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <TextInput placeholder="Contraseña" placeholderTextColor={colores.textoSecundario} value={password} onChangeText={setPassword} secureTextEntry style={[estilos.input, { marginTop: 8 }]} />
          </View>

          {error && <Text style={estilos.error}>{error}</Text>}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <TouchableOpacity onPress={onCerrar} style={[estilos.boton, { backgroundColor: colores.gray200 }]}>
              <Text style={{ color: colores.texto }}>Volver</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmar} disabled={procesando} style={[estilos.boton, { flex: 2, backgroundColor: colores.red }]}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>{procesando ? "Cancelando…" : "Cancelar cuenta"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
    modal: { backgroundColor: colores.superficie, borderRadius: 16, padding: 20, width: "100%", maxWidth: 400 },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 18, fontWeight: "800", color: colores.texto },
    cerrar: { fontSize: 20, color: colores.textoSecundario },
    subtitulo: { fontSize: 13, fontWeight: "700", color: colores.texto },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 4 },
    aviso: { fontSize: 12, color: colores.red, marginTop: 4 },
    error: { color: colores.red, marginTop: 6, fontSize: 13 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginTop: 10, color: colores.texto },
    cajaAutorizacion: { marginTop: 14, padding: 10, backgroundColor: colores.gray50, borderRadius: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.superficie, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    boton: { flex: 1, padding: 14, borderRadius: 10, alignItems: "center", minHeight: 48, justifyContent: "center" },
  });
}
