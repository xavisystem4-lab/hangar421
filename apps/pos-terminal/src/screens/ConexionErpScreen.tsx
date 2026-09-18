import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { JwtPayload, LoginResponse } from "@hangar421/shared";
import { erpFetch, guardarTokensErp } from "../api/erpHttp";
import { decodificarJwt } from "../auth/jwt";
import { abrirBaseDeDatos } from "../db/database";
import { guardarSucursalErp, obtenerOCrearDispositivoId } from "../db/dispositivoLocal";
import { guardarEmpresaErp, refrescarCatalogo, ejecutarPull } from "../sync/pullEngine";
import { usarColores } from "../store/temaStore";

/** Conexión opcional con el ERP — NUNCA se pide en el flujo de venta, solo aquí. Login real
 *  (email/contraseña, POST /auth/login, endpoint ya existente) contra una cuenta que YA tiene
 *  al menos una sucursal en el ERP; el JWT resultante trae el `sucursalId` resuelto en su
 *  payload (ver JwtPayload en packages/shared). Vincular este dispositivo a una sucursal NUEVA
 *  e independiente (POST /sucursales) es la parte de "configuración inicial" que todavía falta
 *  (Fase 2b) — por ahora esta pantalla conecta contra una sucursal EXISTENTE de la cuenta. */
export function ConexionErpScreen({ onConectado, onCerrar }: { onConectado: () => void; onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sucursalIdManual, setSucursalIdManual] = useState("");
  const [conectando, setConectando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function conectar() {
    if (!email.trim() || !password) return;
    setError(null);
    setConectando(true);
    try {
      const db = await abrirBaseDeDatos();
      const dispositivoId = await obtenerOCrearDispositivoId(db);
      const resp = await erpFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password, dispositivoId, sucursalId: sucursalIdManual.trim() || undefined }),
      });
      await guardarTokensErp(resp.accessToken, resp.refreshToken);

      const payload = decodificarJwt<JwtPayload>(resp.accessToken);
      if (!payload.sucursalId) {
        throw new Error("Esta cuenta tiene más de una sucursal — escribe el ID de la sucursal a la que quieres conectar este dispositivo.");
      }
      await guardarSucursalErp(db, payload.sucursalId);
      await guardarEmpresaErp(resp.usuario.empresaId);

      await refrescarCatalogo().catch(() => undefined); // best-effort, no bloquea la conexión
      await ejecutarPull().catch(() => undefined);

      onConectado();
    } catch (e: any) {
      setError(e.message ?? "No se pudo conectar con el ERP");
    } finally {
      setConectando(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 20 }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Conectar con el ERP</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>
      <Text style={estilos.ayuda}>
        Opcional — el Punto de Venta funciona completo sin esto. Conectarlo permite traer el catálogo real y
        mandar las ventas/turnos ya guardados al ERP en cuanto haya conexión.
      </Text>

      <TextInput placeholder="Correo" placeholderTextColor={colores.textoSecundario} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={estilos.input} />
      <TextInput placeholder="Contraseña" placeholderTextColor={colores.textoSecundario} value={password} onChangeText={setPassword} secureTextEntry style={estilos.input} />
      <TextInput placeholder="ID de sucursal (solo si tu cuenta tiene más de una)" placeholderTextColor={colores.textoSecundario} value={sucursalIdManual} onChangeText={setSucursalIdManual} autoCapitalize="none" style={estilos.input} />

      {error && <Text style={estilos.error}>{error}</Text>}

      <TouchableOpacity onPress={conectar} disabled={conectando || !email.trim() || !password} style={estilos.boton}>
        <Text style={estilos.botonTexto}>{conectando ? "Conectando…" : "Conectar"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 20, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 8, marginBottom: 16, lineHeight: 18 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 14, marginBottom: 10, fontSize: 15, color: colores.texto },
    error: { color: colores.red, marginTop: 4, marginBottom: 4 },
    boton: { backgroundColor: colores.green, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 10, minHeight: 52, justifyContent: "center" },
    botonTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
  });
}
