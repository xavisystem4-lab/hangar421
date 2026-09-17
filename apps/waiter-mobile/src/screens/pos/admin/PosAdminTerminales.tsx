import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AmbienteProveedorPago, Sucursal } from "@hangar421/shared";
import { apiFetch } from "../../../api/http";
import { useAuthStore } from "../../../store/authStore";
import { usarColores } from "../../../store/temaStore";

interface ConfigProveedor {
  id: string; empresaId: string; sucursalId: string | null; proveedor: string;
  ambiente: AmbienteProveedorPago; identificadorComercio: string | null; activo: boolean;
}
interface TerminalRow {
  id: string; sucursalId: string; nombre: string; zona: string | null; identificadorExterno: string;
  activo: boolean; estadoConexion: "CONECTADA" | "DESCONECTADA" | "OCUPADA" | "ERROR";
  meseroAsignado: { id: string; nombre: string } | null;
  proveedorConfig: { id: string; proveedor: string; ambiente: string };
}
interface UsuarioSucursalRow { usuarioId: string; rol: string; usuario: { id: string; nombre: string } }

const PROVEEDORES = [
  { valor: "mercadopago", etiqueta: "Mercado Pago (Point Smart)" },
  { valor: "mock", etiqueta: "Prueba / demo (sin terminal real)" },
];
const ETIQUETA_ESTADO: Record<string, string> = { CONECTADA: "Conectada", DESCONECTADA: "Desconectada", OCUPADA: "Ocupada", ERROR: "Error" };

/** Administración > Terminales de pago — mismo módulo que AdminTerminales.tsx del POS Windows:
 *  configuración de proveedores (credenciales cifradas en el backend, nunca visibles aquí
 *  después de guardarlas) y alta/edición de terminales físicas vinculadas a cada una. */
export function PosAdminTerminales() {
  const { usuario } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [meseros, setMeseros] = useState<UsuarioSucursalRow[]>([]);
  const [configs, setConfigs] = useState<ConfigProveedor[]>([]);
  const [terminales, setTerminales] = useState<TerminalRow[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [probando, setProbando] = useState<string | null>(null);

  const [nuevoConfig, setNuevoConfig] = useState({ proveedor: "mercadopago", ambiente: "PRUEBAS" as AmbienteProveedorPago, identificadorComercio: "", accessToken: "", webhookSecret: "" });
  const [guardandoConfig, setGuardandoConfig] = useState(false);
  const [nuevaTerminal, setNuevaTerminal] = useState({ proveedorConfigId: "", nombre: "", zona: "", meseroAsignadoId: "", identificadorExterno: "" });
  const [creandoTerminal, setCreandoTerminal] = useState(false);

  async function cargarConfigs() {
    if (!usuario) return;
    setConfigs(await apiFetch<ConfigProveedor[]>(`/pagos/proveedores?empresaId=${usuario.empresaId}`));
  }
  async function cargarTerminales(suc: string) {
    if (!suc) return;
    setTerminales(await apiFetch<TerminalRow[]>(`/pagos/terminales?sucursalId=${suc}`));
  }
  async function cargarMeseros(suc: string) {
    if (!suc) return;
    const filas = await apiFetch<UsuarioSucursalRow[]>(`/usuarios?sucursalId=${suc}`);
    setMeseros(filas.filter((f) => f.rol === "MESERO"));
  }

  useEffect(() => {
    if (!usuario) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargarTerminales(s[0].id); cargarMeseros(s[0].id); }
    });
    cargarConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  async function guardarConfig() {
    if (!usuario) return;
    setGuardandoConfig(true);
    setMensaje(null);
    try {
      const credenciales = nuevoConfig.proveedor === "mercadopago" ? { accessToken: nuevoConfig.accessToken, webhookSecret: nuevoConfig.webhookSecret } : {};
      await apiFetch("/pagos/proveedores", {
        method: "POST",
        body: JSON.stringify({ empresaId: usuario.empresaId, sucursalId: sucursalId || undefined, proveedor: nuevoConfig.proveedor, ambiente: nuevoConfig.ambiente, identificadorComercio: nuevoConfig.identificadorComercio || undefined, credenciales }),
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
        body: JSON.stringify({ sucursalId, proveedorConfigId: nuevaTerminal.proveedorConfigId, nombre: nuevaTerminal.nombre, zona: nuevaTerminal.zona || undefined, meseroAsignadoId: nuevaTerminal.meseroAsignadoId || undefined, identificadorExterno: nuevaTerminal.identificadorExterno }),
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

  function confirmarEliminarTerminal(t: TerminalRow) {
    Alert.alert("Eliminar terminal", `¿Eliminar la terminal "${t.nombre}"?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: () => eliminarTerminal(t) },
    ]);
  }
  async function eliminarTerminal(t: TerminalRow) {
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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.filaEncabezado}>
        <Text style={estilos.titulo}>Terminales de pago</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {sucursales.map((s) => (
          <TouchableOpacity key={s.id} onPress={() => { setSucursalId(s.id); cargarTerminales(s.id); cargarMeseros(s.id); }} style={[estilos.chip, sucursalId === s.id && estilos.chipActivo]}>
            <Text style={{ color: sucursalId === s.id ? "#fff" : colores.texto, fontSize: 13 }}>{s.nombre}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mensaje && <Text style={estilos.mensaje}>{mensaje}</Text>}

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Proveedores configurados</Text>
        {configs.length === 0 && <Text style={estilos.ayuda}>Aún no hay proveedores configurados.</Text>}
        {configs.map((c) => (
          <View key={c.id} style={estilos.filaConfig}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colores.texto, fontWeight: "700" }}>{PROVEEDORES.find((p) => p.valor === c.proveedor)?.etiqueta ?? c.proveedor}</Text>
              <Text style={estilos.ayuda}>{c.ambiente === "PRODUCCION" ? "Producción" : "Pruebas"}{c.sucursalId ? "" : " · toda la empresa"}</Text>
            </View>
            <TouchableOpacity onPress={() => probarConexionConfig(c.id)} disabled={probando === c.id} style={estilos.botonChico}>
              <Text style={{ color: "#fff", fontSize: 12 }}>{probando === c.id ? "Probando…" : "Probar conexión"}</Text>
            </TouchableOpacity>
          </View>
        ))}

        <Text style={[estilos.subtitulo, { marginTop: 16 }]}>Nueva configuración</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          {PROVEEDORES.map((p) => (
            <TouchableOpacity key={p.valor} onPress={() => setNuevoConfig((n) => ({ ...n, proveedor: p.valor }))} style={[estilos.chip, nuevoConfig.proveedor === p.valor && estilos.chipActivo]}>
              <Text style={{ color: nuevoConfig.proveedor === p.valor ? "#fff" : colores.texto, fontSize: 12 }}>{p.etiqueta}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          <TouchableOpacity onPress={() => setNuevoConfig((n) => ({ ...n, ambiente: "PRUEBAS" as AmbienteProveedorPago }))} style={[estilos.chip, nuevoConfig.ambiente === "PRUEBAS" && estilos.chipActivo]}>
            <Text style={{ color: nuevoConfig.ambiente === "PRUEBAS" ? "#fff" : colores.texto, fontSize: 12 }}>Pruebas</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setNuevoConfig((n) => ({ ...n, ambiente: "PRODUCCION" as AmbienteProveedorPago }))} style={[estilos.chip, nuevoConfig.ambiente === "PRODUCCION" && estilos.chipActivo]}>
            <Text style={{ color: nuevoConfig.ambiente === "PRODUCCION" ? "#fff" : colores.texto, fontSize: 12 }}>Producción</Text>
          </TouchableOpacity>
        </View>
        <TextInput placeholder="Identificador de comercio (opcional)" placeholderTextColor={colores.textoSecundario} value={nuevoConfig.identificadorComercio} onChangeText={(v) => setNuevoConfig((n) => ({ ...n, identificadorComercio: v }))} style={estilos.input} />
        {nuevoConfig.proveedor === "mercadopago" && (
          <>
            <TextInput placeholder="Access Token de Mercado Pago" placeholderTextColor={colores.textoSecundario} value={nuevoConfig.accessToken} onChangeText={(v) => setNuevoConfig((n) => ({ ...n, accessToken: v }))} secureTextEntry style={estilos.input} />
            <TextInput placeholder="Webhook Secret" placeholderTextColor={colores.textoSecundario} value={nuevoConfig.webhookSecret} onChangeText={(v) => setNuevoConfig((n) => ({ ...n, webhookSecret: v }))} secureTextEntry style={estilos.input} />
          </>
        )}
        <Text style={estilos.ayuda}>Se aplica a: {sucursales.find((s) => s.id === sucursalId)?.nombre}. Las credenciales se cifran en el servidor y no se vuelven a mostrar aquí.</Text>
        <TouchableOpacity onPress={guardarConfig} disabled={guardandoConfig} style={estilos.botonPrincipal}>
          <Text style={estilos.botonPrincipalTexto}>{guardandoConfig ? "Guardando…" : "Guardar configuración"}</Text>
        </TouchableOpacity>
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Terminales</Text>
        {terminales.map((t) => (
          <View key={t.id} style={[estilos.filaConfig, { opacity: t.activo ? 1 : 0.5 }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colores.texto, fontWeight: "700" }}>{t.nombre}{t.zona ? ` · ${t.zona}` : ""}</Text>
              <Text style={estilos.ayuda}>{t.meseroAsignado?.nombre ?? "Sin mesero asignado"} · {ETIQUETA_ESTADO[t.estadoConexion]}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <TouchableOpacity onPress={() => probarConexionTerminal(t)} disabled={probando === t.id} style={estilos.botonChico}><Text style={{ color: "#fff", fontSize: 11 }}>{probando === t.id ? "…" : "Probar"}</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => toggleActivoTerminal(t)} style={[estilos.botonChico, { backgroundColor: t.activo ? colores.red : colores.green }]}><Text style={{ color: "#fff", fontSize: 11 }}>{t.activo ? "Desactivar" : "Activar"}</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => confirmarEliminarTerminal(t)} style={[estilos.botonChico, { backgroundColor: colores.red + "22" }]}><Text style={{ color: colores.red, fontSize: 11 }}>Eliminar</Text></TouchableOpacity>
            </View>
          </View>
        ))}
        {terminales.length === 0 && <Text style={estilos.ayuda}>Sin terminales en esta sucursal.</Text>}

        <Text style={[estilos.subtitulo, { marginTop: 16 }]}>Nueva terminal</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {configs.map((c) => (
            <TouchableOpacity key={c.id} onPress={() => setNuevaTerminal((n) => ({ ...n, proveedorConfigId: c.id }))} style={[estilos.chip, nuevaTerminal.proveedorConfigId === c.id && estilos.chipActivo]}>
              <Text style={{ color: nuevaTerminal.proveedorConfigId === c.id ? "#fff" : colores.texto, fontSize: 12 }}>{PROVEEDORES.find((p) => p.valor === c.proveedor)?.etiqueta ?? c.proveedor}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput placeholder="Nombre (ej. Terminal Mostrador)" placeholderTextColor={colores.textoSecundario} value={nuevaTerminal.nombre} onChangeText={(v) => setNuevaTerminal((n) => ({ ...n, nombre: v }))} style={estilos.input} />
        <TextInput placeholder="Zona / caja (opcional)" placeholderTextColor={colores.textoSecundario} value={nuevaTerminal.zona} onChangeText={(v) => setNuevaTerminal((n) => ({ ...n, zona: v }))} style={estilos.input} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {meseros.map((m) => (
            <TouchableOpacity key={m.usuarioId} onPress={() => setNuevaTerminal((n) => ({ ...n, meseroAsignadoId: m.usuarioId }))} style={[estilos.chip, nuevaTerminal.meseroAsignadoId === m.usuarioId && estilos.chipActivo]}>
              <Text style={{ color: nuevaTerminal.meseroAsignadoId === m.usuarioId ? "#fff" : colores.texto, fontSize: 12 }}>{m.usuario.nombre}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput placeholder="Identificador de la terminal (terminal_id del proveedor)" placeholderTextColor={colores.textoSecundario} value={nuevaTerminal.identificadorExterno} onChangeText={(v) => setNuevaTerminal((n) => ({ ...n, identificadorExterno: v }))} style={estilos.input} />
        <TouchableOpacity onPress={crearTerminal} disabled={creandoTerminal} style={estilos.botonPrincipal}>
          <Text style={estilos.botonPrincipalTexto}>{creandoTerminal ? "Creando…" : "Crear terminal"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto, marginBottom: 10 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginTop: 2 },
    mensaje: { color: colores.navyTexto, marginBottom: 10 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 14 },
    filaConfig: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde, gap: 8 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonChico: { backgroundColor: colores.navy, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
  });
}
