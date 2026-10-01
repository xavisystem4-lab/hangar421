import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { abrirBaseDeDatos } from "../db/database";
import { listarProductos } from "../db/catalogoRepo";
import { obtenerOCrearEmpresaIdLocal } from "../db/dispositivoLocal";
import { obtenerTokensErp } from "../api/erpHttp";
import { formatearFechaHora } from "../reportes/armarReporte";
import { aceptarPedidoPlataforma } from "../plataformas/aceptarPedidoPlataforma";
import {
  mensajeError,
  plataformasApi,
  type Ambiente,
  type CodigoPlataforma,
  type EstadoConexion,
  type PlataformaConfig,
} from "../plataformas/plataformasApi";
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
const INFO_PLATAFORMA: Record<CodigoPlataforma, { icono: string; nombre: string; acento: string; campoPrincipal: "apiKey" | "clientId"; etiquetaCampoPrincipal: string }> = {
  didi: { icono: "🛵", nombre: "DiDi Food", acento: "#FF7A00", campoPrincipal: "apiKey", etiquetaCampoPrincipal: "API Key / Client ID" },
  uber: { icono: "🚗", nombre: "Uber Eats", acento: "#06C167", campoPrincipal: "clientId", etiquetaCampoPrincipal: "Client ID" },
  rappi: { icono: "🐰", nombre: "Rappi", acento: "#FF441F", campoPrincipal: "clientId", etiquetaCampoPrincipal: "Client ID" },
};

const ETIQUETA_ESTADO: Record<EstadoConexion, string> = {
  CONECTADA: "Conectada",
  DESCONECTADA: "Desconectada",
  PENDIENTE_CONFIGURACION: "Pendiente de configuración",
  ERROR: "Error",
};

const REFRESCO_MS = 30_000;

const dinero = (v: number) => `$${v.toFixed(2)}`;

interface Formulario {
  ambiente: Ambiente;
  identificadorTienda: string;
  activo: boolean;
  campoPrincipal: string;
  clientSecret: string;
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

  const [pedidos, setPedidos] = useState<PedidoEntrante[]>([]);
  const [cargandoPedidos, setCargandoPedidos] = useState(false);
  const [errorPedidos, setErrorPedidos] = useState<string | null>(null);
  const [revisando, setRevisando] = useState<PedidoEntrante | null>(null);

  const [configs, setConfigs] = useState<PlataformaConfig[]>([]);
  const [cargandoConfigs, setCargandoConfigs] = useState(false);
  const [seleccionada, setSeleccionada] = useState<CodigoPlataforma>("didi");
  const [formulario, setFormulario] = useState<Formulario>(formularioDe(undefined));
  const [trabajando, setTrabajando] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const db = await abrirBaseDeDatos();
      const [tokens, empresa, lista] = await Promise.all([obtenerTokensErp(), obtenerOCrearEmpresaIdLocal(db), listarProductos(db)]);
      setConectado(!!tokens);
      setEmpresaId(empresa);
      setProductos(lista.map((p) => ({ id: p.id, nombre: p.nombre, precioBase: p.precioBase })));
    })().catch(() => setConectado(false));
  }, []);

  async function cargarPedidos() {
    if (!empresaId) return;
    setCargandoPedidos(true);
    try {
      setPedidos(await plataformasApi.listarPedidosPorAceptar(empresaId));
      setErrorPedidos(null);
    } catch (e) {
      setErrorPedidos(mensajeError(e, "No se pudieron cargar los pedidos de plataformas."));
    } finally {
      setCargandoPedidos(false);
    }
  }

  async function cargarConfigs() {
    if (!empresaId) return;
    setCargandoConfigs(true);
    try {
      const lista = await plataformasApi.listarConfiguraciones(empresaId);
      setConfigs(lista);
      setFormulario(formularioDe(lista.find((c) => c.plataforma === seleccionada)));
    } catch (e) {
      Alert.alert("Plataformas", mensajeError(e, "No se pudo cargar la configuración."));
    } finally {
      setCargandoConfigs(false);
    }
  }

  // La bandeja se refresca sola mientras la pantalla está abierta: los pedidos llegan por webhook
  // al ERP en cualquier momento y aquí no hay push.
  useEffect(() => {
    if (!conectado || !empresaId) return;
    cargarPedidos();
    cargarConfigs();
    const intervalo = setInterval(cargarPedidos, REFRESCO_MS);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conectado, empresaId]);

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
      !formulario.clientSecret.trim() && "el Client Secret",
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
        credenciales: { [info.campoPrincipal]: formulario.campoPrincipal.trim(), clientSecret: formulario.clientSecret.trim() },
      });
      Alert.alert("Guardado", `Las credenciales quedaron cifradas en el servidor.\nEstado: ${ETIQUETA_ESTADO[r.estadoConexion] ?? r.estadoConexion}`);
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
                <View style={estilos.filaEntre}>
                  <Text style={estilos.seccion}>Por aceptar</Text>
                  <TouchableOpacity onPress={cargarPedidos} style={estilos.botonSecundario} disabled={cargandoPedidos}>
                    {cargandoPedidos ? <ActivityIndicator color={colores.navy} /> : <Text style={estilos.botonSecundarioTexto}>Actualizar</Text>}
                  </TouchableOpacity>
                </View>
                {errorPedidos && <Text style={estilos.error}>{errorPedidos}</Text>}
                {pedidos.length === 0 && !errorPedidos && (
                  <Text style={estilos.ayuda}>No hay pedidos esperando. Esta lista se actualiza sola cada 30 segundos.</Text>
                )}
                {pedidos.map((p) => {
                  const inf = INFO_PLATAFORMA[p.plataforma as CodigoPlataforma];
                  return (
                    <TouchableOpacity key={p.id} onPress={() => setRevisando(p)} style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: inf?.acento ?? colores.navy }]}>
                      <View style={estilos.filaEntre}>
                        <Text style={estilos.subtitulo}>{inf?.icono ?? "🛍️"} {p.nombreVisible} · #{p.ordenExternaId}</Text>
                        {p.totalExterno != null && <Text style={estilos.subtitulo}>{dinero(Number(p.totalExterno))}</Text>}
                      </View>
                      {p.clienteNombre && <Text style={estilos.ayuda}>Cliente: {p.clienteNombre}</Text>}
                      <Text style={estilos.ayuda}>{p.items.map((it) => `${it.cantidad}× ${it.nombreExterno}`).join(", ")}</Text>
                      <Text style={estilos.ayuda}>{formatearFechaHora(p.createdAt)} · Tocar para revisar</Text>
                    </TouchableOpacity>
                  );
                })}
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
                          {INFO_PLATAFORMA[c].icono} {INFO_PLATAFORMA[c].nombre}{cfg?.estadoConexion === "CONECTADA" ? " ●" : ""}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={[estilos.tarjeta, { marginTop: 12 }]}>
                  <Text style={estilos.subtitulo}>{info.icono} {info.nombre}</Text>
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
                  <Text style={[estilos.etiqueta, { marginTop: 10 }]}>Id de tienda / restaurante</Text>
                  <TextInput style={estilos.input} autoCapitalize="none" value={formulario.identificadorTienda} onChangeText={(v) => setFormulario((f) => ({ ...f, identificadorTienda: v }))} />
                  <Text style={estilos.etiqueta}>{info.etiquetaCampoPrincipal}</Text>
                  <TextInput style={estilos.input} autoCapitalize="none" autoCorrect={false} value={formulario.campoPrincipal} onChangeText={(v) => setFormulario((f) => ({ ...f, campoPrincipal: v }))} />
                  <Text style={estilos.etiqueta}>Client Secret</Text>
                  <TextInput style={estilos.input} autoCapitalize="none" autoCorrect={false} secureTextEntry value={formulario.clientSecret} onChangeText={(v) => setFormulario((f) => ({ ...f, clientSecret: v }))} />
                  <View style={estilos.filaEntre}>
                    <Text style={estilos.etiqueta}>Recibir pedidos de esta plataforma</Text>
                    <Switch value={formulario.activo} onValueChange={(v) => setFormulario((f) => ({ ...f, activo: v }))} />
                  </View>
                  <TouchableOpacity onPress={guardar} disabled={trabajando != null} style={estilos.botonPrincipal}>
                    {trabajando === "guardar" ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonPrincipalTexto}>Guardar y probar conexión</Text>}
                  </TouchableOpacity>
                </View>
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
  const [mapeo, setMapeo] = useState<MapeoItem[]>(() =>
    pedido.items.map((it) => ({ productoId: sugerirProducto(it.nombreExterno, productos)?.id ?? "", cantidad: it.cantidad, notas: it.notas ?? "" })),
  );
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

  async function aceptar() {
    const problemas = validarMapeo(pedido, mapeo);
    setErrores(problemas);
    if (problemas.length > 0) return;
    setProcesando(true);
    try {
      const db = await abrirBaseDeDatos();
      const venta = await aceptarPedidoPlataforma(db, pedido, mapeo, usuarioId, nombres);
      Alert.alert("Pedido aceptado", `Se mandó a cocina y quedó registrado como venta #${venta.folioLocal} (${dinero(venta.total)}), pagada por ${pedido.nombreVisible}.`);
      onCerrar(true);
    } catch (e) {
      setErrores([mensajeError(e, "No se pudo aceptar el pedido.")]);
    } finally {
      setProcesando(false);
    }
  }

  async function rechazar() {
    if (!motivo.trim()) {
      setErrores(["Escribe el motivo del rechazo."]);
      return;
    }
    setProcesando(true);
    try {
      await plataformasApi.rechazarPedido(pedido.id, motivo.trim());
      Alert.alert("Pedido rechazado", `El cliente no recibe aviso automático: si corresponde, avísale por ${pedido.nombreVisible}.`);
      onCerrar(true);
    } catch (e) {
      setErrores([mensajeError(e, "No se pudo rechazar el pedido.")]);
    } finally {
      setProcesando(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => onCerrar(false)}>
      <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <View style={estilos.encabezado}>
          <Text style={estilos.titulo}>{pedido.nombreVisible} #{pedido.ordenExternaId}</Text>
          <TouchableOpacity onPress={() => onCerrar(false)}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
        </View>
        {pedido.clienteNombre && <Text style={estilos.ayuda}>Cliente: {pedido.clienteNombre}</Text>}
        <Text style={[estilos.ayuda, { marginBottom: 12 }]}>Elige el producto del menú que corresponde a cada artículo de la plataforma.</Text>

        {pedido.items.map((it, i) => {
          const elegido = productos.find((p) => p.id === mapeo[i]?.productoId);
          const resultados = buscarProductos(busquedas[i], productos);
          return (
            <View key={i} style={estilos.tarjeta}>
              <Text style={estilos.subtitulo}>{it.cantidad}× {it.nombreExterno}</Text>
              {it.notas ? <Text style={estilos.ayuda}>Nota: {it.notas}</Text> : null}
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
            </View>
          );
        })}

        <View style={estilos.tarjeta}>
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
        </View>

        {errores.map((e, i) => <Text key={i} style={estilos.error}>{e}</Text>)}

        {!rechazando ? (
          <>
            <TouchableOpacity onPress={aceptar} disabled={procesando} style={estilos.botonPrincipal}>
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
            <TouchableOpacity onPress={rechazar} disabled={procesando} style={[estilos.botonPrincipal, { backgroundColor: colores.red }]}>
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
  };
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
