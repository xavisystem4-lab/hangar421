import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { abrirBaseDeDatos } from "../db/database";
import { listarProductos } from "../db/catalogoRepo";
import { obtenerNombreSucursal, obtenerOCrearEmpresaIdLocal, obtenerSucursalErp } from "../db/dispositivoLocal";
import { guardarConfig, obtenerConfig } from "../db/configLocalRepo";
import { obtenerTokensErp } from "../api/erpHttp";
import { formatearFechaHora } from "../reportes/armarReporte";
import { aceptarPedidoPlataforma } from "../plataformas/aceptarPedidoPlataforma";
import {
  mensajeError,
  plataformasApi,
  requiereConfirmacionManual,
  type Ambiente,
  type CodigoPlataforma,
  type ErrorSincronizacion,
  type EstadoConexion,
  type FiltroEstadoPedido,
  type PlataformaConfig,
} from "../plataformas/plataformasApi";
import { esperaTrasFallos, minutosEsperando } from "../plataformas/avisosDelivery";
import { CLAVE_SONIDO_DELIVERY } from "../plataformas/useAvisosDelivery";
import {
  buscarProductos,
  sugerirProducto,
  totalSegunCatalogo,
  validarMapeo,
  type MapeoItem,
  type PedidoEntrante,
  type ProductoParaMapeo,
} from "../plataformas/ventaPlataforma";

const ORDEN_PLATAFORMAS: CodigoPlataforma[] = ["didi", "uber", "rappi"];

// Mismo criterio que el POS de Windows (screens/admin/AdminPlataformas.tsx): `campoPrincipal` debe
// coincidir con lo que espera cada adaptador del backend (validarConfiguracion()).
// Sin logotipos: no hay archivos de marca autorizados en el proyecto; se identifica cada
// plataforma por su nombre y un color de acento, sin imitar su identidad gráfica.
const INFO_PLATAFORMA: Record<CodigoPlataforma, {
  icono: string; nombre: string; acento: string; campoPrincipal: "apiKey" | "clientId"; etiquetaCampoPrincipal: string;
  autorizacion: string; pideSecretoWebhook: boolean; confirmaPorApi: string; etiquetaSecreto: string; etiquetaTienda: string;
}> = {
  didi: {
    icono: "🛵", nombre: "DiDi Food", acento: "#FF7A00", campoPrincipal: "apiKey", etiquetaCampoPrincipal: "App ID (numérico)",
    etiquetaSecreto: "App Secret", etiquetaTienda: "app_shop_id (id con el que la tienda se vinculó a tu app de DiDi)",
    autorizacion: "App ID y App Secret de tu app en el portal de desarrolladores de DiDi Food (requiere NDA y certificación). El token de cada tienda lo pide y renueva el servidor.",
    pideSecretoWebhook: false,
    confirmaPorApi: "Aceptar y rechazar se confirman en DiDi por API. DiDi cancela solo si no aceptas en 5 min. Una sola URL de webhook sirve para todas las sucursales: cada una se identifica por su app_shop_id.",
  },
  uber: {
    icono: "🚗", nombre: "Uber Eats", acento: "#06C167", campoPrincipal: "clientId", etiquetaCampoPrincipal: "Client ID",
    etiquetaSecreto: "Client Secret", etiquetaTienda: "Id de tienda (store_id)",
    autorizacion: "OAuth2 (client credentials) de una app aprobada por Uber para las Marketplace APIs; la tienda debe autorizarla.",
    pideSecretoWebhook: false,
    confirmaPorApi: "Aceptar y rechazar se confirman en Uber por API. Uber cancela solo si no respondes en ~11 min.",
  },
  rappi: {
    icono: "🐰", nombre: "Rappi", acento: "#FF441F", campoPrincipal: "clientId", etiquetaCampoPrincipal: "Client ID",
    etiquetaSecreto: "Client Secret", etiquetaTienda: "Id de tienda (store_id)",
    autorizacion: "Client ID/Secret que entrega el equipo de integraciones de Rappi (TAM), más el secreto del webhook.",
    pideSecretoWebhook: true,
    confirmaPorApi: "Aceptar se confirma en Rappi por API; rechazar, a mano en su tablet. Rappi cancela si no respondes en ~4 min.",
  },
};

const FILTROS_ESTADO: { id: FiltroEstadoPedido; etiqueta: string }[] = [
  { id: "RECIBIDA", etiqueta: "Por aceptar" },
  { id: "SINCRONIZADA", etiqueta: "Aceptados" },
  { id: "IGNORADA", etiqueta: "Rechazados" },
  { id: "CANCELADA", etiqueta: "Cancelados" },
  { id: "TODOS", etiqueta: "Todos" },
];

const ETIQUETA_ESTADO_PEDIDO: Record<string, string> = {
  RECIBIDA: "Por aceptar",
  SINCRONIZADA: "Aceptado",
  IGNORADA: "Rechazado",
  CANCELADA: "Cancelado por la plataforma",
  ERROR: "Error",
};

const ETIQUETA_CONFIRMACION: Record<string, string> = {
  CONFIRMADA: "confirmado en la plataforma",
  MANUAL: "confirmado a mano en la tablet",
  SIMULADA: "simulación",
};

const ETIQUETA_ESTADO: Record<EstadoConexion, string> = {
  CONECTADA: "Conectada",
  DESCONECTADA: "Desconectada",
  PENDIENTE_CONFIGURACION: "Pendiente de configuración",
  ERROR: "Error",
};

const dinero = (v: number) => `$${v.toFixed(2)}`;

interface Formulario {
  ambiente: Ambiente;
  identificadorTienda: string;
  activo: boolean;
  campoPrincipal: string;
  clientSecret: string;
  secretoWebhook: string;
  soloEstaSucursal: boolean;
}

/**
 * Admin → Plataformas: lo mismo que Administración → Plataformas del POS de Windows (DiDi, Uber
 * Eats y Rappi), contra el ERP en la nube.
 *
 * - **Pedidos**: la bandeja de pedidos que llegaron por webhook. Al aceptar, el cajero elige el
 *   producto real de cada item; el pedido va a cocina en el ERP y ADEMÁS queda registrado como
 *   venta de esta terminal (caja, ticket, reportes), sin duplicarse en el ERP — ver
 *   plataformas/aceptarPedidoPlataforma.ts.
 * - **Configuración**: credenciales (cifradas en el servidor, nunca se vuelven a mostrar), URL de
 *   webhook y estado de conexión de cada plataforma.
 */
export function PosAdminPlataformasScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const { usuario } = useAuthLocalStore();

  const [seccion, setSeccion] = useState<"pedidos" | "config">("pedidos");
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [productos, setProductos] = useState<ProductoParaMapeo[]>([]);

  const [sucursalId, setSucursalId] = useState<string | null>(null);
  const [nombreSucursal, setNombreSucursal] = useState<string | null>(null);
  const [pedidos, setPedidos] = useState<PedidoEntrante[]>([]);
  const [cargandoPedidos, setCargandoPedidos] = useState(false);
  const [errorPedidos, setErrorPedidos] = useState<string | null>(null);
  const [revisando, setRevisando] = useState<PedidoEntrante | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoPedido>("RECIBIDA");
  const [filtroPlataforma, setFiltroPlataforma] = useState<CodigoPlataforma | null>(null);
  const [erroresSync, setErroresSync] = useState<ErrorSincronizacion[] | null>(null);
  const [sonido, setSonido] = useState(true);
  // Reintento controlado: con el ERP caído la bandeja espera 30 s, 1, 2, 4 y luego 5 min.
  const [fallos, setFallos] = useState(0);
  const [proximoIntento, setProximoIntento] = useState<number | null>(null);
  const [, setReloj] = useState(0);

  const [configs, setConfigs] = useState<PlataformaConfig[]>([]);
  const [cargandoConfigs, setCargandoConfigs] = useState(false);
  const [seleccionada, setSeleccionada] = useState<CodigoPlataforma>("didi");
  const [formulario, setFormulario] = useState<Formulario>(formularioDe(undefined));
  const [trabajando, setTrabajando] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const db = await abrirBaseDeDatos();
      const [tokens, empresa, lista, sucursal, nombre, sonidoGuardado] = await Promise.all([
        obtenerTokensErp(), obtenerOCrearEmpresaIdLocal(db), listarProductos(db), obtenerSucursalErp(db), obtenerNombreSucursal(db), obtenerConfig(db, CLAVE_SONIDO_DELIVERY),
      ]);
      setConectado(!!tokens);
      setEmpresaId(empresa);
      setSucursalId(sucursal);
      setNombreSucursal(nombre);
      setSonido(sonidoGuardado !== "0");
      setProductos(lista.map((p) => ({ id: p.id, nombre: p.nombre, precioBase: p.precioBase })));
    })().catch(() => setConectado(false));
  }, []);

  async function cargarPedidos(): Promise<boolean> {
    if (!empresaId) return false;
    setCargandoPedidos(true);
    try {
      setPedidos(await plataformasApi.listarPedidos(empresaId, { estado: filtroEstado, plataforma: filtroPlataforma, sucursalId, limite: filtroEstado === "RECIBIDA" ? 100 : 60 }));
      setErrorPedidos(null);
      setFallos(0);
      setProximoIntento(null);
      return true;
    } catch (e: any) {
      const sinRed = !e?.status || /network|timeout|fetch/i.test(String(e?.message ?? ""));
      setErrorPedidos(sinRed ? "Sin conexión con el ERP: los pedidos siguen llegando allá y aparecerán al reconectar." : mensajeError(e, "No se pudieron cargar los pedidos de plataformas."));
      return false;
    } finally {
      setCargandoPedidos(false);
    }
  }

  async function cargarErrores() {
    try {
      setErroresSync(await plataformasApi.listarErroresSincronizacion());
    } catch (e) {
      Alert.alert("Errores de sincronización", mensajeError(e, "No se pudieron cargar."));
    }
  }

  async function cambiarSonido(v: boolean) {
    setSonido(v);
    const db = await abrirBaseDeDatos();
    await guardarConfig(db, CLAVE_SONIDO_DELIVERY, v ? "1" : "0");
  }

  async function cargarConfigs() {
    if (!empresaId) return;
    setCargandoConfigs(true);
    try {
      const lista = await plataformasApi.listarConfiguraciones(empresaId, sucursalId);
      setConfigs(lista);
      setFormulario(formularioDe(lista.find((c) => c.plataforma === seleccionada)));
    } catch (e) {
      Alert.alert("Plataformas", mensajeError(e, "No se pudo cargar la configuración."));
    } finally {
      setCargandoConfigs(false);
    }
  }

  useEffect(() => {
    if (!conectado || !empresaId) return;
    cargarConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conectado, empresaId]);

  // La bandeja se refresca sola mientras la pantalla está abierta (los pedidos llegan por
  // webhook al ERP y aquí no hay push). Si falla, espera cada vez más (backoff) en vez de
  // martillar al ERP; "Reintentar ahora" lo fuerza.
  useEffect(() => {
    if (!conectado || !empresaId) return;
    let vivo = true;
    let temporizador: ReturnType<typeof setTimeout>;
    let fallosLocales = 0;
    const ciclo = async () => {
      const ok = await cargarPedidos();
      if (!vivo) return;
      fallosLocales = ok ? 0 : fallosLocales + 1;
      setFallos(fallosLocales);
      const espera = esperaTrasFallos(fallosLocales);
      setProximoIntento(ok ? null : Date.now() + espera);
      temporizador = setTimeout(ciclo, espera);
    };
    ciclo();
    const reloj = setInterval(() => setReloj((n) => n + 1), 5_000);
    return () => {
      vivo = false;
      clearTimeout(temporizador);
      clearInterval(reloj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conectado, empresaId, filtroEstado, filtroPlataforma, sucursalId]);

  function seleccionar(codigo: CodigoPlataforma) {
    setSeleccionada(codigo);
    setFormulario(formularioDe(configs.find((c) => c.plataforma === codigo)));
  }

  async function ejecutar(etiqueta: string, accion: () => Promise<unknown>) {
    setTrabajando(etiqueta);
    try {
      await accion();
    } catch (e) {
      Alert.alert("Plataformas", mensajeError(e, "La operación no se pudo completar."));
    } finally {
      setTrabajando(null);
    }
  }

  async function guardar() {
    const info = INFO_PLATAFORMA[seleccionada];
    const faltan = [
      !formulario.identificadorTienda.trim() && "el id de tienda",
      !formulario.campoPrincipal.trim() && info.etiquetaCampoPrincipal,
      !formulario.clientSecret.trim() && `el ${info.etiquetaSecreto}`,
      info.pideSecretoWebhook && !formulario.secretoWebhook.trim() && "el secreto del webhook",
    ].filter(Boolean);
    if (faltan.length > 0) {
      Alert.alert("Faltan datos", `Completa: ${faltan.join(", ")}.`);
      return;
    }
    await ejecutar("guardar", async () => {
      const r = await plataformasApi.guardarConfiguracion(seleccionada, {
        ambiente: formulario.ambiente,
        identificadorTienda: formulario.identificadorTienda.trim(),
        activo: formulario.activo,
        credenciales: {
          [info.campoPrincipal]: formulario.campoPrincipal.trim(),
          clientSecret: formulario.clientSecret.trim(),
          ...(info.pideSecretoWebhook ? { webhookSecret: formulario.secretoWebhook.trim() } : {}),
        },
        sucursalId: formulario.soloEstaSucursal ? sucursalId : null,
      });
      Alert.alert(
        r.estadoConexion === "CONECTADA" ? "Guardado y conectado" : "Guardado, pero sin conexión",
        `Las credenciales quedaron cifradas en el servidor.\nEstado: ${ETIQUETA_ESTADO[r.estadoConexion] ?? r.estadoConexion}${r.ultimoErrorMensaje ? `\n\n${r.ultimoErrorMensaje}` : ""}`,
      );
      await cargarConfigs();
    });
  }

  function confirmar(titulo: string, texto: string, accion: () => void) {
    Alert.alert(titulo, texto, [{ text: "Cancelar", style: "cancel" }, { text: "Continuar", style: "destructive", onPress: accion }]);
  }

  if (conectado === null) {
    return <View style={estilos.centro}><ActivityIndicator color={colores.navy} size="large" /></View>;
  }

  const actual = configs.find((c) => c.plataforma === seleccionada);
  const info = INFO_PLATAFORMA[seleccionada];

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={estilos.encabezado}>
          <Text style={estilos.titulo}>Plataformas de delivery</Text>
          <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
        </View>

        {!conectado ? (
          <View style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: colores.amber }]}>
            <Text style={estilos.subtitulo}>Requiere conexión al ERP</Text>
            <Text style={estilos.ayuda}>
              Los pedidos de DiDi, Uber Eats y Rappi llegan al ERP en la nube. Conecta esta terminal desde el indicador de conexión de la barra superior.
            </Text>
          </View>
        ) : (
          <>
            <View style={estilos.filaBotones}>
              {(["pedidos", "config"] as const).map((s) => (
                <TouchableOpacity key={s} onPress={() => setSeccion(s)} style={[estilos.chip, seccion === s && estilos.chipActivo]}>
                  <Text style={{ color: seccion === s ? "#fff" : colores.texto, fontWeight: "700" }}>
                    {s === "pedidos" ? `Pedidos${pedidos.length > 0 ? ` (${pedidos.length})` : ""}` : "Configuración"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {seccion === "pedidos" && (
              <View style={{ marginTop: 14 }}>
                {/* Estado de cada integración, de un vistazo. */}
                <View style={estilos.filaBotones}>
                  {ORDEN_PLATAFORMAS.map((c) => {
                    const cfg = configs.find((x) => x.plataforma === c);
                    return (
                      <View key={c} style={[estilos.estadoPlataforma, { borderColor: INFO_PLATAFORMA[c].acento }]}>
                        <View style={[estilos.punto, { backgroundColor: colorEstado(cfg, colores) }]} />
                        <Text style={{ color: colores.texto, fontWeight: "700", fontSize: 12 }}>{INFO_PLATAFORMA[c].nombre}</Text>
                        <Text style={{ color: colores.textoSecundario, fontSize: 11 }}> · {textoEstado(cfg)}</Text>
                      </View>
                    );
                  })}
                </View>

                {errorPedidos && (
                  <View style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: colores.red, marginTop: 10 }]}>
                    <Text style={estilos.error}>{errorPedidos}</Text>
                    {proximoIntento && (
                      <Text style={estilos.ayuda}>
                        Reintento automático en {Math.max(0, Math.ceil((proximoIntento - Date.now()) / 1000))} s (intento {fallos}).
                      </Text>
                    )}
                    <TouchableOpacity onPress={cargarPedidos} style={[estilos.botonSecundario, { alignSelf: "flex-start", marginTop: 6 }]}>
                      <Text style={estilos.botonSecundarioTexto}>Reintentar ahora</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
                  {FILTROS_ESTADO.map((f) => (
                    <TouchableOpacity key={f.id} onPress={() => setFiltroEstado(f.id)} style={[estilos.chip, filtroEstado === f.id && estilos.chipActivo]}>
                      <Text style={{ color: filtroEstado === f.id ? "#fff" : colores.texto, fontWeight: "700" }}>{f.etiqueta}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
                  <TouchableOpacity onPress={() => setFiltroPlataforma(null)} style={[estilos.chip, !filtroPlataforma && estilos.chipActivo]}>
                    <Text style={{ color: !filtroPlataforma ? "#fff" : colores.texto, fontWeight: "700" }}>Todas</Text>
                  </TouchableOpacity>
                  {ORDEN_PLATAFORMAS.map((c) => (
                    <TouchableOpacity key={c} onPress={() => setFiltroPlataforma(c)} style={[estilos.chip, filtroPlataforma === c && { backgroundColor: INFO_PLATAFORMA[c].acento, borderColor: INFO_PLATAFORMA[c].acento }]}>
                      <Text style={{ color: filtroPlataforma === c ? "#fff" : colores.texto, fontWeight: "700" }}>{INFO_PLATAFORMA[c].nombre}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={estilos.filaEntre}>
                  <Text style={estilos.seccion}>{FILTROS_ESTADO.find((f) => f.id === filtroEstado)?.etiqueta} ({pedidos.length})</Text>
                  <TouchableOpacity onPress={cargarPedidos} style={estilos.botonSecundario} disabled={cargandoPedidos}>
                    {cargandoPedidos ? <ActivityIndicator color={colores.navy} /> : <Text style={estilos.botonSecundarioTexto}>Actualizar</Text>}
                  </TouchableOpacity>
                </View>
                {pedidos.length === 0 && !errorPedidos && (
                  <Text style={estilos.ayuda}>
                    {filtroEstado === "RECIBIDA" ? "No hay pedidos esperando. La lista se actualiza sola cada 30 segundos y suena al llegar uno nuevo." : "Sin pedidos con este filtro."}
                  </Text>
                )}
                {pedidos.map((p) => {
                  const inf = INFO_PLATAFORMA[p.plataforma as CodigoPlataforma];
                  const espera = minutosEsperando(p.createdAt);
                  const canceladoTrasAceptar = p.estado === "SINCRONIZADA" && /cancel/i.test(p.estadoExterno ?? "");
                  return (
                    <TouchableOpacity key={p.id} onPress={() => setRevisando(p)} style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: inf?.acento ?? colores.navy }]}>
                      <View style={estilos.filaEntre}>
                        <Text style={[estilos.subtitulo, { flexShrink: 1 }]}>
                          {inf?.icono ?? "🛍️"} {p.nombreVisible} · #{p.folioCorto ?? p.ordenExternaId}
                        </Text>
                        {p.totalExterno != null && <Text style={estilos.subtitulo}>{dinero(Number(p.totalExterno))}</Text>}
                      </View>
                      <View style={estilos.filaBotones}>
                        {p.simulado && <Text style={[estilos.etiquetaEstado, { backgroundColor: colores.amber }]}>SIMULACIÓN</Text>}
                        <Text style={[estilos.etiquetaEstado, { backgroundColor: p.estado === "RECIBIDA" ? "#FF6A13" : p.estado === "SINCRONIZADA" ? colores.green : colores.textoSecundario }]}>
                          {ETIQUETA_ESTADO_PEDIDO[p.estado] ?? p.estado}
                        </Text>
                        {p.confirmacion && <Text style={[estilos.etiquetaEstado, { backgroundColor: colores.navy }]}>{ETIQUETA_CONFIRMACION[p.confirmacion] ?? p.confirmacion}</Text>}
                      </View>
                      {canceladoTrasAceptar && <Text style={estilos.error}>⚠ La plataforma canceló este pedido después de aceptarlo. Revisa en su tablet y avisa a cocina.</Text>}
                      {p.clienteNombre && <Text style={estilos.ayuda}>Cliente: {p.clienteNombre}</Text>}
                      <Text style={estilos.ayuda}>{p.items.map((it) => `${it.cantidad}× ${it.nombreExterno}${it.modificadores?.length ? ` (${it.modificadores.join(", ")})` : ""}`).join(", ") || "Sin artículos (revisa en la tablet de la plataforma)"}</Text>
                      {p.ultimoIntentoError && p.estado === "RECIBIDA" && <Text style={estilos.error}>Último intento: {p.ultimoIntentoError}</Text>}
                      {p.estado === "IGNORADA" && p.motivoError && <Text style={estilos.ayuda}>Motivo: {p.motivoError}</Text>}
                      <Text style={[estilos.ayuda, p.estado === "RECIBIDA" && espera >= 3 && { color: colores.red, fontWeight: "700" }]}>
                        {formatearFechaHora(p.createdAt)}{p.estado === "RECIBIDA" ? ` · esperando ${espera} min · tocar para revisar` : " · tocar para ver"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity onPress={() => (erroresSync ? setErroresSync(null) : cargarErrores())} style={[estilos.botonSecundario, { alignSelf: "flex-start", marginTop: 8 }]}>
                  <Text style={estilos.botonSecundarioTexto}>{erroresSync ? "Ocultar errores de sincronización" : "Ver errores de sincronización"}</Text>
                </TouchableOpacity>
                {erroresSync && (
                  <View style={estilos.tarjeta}>
                    {erroresSync.length === 0 && <Text style={estilos.ayuda}>Sin errores recientes: todos los avisos de las plataformas se procesaron bien.</Text>}
                    {erroresSync.map((e) => (
                      <View key={e.id} style={{ marginBottom: 8 }}>
                        <Text style={estilos.etiqueta}>{INFO_PLATAFORMA[e.plataforma as CodigoPlataforma]?.nombre ?? e.plataforma} · {formatearFechaHora(e.createdAt)}</Text>
                        <Text style={estilos.ayuda}>{e.motivo}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {seccion === "config" && (
              <View style={{ marginTop: 14 }}>
                {cargandoConfigs && <ActivityIndicator color={colores.navy} />}
                <View style={estilos.filaBotones}>
                  {ORDEN_PLATAFORMAS.map((c) => {
                    const cfg = configs.find((x) => x.plataforma === c);
                    return (
                      <TouchableOpacity key={c} onPress={() => seleccionar(c)} style={[estilos.chip, seleccionada === c && { backgroundColor: INFO_PLATAFORMA[c].acento, borderColor: INFO_PLATAFORMA[c].acento }]}>
                        <Text style={{ color: seleccionada === c ? "#fff" : colores.texto, fontWeight: "700" }}>
                          {INFO_PLATAFORMA[c].icono} {INFO_PLATAFORMA[c].nombre}{cfg?.estadoConexion === "CONECTADA" && cfg.activo ? " ●" : ""}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={[estilos.tarjeta, { marginTop: 12 }]}>
                  <Text style={estilos.subtitulo}>{info.icono} {info.nombre}</Text>
                  <Text style={estilos.ayuda}>Autorización: {info.autorizacion}</Text>
                  <Text style={estilos.ayuda}>{info.confirmaPorApi}</Text>
                  {actual?.id && (
                    <Text style={estilos.ayuda}>
                      Cuenta: {actual.sucursalId ? `solo esta sucursal${nombreSucursal ? ` (${nombreSucursal})` : ""}` : "toda la empresa"} · ambiente {actual.ambiente === "PRODUCCION" ? "Producción" : "Pruebas"}
                    </Text>
                  )}
                  <Text style={[estilos.dato, { color: actual?.estadoConexion === "CONECTADA" ? colores.green : actual?.estadoConexion === "ERROR" ? colores.red : colores.textoSecundario }]}>
                    Estado: {actual ? ETIQUETA_ESTADO[actual.estadoConexion] ?? actual.estadoConexion : "Sin configurar"}
                    {actual && !actual.activo ? " (inactiva)" : ""}
                  </Text>
                  {actual?.credencialesUltimos4 && <Text style={estilos.ayuda}>Credencial guardada: ••••{actual.credencialesUltimos4}</Text>}
                  {actual && (
                    <Text style={estilos.ayuda}>
                      Pedidos recibidos: {actual.pedidosRecibidos} · aceptados: {actual.pedidosSincronizados} · última sincronización:{" "}
                      {actual.ultimaSincronizacion ? formatearFechaHora(actual.ultimaSincronizacion) : "nunca"}
                    </Text>
                  )}
                  {actual?.ultimoErrorMensaje && <Text style={estilos.error}>Último error: {actual.ultimoErrorMensaje}</Text>}

                  {actual?.webhookUrl && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={estilos.etiqueta}>URL de webhook (pégala en el panel de {info.nombre})</Text>
                      <Text selectable style={estilos.url}>{actual.webhookUrl}</Text>
                      <TouchableOpacity onPress={() => Share.share({ message: actual.webhookUrl! })} style={[estilos.botonSecundario, { alignSelf: "flex-start" }]}>
                        <Text style={estilos.botonSecundarioTexto}>Compartir URL</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {actual?.id && (
                    <View style={estilos.filaBotones}>
                      <TouchableOpacity
                        disabled={trabajando != null}
                        style={estilos.botonSecundario}
                        onPress={() => ejecutar("probar", async () => {
                          const r = await plataformasApi.probarConexion(actual.id!);
                          Alert.alert(r.ok ? "Conexión correcta" : "Falló la conexión", r.detalle);
                          await cargarConfigs();
                        })}
                      >
                        <Text style={estilos.botonSecundarioTexto}>Probar conexión</Text>
                      </TouchableOpacity>
                      {actual.activo ? (
                        <TouchableOpacity
                          disabled={trabajando != null}
                          style={estilos.botonSecundario}
                          onPress={() => confirmar(
                            `Desconectar ${info.nombre}`,
                            "Dejará de recibir pedidos hasta que la reconectes. Las credenciales guardadas no se borran.",
                            () => ejecutar("desconectar", async () => { await plataformasApi.desconectar(actual.id!); await cargarConfigs(); }),
                          )}
                        >
                          <Text style={estilos.botonSecundarioTexto}>Desconectar</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          disabled={trabajando != null}
                          style={estilos.botonSecundario}
                          onPress={() => ejecutar("reconectar", async () => {
                            const r = await plataformasApi.reconectar(actual.id!);
                            Alert.alert(r.ok ? "Reconectada" : "No se pudo reconectar", r.detalle);
                            await cargarConfigs();
                          })}
                        >
                          <Text style={estilos.botonSecundarioTexto}>Reconectar</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        disabled={trabajando != null}
                        style={estilos.botonSecundario}
                        onPress={() => confirmar(
                          "Regenerar URL de webhook",
                          `La URL anterior dejará de funcionar: tendrás que actualizarla en el panel de ${info.nombre}.`,
                          () => ejecutar("webhook", async () => { await plataformasApi.regenerarWebhook(actual.id!); await cargarConfigs(); }),
                        )}
                      >
                        <Text style={estilos.botonSecundarioTexto}>Regenerar webhook</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                <View style={estilos.tarjeta}>
                  <Text style={estilos.subtitulo}>{actual?.id ? "Actualizar credenciales" : "Configurar"}</Text>
                  <Text style={estilos.ayuda}>
                    Por seguridad las credenciales nunca se vuelven a mostrar: escríbelas completas cada vez que guardes.
                  </Text>
                  <Text style={[estilos.etiqueta, { marginTop: 10 }]}>Ambiente</Text>
                  <View style={estilos.filaBotones}>
                    {(["SANDBOX", "PRODUCCION"] as const).map((a) => (
                      <TouchableOpacity key={a} onPress={() => setFormulario((f) => ({ ...f, ambiente: a }))} style={[estilos.chip, formulario.ambiente === a && estilos.chipActivo]}>
                        <Text style={{ color: formulario.ambiente === a ? "#fff" : colores.texto, fontWeight: "700" }}>{a === "SANDBOX" ? "Pruebas" : "Producción"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[estilos.etiqueta, { marginTop: 10 }]}>{info.etiquetaTienda}</Text>
                  <TextInput style={estilos.input} autoCapitalize="none" value={formulario.identificadorTienda} onChangeText={(v) => setFormulario((f) => ({ ...f, identificadorTienda: v }))} />
                  <Text style={estilos.etiqueta}>{info.etiquetaCampoPrincipal}</Text>
                  <TextInput style={estilos.input} autoCapitalize="none" autoCorrect={false} value={formulario.campoPrincipal} onChangeText={(v) => setFormulario((f) => ({ ...f, campoPrincipal: v }))} />
                  <Text style={estilos.etiqueta}>{info.etiquetaSecreto}</Text>
                  <TextInput style={estilos.input} autoCapitalize="none" autoCorrect={false} secureTextEntry value={formulario.clientSecret} onChangeText={(v) => setFormulario((f) => ({ ...f, clientSecret: v }))} />
                  {info.pideSecretoWebhook && (
                    <>
                      <Text style={estilos.etiqueta}>Secreto del webhook</Text>
                      <TextInput style={estilos.input} autoCapitalize="none" autoCorrect={false} secureTextEntry value={formulario.secretoWebhook} onChangeText={(v) => setFormulario((f) => ({ ...f, secretoWebhook: v }))} />
                    </>
                  )}
                  {sucursalId && (
                    <View style={estilos.filaEntre}>
                      <Text style={[estilos.etiqueta, { flexShrink: 1 }]}>Cuenta solo de esta sucursal{nombreSucursal ? ` (${nombreSucursal})` : ""}</Text>
                      <Switch value={formulario.soloEstaSucursal} onValueChange={(v) => setFormulario((f) => ({ ...f, soloEstaSucursal: v }))} />
                    </View>
                  )}
                  <View style={estilos.filaEntre}>
                    <Text style={estilos.etiqueta}>Recibir pedidos de esta plataforma</Text>
                    <Switch value={formulario.activo} onValueChange={(v) => setFormulario((f) => ({ ...f, activo: v }))} />
                  </View>
                  <TouchableOpacity onPress={guardar} disabled={trabajando != null} style={estilos.botonPrincipal}>
                    {trabajando === "guardar" ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonPrincipalTexto}>Guardar y probar conexión</Text>}
                  </TouchableOpacity>
                </View>

                <View style={estilos.tarjeta}>
                  <Text style={estilos.subtitulo}>Avisos en esta terminal</Text>
                  <View style={estilos.filaEntre}>
                    <Text style={[estilos.etiqueta, { flexShrink: 1 }]}>Sonar cuando llegue un pedido nuevo</Text>
                    <Switch value={sonido} onValueChange={cambiarSonido} />
                  </View>
                  <Text style={estilos.ayuda}>El banner y la vibración salen siempre, en cualquier pantalla del POS.</Text>
                </View>

                {(!actual?.id || actual.ambiente === "SANDBOX") && (
                  <View style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: colores.amber }]}>
                    <Text style={estilos.subtitulo}>Modo demostración</Text>
                    <Text style={estilos.ayuda}>
                      Crea un pedido de PRUEBA de {info.nombre} para practicar el flujo (aviso, revisión, aceptar y venta). Sale rotulado "SIMULACIÓN" y nunca se envía a la plataforma.
                    </Text>
                    <TouchableOpacity
                      disabled={trabajando != null}
                      style={[estilos.botonSecundario, { alignSelf: "flex-start", marginTop: 8 }]}
                      onPress={() => ejecutar("simular", async () => {
                        const p = await plataformasApi.simularPedido(seleccionada, sucursalId);
                        Alert.alert("Pedido de prueba creado", `#${p.folioCorto ?? p.ordenExternaId} ya está en la bandeja "Por aceptar".`);
                        setSeccion("pedidos");
                        setFiltroEstado("RECIBIDA");
                        await Promise.all([cargarPedidos(), cargarConfigs()]);
                      })}
                    >
                      <Text style={estilos.botonSecundarioTexto}>Crear pedido de prueba</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {revisando && (
        <RevisionPedido
          pedido={revisando}
          productos={productos}
          usuarioId={usuario?.id ?? ""}
          onCerrar={(cambio) => {
            setRevisando(null);
            if (cambio) cargarPedidos();
          }}
        />
      )}
    </View>
  );
}

/** Revisión de un pedido entrante: elegir el producto real de cada item, aceptar o rechazar. */
function RevisionPedido({ pedido, productos, usuarioId, onCerrar }: {
  pedido: PedidoEntrante;
  productos: ProductoParaMapeo[];
  usuarioId: string;
  onCerrar: (huboCambio: boolean) => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  // Arranca con la sugerencia por nombre: en la mayoría de los pedidos el cajero solo confirma.
  // Las opciones elegidas en la plataforma (leche, extras) pasan a la nota de cocina del item.
  const [mapeo, setMapeo] = useState<MapeoItem[]>(() =>
    pedido.items.map((it) => ({
      productoId: sugerirProducto(it.nombreExterno, productos)?.id ?? "",
      cantidad: it.cantidad,
      notas: [it.modificadores?.join(", "), it.notas].filter(Boolean).join(" — "),
    })),
  );
  const pendiente = pedido.estado === "RECIBIDA";
  const [busquedas, setBusquedas] = useState<string[]>(() => pedido.items.map(() => ""));
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);

  const nombres = useMemo(() => Object.fromEntries(productos.map((p) => [p.id, p.nombre])), [productos]);
  const totalPos = totalSegunCatalogo(mapeo, productos);
  const totalPlataforma = pedido.totalExterno != null ? Number(pedido.totalExterno) : null;

  function actualizar(i: number, cambios: Partial<MapeoItem>) {
    setMapeo((m) => m.map((it, j) => (j === i ? { ...it, ...cambios } : it)));
  }

  /** Si la plataforma no confirma por API, el ERP pide hacerlo en su tablet primero: se le
   *  pregunta al cajero y, si ya lo hizo, se reintenta registrándolo como confirmación manual. */
  function preguntarConfirmacionManual(texto: string, accion: string, reintentar: () => void) {
    Alert.alert(`Confirma en ${pedido.nombreVisible}`, texto, [
      { text: "Todavía no", style: "cancel" },
      { text: `Ya lo ${accion} en la tablet`, onPress: reintentar },
    ]);
  }

  async function aceptar(confirmarManual = false) {
    const problemas = validarMapeo(pedido, mapeo);
    setErrores(problemas);
    if (problemas.length > 0) return;
    setProcesando(true);
    try {
      const db = await abrirBaseDeDatos();
      const venta = await aceptarPedidoPlataforma(db, pedido, mapeo, usuarioId, nombres, confirmarManual);
      Alert.alert(
        "Pedido aceptado",
        `${pedido.simulado ? "(SIMULACIÓN) " : ""}${confirmarManual ? "Registrado con tu confirmación manual. " : pedido.simulado ? "" : `${pedido.nombreVisible} confirmó la aceptación. `}Se mandó a cocina y quedó como venta #${venta.folioLocal} (${dinero(venta.total)}), pagada por ${pedido.nombreVisible}.`,
      );
      onCerrar(true);
    } catch (e) {
      if (!confirmarManual && requiereConfirmacionManual(e)) {
        preguntarConfirmacionManual(mensajeError(e, ""), "acepté", () => aceptar(true));
      } else {
        setErrores([mensajeError(e, "No se pudo aceptar el pedido. Sigue pendiente: vuelve a intentar.")]);
      }
    } finally {
      setProcesando(false);
    }
  }

  async function rechazar(confirmarManual = false) {
    if (!motivo.trim()) {
      setErrores(["Escribe el motivo del rechazo."]);
      return;
    }
    setProcesando(true);
    try {
      await plataformasApi.rechazarPedido(pedido.id, motivo.trim(), confirmarManual);
      Alert.alert("Pedido rechazado", confirmarManual ? `Quedó registrado. Recuerda que el rechazo lo hiciste en la tablet de ${pedido.nombreVisible}.` : `${pedido.nombreVisible} confirmó el rechazo.`);
      onCerrar(true);
    } catch (e) {
      if (!confirmarManual && requiereConfirmacionManual(e)) {
        preguntarConfirmacionManual(mensajeError(e, ""), "rechacé", () => rechazar(true));
      } else {
        setErrores([mensajeError(e, "No se pudo rechazar el pedido.")]);
      }
    } finally {
      setProcesando(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => onCerrar(false)}>
      <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <View style={estilos.encabezado}>
          <Text style={estilos.titulo}>{pedido.simulado ? "🧪 " : ""}{pedido.nombreVisible} #{pedido.folioCorto ?? pedido.ordenExternaId}</Text>
          <TouchableOpacity onPress={() => onCerrar(false)}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
        </View>
        {pedido.simulado && <Text style={[estilos.error, { color: colores.amber }]}>SIMULACIÓN — pedido de prueba, no es real ni se envía a la plataforma.</Text>}

        <View style={estilos.tarjeta}>
          <Text style={estilos.dato}>Estado: {ETIQUETA_ESTADO_PEDIDO[pedido.estado] ?? pedido.estado}{pedido.confirmacion ? ` · ${ETIQUETA_CONFIRMACION[pedido.confirmacion] ?? pedido.confirmacion}` : ""}</Text>
          {pedido.estadoExterno && <Text style={estilos.ayuda}>Estado en {pedido.nombreVisible}: {pedido.estadoExterno}</Text>}
          <Text style={estilos.ayuda}>Recibido: {formatearFechaHora(pedido.createdAt)}{pendiente ? ` · esperando ${minutosEsperando(pedido.createdAt)} min` : ""}</Text>
          {pedido.aceptadaEn && <Text style={estilos.ayuda}>Aceptado: {formatearFechaHora(pedido.aceptadaEn)}</Text>}
          {pedido.clienteNombre && <Text style={estilos.ayuda}>Cliente: {pedido.clienteNombre}</Text>}
          {pedido.entrega && (
            <Text style={estilos.ayuda}>
              Entrega: {[
                pedido.entrega.tipo,
                pedido.entrega.repartidor && `repartidor ${pedido.entrega.repartidor}`,
                pedido.entrega.horaEstimada && `listo/recolección ${formatearFechaHora(pedido.entrega.horaEstimada)}`,
                pedido.entrega.codigoEntrega && `código ${pedido.entrega.codigoEntrega}`,
              ].filter(Boolean).join(" · ") || "sin datos"}
            </Text>
          )}
          {pedido.montos && (
            <Text style={estilos.ayuda}>
              {[
                pedido.montos.subtotal != null && `Subtotal ${dinero(Number(pedido.montos.subtotal))}`,
                pedido.montos.descuento ? `Descuento ${dinero(Number(pedido.montos.descuento))}` : null,
                pedido.montos.envio ? `Envío ${dinero(Number(pedido.montos.envio))}` : null,
                pedido.montos.propina ? `Propina ${dinero(Number(pedido.montos.propina))}` : null,
              ].filter(Boolean).join(" · ")}
            </Text>
          )}
          {pedido.notas && <Text style={[estilos.ayuda, { fontWeight: "700" }]}>Notas del pedido: {pedido.notas}</Text>}
          {pedido.estado === "IGNORADA" && pedido.motivoError && <Text style={estilos.ayuda}>Motivo del rechazo: {pedido.motivoError}</Text>}
          {pedido.ultimoIntentoError && pendiente && <Text style={estilos.error}>Último intento: {pedido.ultimoIntentoError}</Text>}
        </View>
        {pendiente && <Text style={[estilos.ayuda, { marginBottom: 12 }]}>Elige el producto del menú que corresponde a cada artículo de la plataforma.</Text>}

        {pedido.items.map((it, i) => {
          const elegido = productos.find((p) => p.id === mapeo[i]?.productoId);
          const resultados = buscarProductos(busquedas[i], productos);
          return (
            <View key={i} style={estilos.tarjeta}>
              <Text style={estilos.subtitulo}>{it.cantidad}× {it.nombreExterno}{it.precioUnitario != null ? ` · ${dinero(Number(it.precioUnitario))}` : ""}</Text>
              {it.modificadores?.length ? <Text style={estilos.ayuda}>Opciones: {it.modificadores.join(", ")}</Text> : null}
              {it.notas ? <Text style={estilos.ayuda}>Nota: {it.notas}</Text> : null}
              {!pendiente ? null : <>
              <Text style={[estilos.dato, { color: elegido ? colores.green : colores.amber }]}>
                {elegido ? `→ ${elegido.nombre} (${dinero(elegido.precioBase)})` : "→ Sin producto elegido"}
              </Text>
              <TextInput
                style={[estilos.input, { marginTop: 8 }]}
                placeholder="Buscar en el menú…"
                placeholderTextColor={colores.textoSecundario}
                value={busquedas[i]}
                onChangeText={(v) => setBusquedas((b) => b.map((x, j) => (j === i ? v : x)))}
              />
              {resultados.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => {
                    actualizar(i, { productoId: p.id });
                    setBusquedas((b) => b.map((x, j) => (j === i ? "" : x)));
                  }}
                  style={estilos.resultado}
                >
                  <Text style={{ color: colores.texto }}>{p.nombre}</Text>
                  <Text style={{ color: colores.textoSecundario }}>{dinero(p.precioBase)}</Text>
                </TouchableOpacity>
              ))}
              <View style={[estilos.filaEntre, { marginTop: 8 }]}>
                <Text style={estilos.etiqueta}>Cantidad</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <TouchableOpacity onPress={() => actualizar(i, { cantidad: Math.max(1, (mapeo[i]?.cantidad ?? 1) - 1) })} style={estilos.paso}><Text style={estilos.pasoTexto}>−</Text></TouchableOpacity>
                  <Text style={estilos.subtitulo}>{mapeo[i]?.cantidad ?? 1}</Text>
                  <TouchableOpacity onPress={() => actualizar(i, { cantidad: (mapeo[i]?.cantidad ?? 1) + 1 })} style={estilos.paso}><Text style={estilos.pasoTexto}>+</Text></TouchableOpacity>
                </View>
              </View>
              <TextInput
                style={estilos.input}
                placeholder="Nota para cocina (opcional)"
                placeholderTextColor={colores.textoSecundario}
                value={mapeo[i]?.notas ?? ""}
                onChangeText={(v) => actualizar(i, { notas: v })}
              />
              </>}
            </View>
          );
        })}

        {pendiente && <View style={estilos.tarjeta}>
          <View style={estilos.filaEntre}>
            <Text style={estilos.etiqueta}>Total con precios del menú</Text>
            <Text style={estilos.subtitulo}>{dinero(totalPos)}</Text>
          </View>
          {totalPlataforma != null && (
            <View style={estilos.filaEntre}>
              <Text style={estilos.etiqueta}>Total en {pedido.nombreVisible}</Text>
              <Text style={estilos.subtitulo}>{dinero(totalPlataforma)}</Text>
            </View>
          )}
          <Text style={estilos.ayuda}>
            La venta se registra con los precios del menú (los del ERP) y se paga con "Otro – {pedido.nombreVisible}": no entra al efectivo del corte.
          </Text>
          {pedido.puedeConfirmarEnPlataforma === false && !pedido.simulado && (
            <Text style={[estilos.ayuda, { color: colores.amber, fontWeight: "700" }]}>
              {pedido.nombreVisible} no confirma por API con la configuración actual: acepta/rechaza primero en su tablet y luego confirma aquí.
            </Text>
          )}
        </View>}

        {errores.map((e, i) => <Text key={i} style={estilos.error}>{e}</Text>)}

        {!pendiente ? null : !rechazando ? (
          <>
            <TouchableOpacity onPress={() => aceptar()} disabled={procesando} style={estilos.botonPrincipal}>
              {procesando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonPrincipalTexto}>Aceptar, mandar a cocina y registrar venta</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setRechazando(true); setErrores([]); }} disabled={procesando} style={[estilos.botonSecundario, { alignItems: "center", paddingVertical: 12 }]}>
              <Text style={[estilos.botonSecundarioTexto, { color: colores.red }]}>Rechazar pedido</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={estilos.tarjeta}>
            <Text style={estilos.etiqueta}>Motivo del rechazo</Text>
            <TextInput style={estilos.input} value={motivo} onChangeText={setMotivo} placeholder="Ej. sin insumos, fuera de horario…" placeholderTextColor={colores.textoSecundario} />
            <TouchableOpacity onPress={() => rechazar()} disabled={procesando} style={[estilos.botonPrincipal, { backgroundColor: colores.red }]}>
              {procesando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonPrincipalTexto}>Confirmar rechazo</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setRechazando(false)} disabled={procesando}>
              <Text style={[estilos.ayuda, { textAlign: "center" }]}>Volver</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}

function formularioDe(cfg: PlataformaConfig | undefined): Formulario {
  return {
    ambiente: cfg?.ambiente ?? "SANDBOX",
    identificadorTienda: cfg?.identificadorTienda ?? "",
    activo: cfg?.activo ?? true,
    // Nunca se pre-llenan: guardar la máscara sobrescribiría el secreto real.
    campoPrincipal: "",
    clientSecret: "",
    secretoWebhook: "",
    soloEstaSucursal: !!cfg?.sucursalId,
  };
}

function colorEstado(cfg: PlataformaConfig | undefined, colores: ReturnType<typeof usarColores>): string {
  if (!cfg || !cfg.id) return colores.textoSecundario;
  if (cfg.estadoConexion === "CONECTADA" && cfg.activo) return colores.green;
  if (cfg.estadoConexion === "ERROR") return colores.red;
  return colores.amber;
}

function textoEstado(cfg: PlataformaConfig | undefined): string {
  if (!cfg || !cfg.id) return "Sin configurar";
  if (!cfg.activo) return "Desactivada";
  return ETIQUETA_ESTADO[cfg.estadoConexion] ?? cfg.estadoConexion;
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    centro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto, flexShrink: 1 },
    cerrar: { color: colores.textoSecundario, fontSize: 20, paddingLeft: 12 },
    seccion: { fontSize: 15, fontWeight: "800", color: colores.texto },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginBottom: 2 },
    etiqueta: { fontSize: 13, fontWeight: "700", color: colores.texto },
    ayuda: { fontSize: 12, color: colores.textoSecundario, lineHeight: 17, marginTop: 4 },
    dato: { fontSize: 13, color: colores.texto, marginTop: 4, fontWeight: "600" },
    error: { fontSize: 13, color: colores.red, marginTop: 6, marginBottom: 4, lineHeight: 18 },
    url: { fontSize: 12, color: colores.navyTexto, fontFamily: "monospace", marginVertical: 6 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 12, padding: 14, marginBottom: 12 },
    filaEntre: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 },
    filaBotones: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    chip: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colores.gray50 },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    estadoPlataforma: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 16, paddingVertical: 5, paddingHorizontal: 10, gap: 6, backgroundColor: colores.superficie },
    punto: { width: 10, height: 10, borderRadius: 5 },
    etiquetaEstado: { color: "#fff", fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto, backgroundColor: colores.superficie },
    resultado: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colores.borde },
    paso: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colores.borde, alignItems: "center", justifyContent: "center" },
    pasoTexto: { fontSize: 18, fontWeight: "800", color: colores.texto },
    botonSecundario: { borderWidth: 1, borderColor: colores.navy, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 8 },
    botonSecundarioTexto: { color: colores.navyTexto, fontWeight: "700" },
    botonPrincipal: { backgroundColor: colores.navy, borderRadius: 10, padding: 15, alignItems: "center", minHeight: 50, justifyContent: "center", marginVertical: 10 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "800", fontSize: 15, textAlign: "center" },
  });
}
