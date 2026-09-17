import { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { TipoDescuento } from "@hangar421/shared";
import { apiFetch } from "../../api/http";
import { usePosOrderStore } from "../../store/posOrderStore";
import { usarColores } from "../../store/temaStore";

interface UsuarioLogin { id: string; nombre: string; rol: string | null }

// Deben coincidir con ROLES_AUTORIZAN_SUPERVISOR en apps/backend/src/pedidos/pedidos.service.ts
// (la contraseña se valida ahí, server-side) — mismo criterio que
// apps/pos-desktop/src/components/ModalDescuento.tsx.
const ROLES_AUTORIZAN = new Set(["SUPERVISOR", "ADMIN_SUCURSAL", "ADMIN_CORPORATIVO"]);
const ETIQUETA_ROL: Record<string, string> = {
  ADMIN_CORPORATIVO: "Admin. corporativo", ADMIN_SUCURSAL: "Admin. sucursal", SUPERVISOR: "Supervisor",
};

/** Descuento con autorización — requiere la CONTRASEÑA de un Supervisor/Admin (no el PIN). Se
 *  valida server-side recién cuando el descuento se manda de verdad (posOrderStore.enviarACocina),
 *  no aquí — este modal solo lo captura. Mismo patrón que ModalDescuento.tsx del POS Windows. */
export function PosModalDescuento({ sucursalId, onCerrar }: { sucursalId: string; onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [tipo, setTipo] = useState<TipoDescuento>(TipoDescuento.PORCENTAJE);
  const [valor, setValor] = useState("0");
  const [motivo, setMotivo] = useState("");
  const [autorizadores, setAutorizadores] = useState<UsuarioLogin[] | null>(null);
  const [usuarioAutorizaId, setUsuarioAutorizaId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<UsuarioLogin[]>(`/auth/usuarios-login?sucursalId=${encodeURIComponent(sucursalId)}`)
      .then((usuarios) => setAutorizadores(usuarios.filter((u) => u.rol && ROLES_AUTORIZAN.has(u.rol))))
      .catch(() => setAutorizadores([]));
  }, [sucursalId]);

  function confirmar() {
    setError(null);
    if (!(Number(valor) > 0)) return setError("Indica el valor del descuento (mayor a cero)");
    if (!motivo.trim()) return setError("Indica el motivo del descuento");
    if (!usuarioAutorizaId) return setError("Elige quién autoriza el descuento");
    if (!password.trim()) return setError("Indica la contraseña de autorización");
    usePosOrderStore.getState().aplicarDescuento({ tipo, valor: Number(valor), motivo, autorizadoPorId: usuarioAutorizaId, password });
    onCerrar();
  }

  return (
    <Modal transparent animationType="fade">
      <View style={estilos.overlay}>
        <View style={estilos.modal}>
          <View style={estilos.encabezado}>
            <Text style={estilos.titulo}>Aplicar descuento</Text>
            <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <TouchableOpacity onPress={() => setTipo(TipoDescuento.PORCENTAJE)} style={[estilos.botonTipo, tipo === TipoDescuento.PORCENTAJE && estilos.botonTipoActivo]}>
              <Text style={{ color: tipo === TipoDescuento.PORCENTAJE ? "#fff" : colores.texto }}>%</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setTipo(TipoDescuento.MONTO)} style={[estilos.botonTipo, tipo === TipoDescuento.MONTO && estilos.botonTipoActivo]}>
              <Text style={{ color: tipo === TipoDescuento.MONTO ? "#fff" : colores.texto }}>$</Text>
            </TouchableOpacity>
            <TextInput value={valor} onChangeText={setValor} keyboardType="decimal-pad" style={[estilos.input, { flex: 2 }]} />
          </View>

          <TextInput placeholder="Motivo (obligatorio)" placeholderTextColor={colores.textoSecundario} value={motivo} onChangeText={setMotivo} style={estilos.input} />

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
              <Text style={{ color: colores.texto }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmar} style={[estilos.boton, { flex: 2, backgroundColor: colores.amber }]}>
              <Text style={{ color: "#000", fontWeight: "700" }}>Aplicar descuento</Text>
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
    ayuda: { fontSize: 13, color: colores.textoSecundario },
    error: { color: colores.red, marginTop: 6, fontSize: 13 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginTop: 10, color: colores.texto },
    botonTipo: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde, padding: 10 },
    botonTipoActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    cajaAutorizacion: { marginTop: 14, padding: 10, backgroundColor: colores.gray50, borderRadius: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.superficie, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    boton: { flex: 1, padding: 14, borderRadius: 10, alignItems: "center", minHeight: 48, justifyContent: "center" },
  });
}
