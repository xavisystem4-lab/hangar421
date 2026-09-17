import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { apiFetch } from "../../../api/http";
import { useAuthStore } from "../../../store/authStore";
import { usarColores } from "../../../store/temaStore";

type CodigoPlataforma = "didi" | "uber" | "rappi";
type Ambiente = "SANDBOX" | "PRODUCCION";
type EstadoConexion = "CONECTADA" | "DESCONECTADA" | "PENDIENTE_CONFIGURACION" | "ERROR";

interface PlataformaConfig {
  id: string | null; plataforma: string; nombreVisible: string; ambiente: Ambiente; activo: boolean;
  estadoConexion: EstadoConexion; identificadorTienda: string | null; credencialesUltimos4: string | null;
  clientSecretConfigurado: boolean; webhookUrl: string | null; ultimaSincronizacion: string | null;
  ultimoErrorMensaje: string | null; pedidosRecibidos: number; pedidosSincronizados: number;
}
interface ItemExterno { nombreExterno: string; cantidad: number }
interface PedidoEntrante {
  id: string; plataforma: string; nombreVisible: string; ordenExternaId: string; estado: string;
  clienteNombre: string | null; totalExterno: number | null; items: ItemExterno[];
}
interface ProductoCatalogo { id: string; nombre: string }
interface MapeoItem { productoId: string; cantidad: number }

const ORDEN_PLATAFORMAS: CodigoPlataforma[] = ["didi", "uber", "rappi"];
const INFO_PLATAFORMA: Record<CodigoPlataforma, { icono: string; campoPrincipal: "apiKey" | "clientId"; etiquetaCampoPrincipal: string }> = {
  didi: { icono: "🛵", campoPrincipal: "apiKey", etiquetaCampoPrincipal: "API Key / Client ID" },
  uber: { icono: "🚗", campoPrincipal: "clientId", etiquetaCampoPrincipal: "Client ID" },
  rappi: { icono: "🐰", campoPrincipal: "clientId", etiquetaCampoPrincipal: "Client ID" },
};
const ETIQUETA_ESTADO: Record<EstadoConexion, string> = {
  CONECTADA: "Conectada", DESCONECTADA: "Desconectada", PENDIENTE_CONFIGURACION: "Pendiente de configuración", ERROR: "Error",
};

function formatearFecha(iso: string | null): string {
  if (!iso) return "Sin sincronizar aún";
  return new Date(iso).toLocaleString("es-MX");
}

interface FormularioConfig { ambiente: Ambiente; identificadorTienda: string; activo: boolean; campoPrincipal: string; clientSecret: string }
function formularioVacio(): FormularioConfig {
  return { ambiente: "SANDBOX", identificadorTienda: "", activo: true, campoPrincipal: "", clientSecret: "" };
}

/** Administración > Plataformas — mismos endpoints /plataformas/* que ya usan el CRM web y
 *  AdminPlataformas.tsx (POS Windows): configuración de DiDi/Uber/Rappi y bandeja de pedidos
 *  entrantes con mapeo manual de items al catálogo real. */
export function PosAdminPlataformas() {
  const { usuario, sucursalId } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [plataformas, setPlataformas] = useState<PlataformaConfig[]>([]);
  const [seleccionada, setSeleccionada] = useState<CodigoPlataforma>("didi");
  const [formulario, setFormulario] = useState<FormularioConfig>(formularioVacio());
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState<string | null>(null);

  const [pedidosEntrantes, setPedidosEntrantes] = useState<PedidoEntrante[]>([]);
  const [pedidoRevisando, setPedidoRevisando] = useState<PedidoEntrante | null>(null);
  const [productosSucursal, setProductosSucursal] = useState<ProductoCatalogo[]>([]);
  const [mapeoItems, setMapeoItems] = useState<MapeoItem[]>([]);
  const [procesandoPedido, setProcesandoPedido] = useState(false);

  async function cargar() {
    if (!usuario) return;
    try {
      setPlataformas(await apiFetch<PlataformaConfig[]>(`/plataformas/configuraciones?empresaId=${usuario.empresaId}`));
    } catch (e: any) {
      setMensaje(e.message ?? "No se pudieron cargar las plataformas");
    }
  }
  async function cargarPedidosEntrantes() {
    if (!usuario) return;
    try {
      setPedidosEntrantes(await apiFetch<PedidoEntrante[]>(`/plataformas/pedidos?empresaId=${usuario.empresaId}`));
    } catch { /* se reintenta en el próximo refresh */ }
  }

  useEffect(() => {
    cargar();
    cargarPedidosEntrantes();
    if (usuario && sucursalId) {
      apiFetch<ProductoCatalogo[]>(`/catalogo/productos?empresaId=${usuario.empresaId}&sucursalId=${sucursalId}`).then(setProductosSucursal).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  function config(codigo: CodigoPlataforma) { return plataformas.find((p) => p.plataforma === codigo); }

  function seleccionar(codigo: CodigoPlataforma) {
    setSeleccionada(codigo);
    setMensaje(null);
    const actual = config(codigo);
    setFormulario({ ambiente: actual?.ambiente ?? "SANDBOX", identificadorTienda: actual?.identificadorTienda ?? "", activo: actual?.activo ?? true, campoPrincipal: "", clientSecret: "" });
  }
  useEffect(() => { seleccionar(seleccionada); }, [plataformas]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar() {
    const info = INFO_PLATAFORMA[seleccionada];
    if (!formulario.identificadorTienda.trim() || !formulario.campoPrincipal.trim() || !formulario.clientSecret.trim()) {
      setMensaje("Completa id de tienda, " + info.etiquetaCampoPrincipal + " y Client Secret.");
      return;
    }
    setGuardando(true);
    setMensaje(null);
    try {
      await apiFetch(`/plataformas/configuraciones/${seleccionada}`, {
        method: "POST",
        body: JSON.stringify({ ambiente: formulario.ambiente, identificadorTienda: formulario.identificadorTienda.trim(), activo: formulario.activo, credenciales: { [info.campoPrincipal]: formulario.campoPrincipal.trim(), clientSecret: formulario.clientSecret.trim() } }),
      });
      setMensaje("Configuración guardada — las credenciales quedaron cifradas en el servidor.");
      await cargar();
    } catch (e: any) {
      setMensaje(e.message ?? "No se pudo guardar la configuración");
    } finally {
      setGuardando(false);
    }
  }

  async function probarConexion(id: string) {
    setProbando(id);
    try {
      const r = await apiFetch<{ ok: boolean; detalle: string }>(`/plataformas/configuraciones/${id}/probar-conexion`, { method: "POST" });
      setMensaje(r.detalle);
      await cargar();
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setProbando(null);
    }
  }

  async function reconectar(id: string) {
    setProbando(id);
    try {
      const r = await apiFetch<{ ok: boolean; detalle: string }>(`/plataformas/configuraciones/${id}/reconectar`, { method: "POST" });
      setMensaje(r.detalle);
      await cargar();
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setProbando(null);
    }
  }

  function confirmarDesconectar(id: string, nombre: string) {
    Alert.alert("Desconectar", `¿Desconectar "${nombre}"? Dejará de recibir pedidos hasta que la reconectes.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Desconectar", style: "destructive", onPress: () => desconectar(id, nombre) },
    ]);
  }
  async function desconectar(id: string, nombre: string) {
    try {
      await apiFetch(`/plataformas/configuraciones/${id}/desconectar`, { method: "POST" });
      setMensaje(`"${nombre}" desconectada.`);
      await cargar();
    } catch (e: any) {
      setMensaje(e.message);
    }
  }

  function abrirRevision(pedido: PedidoEntrante) {
    setPedidoRevisando(pedido);
    setMapeoItems(pedido.items.map((it) => ({ productoId: "", cantidad: it.cantidad })));
  }

  async function aceptarPedidoEntrante() {
    if (!pedidoRevisando || !sucursalId) return;
    if (mapeoItems.some((it) => !it.productoId)) {
      setMensaje("Elige el producto real para cada item antes de aceptar.");
      return;
    }
    setProcesandoPedido(true);
    try {
      await apiFetch(`/plataformas/pedidos/${pedidoRevisando.id}/aceptar`, { method: "POST", body: JSON.stringify({ sucursalId, items: mapeoItems }) });
      setMensaje("Pedido aceptado — ya se mandó a cocina.");
      setPedidoRevisando(null);
      await cargarPedidosEntrantes();
    } catch (e: any) {
      setMensaje(e.message);
    } finally {
      setProcesandoPedido(false);
    }
  }

  const actual = config(seleccionada);
  const infoActual = INFO_PLATAFORMA[seleccionada];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <Text style={estilos.titulo}>Plataformas</Text>

      {mensaje && <Text style={estilos.mensaje}>{mensaje}</Text>}

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
        {ORDEN_PLATAFORMAS.map((codigo) => {
          const c = config(codigo);
          return (
            <TouchableOpacity key={codigo} onPress={() => seleccionar(codigo)} style={[estilos.tabPlataforma, seleccionada === codigo && estilos.tabPlataformaActiva]}>
              <Text style={{ color: seleccionada === codigo ? "#fff" : colores.texto, fontSize: 13 }}>{INFO_PLATAFORMA[codigo].icono} {c?.nombreVisible ?? codigo}</Text>
              <Text style={{ color: seleccionada === codigo ? "#fff" : colores.textoSecundario, fontSize: 10 }}>{ETIQUETA_ESTADO[c?.estadoConexion ?? "PENDIENTE_CONFIGURACION"]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.ayuda}>Última sync: {formatearFecha(actual?.ultimaSincronizacion ?? null)} · {actual?.pedidosRecibidos ?? 0} recibidos · {actual?.pedidosSincronizados ?? 0} sincronizados</Text>
        {actual?.ultimoErrorMensaje && <Text style={[estilos.ayuda, { color: colores.red }]}>Error: {actual.ultimoErrorMensaje}</Text>}

        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <TouchableOpacity onPress={() => setFormulario((f) => ({ ...f, ambiente: "SANDBOX" }))} style={[estilos.chip, formulario.ambiente === "SANDBOX" && estilos.chipActivo]}>
            <Text style={{ color: formulario.ambiente === "SANDBOX" ? "#fff" : colores.texto, fontSize: 12 }}>Sandbox</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setFormulario((f) => ({ ...f, ambiente: "PRODUCCION" }))} style={[estilos.chip, formulario.ambiente === "PRODUCCION" && estilos.chipActivo]}>
            <Text style={{ color: formulario.ambiente === "PRODUCCION" ? "#fff" : colores.texto, fontSize: 12 }}>Producción</Text>
          </TouchableOpacity>
        </View>

        <TextInput placeholder="Id de tienda/restaurante en la plataforma" placeholderTextColor={colores.textoSecundario} value={formulario.identificadorTienda} onChangeText={(v) => setFormulario((f) => ({ ...f, identificadorTienda: v }))} style={estilos.input} />
        <TextInput placeholder={infoActual.etiquetaCampoPrincipal} placeholderTextColor={colores.textoSecundario} value={formulario.campoPrincipal} onChangeText={(v) => setFormulario((f) => ({ ...f, campoPrincipal: v }))} style={estilos.input} />
        {actual?.credencialesUltimos4 && <Text style={estilos.ayuda}>Guardado: •••• {actual.credencialesUltimos4}</Text>}
        <TextInput placeholder="Client Secret" placeholderTextColor={colores.textoSecundario} value={formulario.clientSecret} onChangeText={(v) => setFormulario((f) => ({ ...f, clientSecret: v }))} secureTextEntry style={estilos.input} />
        {actual?.clientSecretConfigurado && <Text style={estilos.ayuda}>Client Secret configurado ✓</Text>}

        <TouchableOpacity onPress={() => setFormulario((f) => ({ ...f, activo: !f.activo }))} style={[estilos.chip, { alignSelf: "flex-start", marginTop: 8, backgroundColor: formulario.activo ? colores.green : colores.gray200 }]}>
          <Text style={{ color: formulario.activo ? "#fff" : colores.texto, fontSize: 12 }}>{formulario.activo ? "Integración activa" : "Integración desactivada"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={guardar} disabled={guardando} style={estilos.botonPrincipal}>
          <Text style={estilos.botonPrincipalTexto}>{guardando ? "Guardando…" : "Guardar configuración"}</Text>
        </TouchableOpacity>

        {actual?.id && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <TouchableOpacity onPress={() => probarConexion(actual.id!)} disabled={probando === actual.id} style={estilos.botonChico}><Text style={{ color: "#fff", fontSize: 12 }}>{probando === actual.id ? "Probando…" : "Probar conexión"}</Text></TouchableOpacity>
            {actual.estadoConexion !== "CONECTADA" && (
              <TouchableOpacity onPress={() => reconectar(actual.id!)} disabled={probando === actual.id} style={[estilos.botonChico, { backgroundColor: colores.blue }]}><Text style={{ color: "#fff", fontSize: 12 }}>Reconectar</Text></TouchableOpacity>
            )}
            {actual.activo && (
              <TouchableOpacity onPress={() => confirmarDesconectar(actual.id!, actual.nombreVisible)} style={[estilos.botonChico, { backgroundColor: colores.red + "22" }]}><Text style={{ color: colores.red, fontSize: 12 }}>Desconectar</Text></TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Pedidos entrantes</Text>
        {pedidosEntrantes.length === 0 && <Text style={estilos.ayuda}>Sin pedidos pendientes de revisión.</Text>}
        {pedidosEntrantes.map((p) => (
          <View key={p.id} style={estilos.filaPedido}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colores.texto, fontWeight: "700" }}>{INFO_PLATAFORMA[p.plataforma as CodigoPlataforma]?.icono} {p.nombreVisible} · #{p.ordenExternaId}</Text>
              <Text style={estilos.ayuda}>{p.clienteNombre ?? "Cliente sin nombre"} · {p.items.length} producto(s)</Text>
            </View>
            <TouchableOpacity onPress={() => abrirRevision(p)} style={estilos.botonChico}><Text style={{ color: "#fff", fontSize: 12 }}>Revisar</Text></TouchableOpacity>
          </View>
        ))}
      </View>

      {pedidoRevisando && (
        <View style={estilos.tarjeta}>
          <View style={estilos.filaEncabezado}>
            <Text style={estilos.subtitulo}>{pedidoRevisando.nombreVisible} · #{pedidoRevisando.ordenExternaId}</Text>
            <TouchableOpacity onPress={() => setPedidoRevisando(null)}><Text style={{ color: colores.textoSecundario, fontSize: 18 }}>✕</Text></TouchableOpacity>
          </View>
          {pedidoRevisando.items.map((item, i) => (
            <View key={i} style={{ marginBottom: 10 }}>
              <Text style={{ color: colores.texto, fontSize: 13 }}>{item.nombreExterno} (x{item.cantidad})</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {productosSucursal.map((prod) => (
                  <TouchableOpacity key={prod.id} onPress={() => setMapeoItems((m) => m.map((it, idx) => (idx === i ? { ...it, productoId: prod.id } : it)))} style={[estilos.chip, mapeoItems[i]?.productoId === prod.id && estilos.chipActivo]}>
                    <Text style={{ color: mapeoItems[i]?.productoId === prod.id ? "#fff" : colores.texto, fontSize: 12 }}>{prod.nombre}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
          <TouchableOpacity onPress={aceptarPedidoEntrante} disabled={procesandoPedido} style={estilos.botonPrincipal}>
            <Text style={estilos.botonPrincipalTexto}>{procesandoPedido ? "Procesando…" : "Aceptar pedido y mandar a cocina"}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto, marginBottom: 10 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginTop: 4 },
    mensaje: { color: colores.navyTexto, marginBottom: 10 },
    tabPlataforma: { flex: 1, alignItems: "center", padding: 10, borderRadius: 10, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    tabPlataformaActiva: { backgroundColor: colores.navy, borderColor: colores.navy },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 14 },
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginTop: 8, color: colores.texto },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 10 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
    botonChico: { backgroundColor: colores.navy, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
    filaPedido: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colores.borde, gap: 8 },
  });
}
