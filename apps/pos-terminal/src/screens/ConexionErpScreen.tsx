import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { RolUsuario, TipoDispositivo, type JwtPayload, type LoginResponse } from "@hangar421/shared";
import { erpFetch, guardarTokensErp, obtenerErpBaseUrl } from "../api/erpHttp";
import { decodificarJwt } from "../auth/jwt";
import { abrirBaseDeDatos } from "../db/database";
import { guardarSucursalErp, obtenerOCrearDispositivoId } from "../db/dispositivoLocal";
import { guardarEmpresaErp, refrescarCatalogo, ejecutarPull } from "../sync/pullEngine";
import { obtenerDatosFiscales } from "../db/configFiscalRepo";
import { usarColores } from "../store/temaStore";

interface SesionErp {
  empresaId: string;
  rol: RolUsuario | undefined;
  sucursalIdResuelta: string | null;
}

/** Conexión opcional con el ERP — NUNCA se pide en el flujo de venta, solo aquí. Login real
 *  (email/contraseña, POST /auth/login, endpoint ya existente). Dos caminos después de entrar:
 *  (1) conectar a una sucursal EXISTENTE de la cuenta (la que resolvió el JWT, o una escrita a
 *  mano si la cuenta tiene varias), o (2) crear una sucursal NUEVA e independiente
 *  (POST /sucursales, requiere rol ADMIN_CORPORATIVO) — esto es lo que hace que el Punto de
 *  Venta se registre como su propia sucursal en el ERP, tal como pide el objetivo original. */
export function ConexionErpScreen({ onConectado, onCerrar }: { onConectado: () => void; onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sucursalIdManual, setSucursalIdManual] = useState("");
  const [conectando, setConectando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sesion, setSesion] = useState<SesionErp | null>(null);
  const [nombreSucursalNueva, setNombreSucursalNueva] = useState("");
  const [tasaImpuestoNueva, setTasaImpuestoNueva] = useState("0.16");
  const [servidorErp, setServidorErp] = useState("");

  useEffect(() => {
    obtenerErpBaseUrl().then(setServidorErp);
  }, []);

  async function finalizarConexion(sucursalId: string, empresaId: string) {
    const db = await abrirBaseDeDatos();
    await guardarSucursalErp(db, sucursalId);
    await guardarEmpresaErp(empresaId);
    await refrescarCatalogo().catch(() => undefined); // best-effort, no bloquea la conexión
    await ejecutarPull().catch(() => undefined);
    onConectado();
  }

  async function entrar() {
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

      if (payload.sucursalId) {
        // Ya hay una sucursal resuelta (única en la cuenta, o la que se escribió a mano) — se
        // conecta directo a esa, sin pedir un paso extra.
        await finalizarConexion(payload.sucursalId, resp.usuario.empresaId);
        return;
      }

      // Cuenta con varias sucursales y no se escribió ninguna a mano — se queda en esta pantalla
      // para elegir: escribir el ID de una existente, o (si es ADMIN_CORPORATIVO) crear una nueva.
      setSesion({ empresaId: resp.usuario.empresaId, rol: payload.rol, sucursalIdResuelta: null });
    } catch (e: any) {
      setError(e.message ?? "No se pudo conectar con el ERP");
    } finally {
      setConectando(false);
    }
  }

  async function crearSucursalNueva() {
    if (!sesion || !nombreSucursalNueva.trim()) return;
    setError(null);
    setConectando(true);
    try {
      const nueva = await erpFetch<{ id: string }>("/sucursales", {
        method: "POST",
        body: JSON.stringify({ empresaId: sesion.empresaId, nombre: nombreSucursalNueva.trim(), tasaImpuesto: Number(tasaImpuestoNueva) || 0.16 }),
      });
      const db = await abrirBaseDeDatos();
      const dispositivoId = await obtenerOCrearDispositivoId(db);
      const datosFiscales = await obtenerDatosFiscales(db);
      await erpFetch(`/sucursales/${nueva.id}/dispositivos`, {
        method: "POST",
        body: JSON.stringify({ nombre: datosFiscales.nombreSucursalLocal || "Punto de Venta", tipo: TipoDispositivo.POS_TERMINAL, identificador: dispositivoId }),
      }).catch(() => undefined); // el registro es informativo — no bloquea la conexión si falla

      await finalizarConexion(nueva.id, sesion.empresaId);
    } catch (e: any) {
      setError(e.message ?? "No se pudo crear la sucursal");
    } finally {
      setConectando(false);
    }
  }

  async function conectarAExistenteManual() {
    if (!sesion || !sucursalIdManual.trim()) return;
    await finalizarConexion(sucursalIdManual.trim(), sesion.empresaId);
  }

  if (sesion) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 20 }}>
        <View style={estilos.encabezado}>
          <Text style={estilos.titulo}>Elegir sucursal</Text>
          <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
        </View>
        <Text style={estilos.ayuda}>Esta cuenta tiene acceso a más de una sucursal — elige a cuál conectar este dispositivo.</Text>

        <Text style={estilos.subtitulo}>Conectar a una sucursal existente</Text>
        <TextInput placeholder="ID de la sucursal" placeholderTextColor={colores.textoSecundario} value={sucursalIdManual} onChangeText={setSucursalIdManual} autoCapitalize="none" style={estilos.input} />
        <TouchableOpacity onPress={conectarAExistenteManual} disabled={conectando || !sucursalIdManual.trim()} style={estilos.botonSecundario}>
          <Text style={estilos.botonSecundarioTexto}>Enlazar</Text>
        </TouchableOpacity>

        {sesion.rol === RolUsuario.ADMIN_CORPORATIVO && (
          <>
            <Text style={estilos.subtitulo}>O crear una sucursal nueva e independiente</Text>
            <TextInput placeholder="Nombre de la sucursal" placeholderTextColor={colores.textoSecundario} value={nombreSucursalNueva} onChangeText={setNombreSucursalNueva} style={estilos.input} />
            <TextInput placeholder="Tasa de impuesto (ej. 0.16)" placeholderTextColor={colores.textoSecundario} value={tasaImpuestoNueva} onChangeText={setTasaImpuestoNueva} keyboardType="decimal-pad" style={estilos.input} />
            <TouchableOpacity onPress={crearSucursalNueva} disabled={conectando || !nombreSucursalNueva.trim()} style={estilos.boton}>
              <Text style={estilos.botonTexto}>{conectando ? "Creando…" : "Crear y enlazar"}</Text>
            </TouchableOpacity>
          </>
        )}

        {error && <Text style={estilos.error}>{error}</Text>}
      </ScrollView>
    );
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
      <View style={estilos.servidorBox}>
        <Text style={estilos.servidorEtiqueta}>Servidor (ya configurado)</Text>
        <Text style={estilos.servidorTexto} numberOfLines={1}>{servidorErp}</Text>
      </View>

      <TextInput placeholder="Correo" placeholderTextColor={colores.textoSecundario} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={estilos.input} />
      <TextInput placeholder="Contraseña" placeholderTextColor={colores.textoSecundario} value={password} onChangeText={setPassword} secureTextEntry style={estilos.input} />
      <TextInput placeholder="ID de sucursal (solo si ya sabes a cuál conectar)" placeholderTextColor={colores.textoSecundario} value={sucursalIdManual} onChangeText={setSucursalIdManual} autoCapitalize="none" style={estilos.input} />

      {error && <Text style={estilos.error}>{error}</Text>}

      <TouchableOpacity onPress={entrar} disabled={conectando || !email.trim() || !password} style={estilos.boton}>
        <Text style={estilos.botonTexto}>{conectando ? "Enlazando…" : "Enlazar"}</Text>
      </TouchableOpacity>
      <Text style={estilos.notaPersistencia}>Solo se pide una vez por dispositivo — después queda enlazado hasta que cierres la conexión.</Text>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 20, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 8, marginBottom: 16, lineHeight: 18 },
    servidorBox: { backgroundColor: colores.gray50, borderRadius: 10, padding: 12, marginBottom: 16 },
    servidorEtiqueta: { fontSize: 11, color: colores.textoSecundario, fontWeight: "700", textTransform: "uppercase" },
    servidorTexto: { fontSize: 13, color: colores.texto, marginTop: 2 },
    notaPersistencia: { fontSize: 12, color: colores.textoSecundario, textAlign: "center", marginTop: 10 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginTop: 18, marginBottom: 8 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 14, marginBottom: 10, fontSize: 15, color: colores.texto },
    error: { color: colores.red, marginTop: 4, marginBottom: 4 },
    boton: { backgroundColor: colores.green, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 10, minHeight: 52, justifyContent: "center" },
    botonTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
    botonSecundario: { backgroundColor: colores.navy, borderRadius: 12, padding: 14, alignItems: "center", minHeight: 48, justifyContent: "center" },
    botonSecundarioTexto: { color: "#fff", fontWeight: "700" },
  });
}
