import { useEffect, useState } from "react";
import { Alert, BackHandler, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { RolUsuario, diasDeTurnoAbierto } from "@hangar421/shared";
import { useAuthLocalStore } from "../store/authLocalStore";
import { useSyncStatusStore, type EstadoSync } from "../store/syncStatusStore";
import { usarColores } from "../store/temaStore";
import { procesarCola } from "../sync/syncEngine";
import { abrirBaseDeDatos } from "../db/database";
import { listarTicketsPendientes } from "../db/ticketsRepo";
import { obtenerNombreSucursal } from "../db/dispositivoLocal";
import { turnoPendienteDeDiaAnterior, type TurnoPendiente } from "../db/turnosRepo";
import { useBotonAtras } from "../hooks/useBotonAtras";
import { ModalRenombrarSucursal } from "../components/ModalRenombrarSucursal";
import { ModalAutorizacion } from "../components/ModalAutorizacion";
import { PosVentaScreen } from "./PosVentaScreen";
import { PosCobroScreen } from "./PosCobroScreen";
import { PosCajaScreen } from "./PosCajaScreen";
import { PosConsultarVentasScreen } from "./PosConsultarVentasScreen";
import { ConexionErpScreen } from "./ConexionErpScreen";
import { PosAdminCatalogoScreen } from "./PosAdminCatalogoScreen";
import { PosAdminReportesScreen } from "./PosAdminReportesScreen";
import { PosAdminUsuariosScreen } from "./PosAdminUsuariosScreen";
import { PosAdminPagosScreen } from "./PosAdminPagosScreen";
import { PosAdminInventarioScreen } from "./PosAdminInventarioScreen";
import { PosAdminSincronizacionScreen } from "./PosAdminSincronizacionScreen";
import { ReciboEnPantallaScreen } from "./ReciboEnPantallaScreen";

type Pantalla = "venta" | "cobro" | "caja" | "consultar" | "admin";
type PantallaAdmin = "catalogo" | "inventario" | "reportes" | "usuarios" | "pagos" | "sync";

const TABS: { id: Pantalla; etiqueta: string }[] = [
  { id: "venta", etiqueta: "Venta" },
  { id: "caja", etiqueta: "Caja" },
];

const ROLES_ADMIN = new Set([RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO]);

const ETIQUETA_SYNC: Record<EstadoSync, string> = {
  SIN_CONEXION: "○ Sin conexión",
  PENDIENTE: "◐ Conectado al ERP",
  SINCRONIZADO: "● Conectado al ERP",
  ERROR: "✕ Error de conexión",
};

export function PosNavigator() {
  const { usuario, salir } = useAuthLocalStore();
  const sync = useSyncStatusStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const esAdmin = !!usuario && ROLES_ADMIN.has(usuario.rol as RolUsuario);
  const tabs = esAdmin ? [...TABS, { id: "admin" as Pantalla, etiqueta: "Admin" }] : TABS;

  const [pantalla, setPantalla] = useState<Pantalla>("venta");
  const [pantallaAdmin, setPantallaAdmin] = useState<PantallaAdmin>("catalogo");
  const [ultimoFolio, setUltimoFolio] = useState<{ folio: number; total: number } | null>(null);
  const [mostrarConexion, setMostrarConexion] = useState(false);
  const [reciboPendiente, setReciboPendiente] = useState<string | null>(null);
  const [sucursalActiva, setSucursalActiva] = useState<string | null>(null);
  const [renombrando, setRenombrando] = useState(false);
  // Qué acción sensible está esperando el PIN de un gerente: cambiar de sucursal o renombrarla.
  // Ambas afectan a dónde acaban las ventas o a cómo se identifica la sucursal en el ERP.
  const [autorizando, setAutorizando] = useState<"cambiar" | "renombrar" | null>(null);

  // Indicador de sucursal activa: se recarga al volver de la pantalla de conexión, que es el
  // único sitio donde puede cambiar. Se lee de la base local, no del ERP, para que siga
  // visible sin conexión.
  useEffect(() => {
    if (mostrarConexion) return;
    abrirBaseDeDatos()
      .then(obtenerNombreSucursal)
      .then(setSucursalActiva)
      .catch(() => undefined);
  }, [mostrarConexion]);

  /**
   * Aviso de turno sin cerrar desde un día anterior (solo avisa, no bloquea). Se revisa al
   * entrar, al cambiar de pestaña —así desaparece al volver de Caja tras cerrarlo— y cada 10
   * minutos, porque el cambio de día ocurre con la app abierta. Sale de la base local: funciona
   * sin conexión. "Entendido" lo oculta para ESE turno hasta el próximo inicio de sesión.
   */
  const [turnoPendiente, setTurnoPendiente] = useState<TurnoPendiente | null>(null);
  const [avisoOcultoDe, setAvisoOcultoDe] = useState<string | null>(null);
  useEffect(() => {
    if (mostrarConexion) return;
    const revisar = () =>
      abrirBaseDeDatos()
        .then((db) => turnoPendienteDeDiaAnterior(db))
        .then(setTurnoPendiente)
        .catch(() => undefined);
    revisar();
    const intervalo = setInterval(revisar, 10 * 60_000);
    return () => clearInterval(intervalo);
  }, [pantalla, mostrarConexion]);

  /**
   * Botón atrás de Android: un paso atrás de verdad, en vez de cerrar la app.
   *
   * El orden va de lo más anidado a lo más general, que es el orden en que el usuario "entró":
   * pantalla de conexión o recibo → subpantalla de Admin → pestaña secundaria → Venta. Solo
   * estando ya en Venta se deja salir, y preguntando: en una tablet de mostrador ese botón se
   * roza constantemente y cerrar el POS a media jornada no puede ser un accidente de un toque.
   */
  useBotonAtras(() => {
    if (autorizando) { setAutorizando(null); return true; }
    if (renombrando) { setRenombrando(false); return true; }
    if (mostrarConexion) { setMostrarConexion(false); return true; }
    if (reciboPendiente) { setReciboPendiente(null); return true; }

    if (pantalla === "admin" && pantallaAdmin !== "catalogo") { setPantallaAdmin("catalogo"); return true; }
    if (pantalla !== "venta") { setPantalla("venta"); return true; }

    Alert.alert("Salir del Punto de Venta", "¿Seguro que quieres cerrar la aplicación?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Salir", style: "destructive", onPress: () => BackHandler.exitApp() },
    ]);
    return true;
  }, [autorizando, renombrando, mostrarConexion, reciboPendiente, pantalla, pantallaAdmin]);

  /** Tocar la sucursal ya no lleva directo a Conexión: desde aquí se puede tanto cambiar de
   *  sucursal como corregir su nombre, que son las dos cosas que se buscan en ese sitio. */
  function tocarSucursal() {
    if (!sucursalActiva) { setMostrarConexion(true); return; }
    Alert.alert(
      sucursalActiva,
      "¿Qué quieres hacer con esta sucursal?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Cambiar nombre", onPress: () => setAutorizando("renombrar") },
        { text: "Cambiar de sucursal", onPress: () => setAutorizando("cambiar") },
      ],
    );
  }

  /**
   * Sincroniza y cuenta qué pasó.
   *
   * Antes "Sincronizar ahora" disparaba `procesarCola` y cerraba el diálogo sin decir nada: si
   * fallaba —que es justo cuando se pulsa— no había ninguna señal ni salida. Ahora el resultado
   * se muestra y ofrece enlazar de nuevo con un código, que es lo que resuelve el caso en el que
   * el enlace de la terminal es lo que está roto (token revocado, sucursal reasignada, terminal
   * dada de baja desde el ERP).
   */
  async function sincronizarAhora() {
    const antes = useSyncStatusStore.getState().pendientes;
    await procesarCola(true).catch(() => undefined);
    const despues = useSyncStatusStore.getState();

    const enviados = Math.max(0, antes - despues.pendientes);
    const fallo = despues.estado === "ERROR" || despues.estado === "SIN_CONEXION";

    const titulo = fallo ? "No se pudo sincronizar" : "Sincronización terminada";
    const detalle = fallo
      ? `${despues.ultimoError ?? "El ERP no respondió."}${despues.pendientes > 0 ? `\n\nQuedan ${despues.pendientes} evento(s) sin enviar. No se pierde nada: se reintenta solo.` : ""}`
      : enviados > 0
        ? `Se enviaron ${enviados} evento(s) al ERP.`
        : "Todo estaba al día, no había nada pendiente.";

    Alert.alert(titulo, `${detalle}\n\n¿Quieres volver a enlazar esta terminal con un código nuevo?`, [
      { text: "No, cerrar", style: "cancel" },
      { text: "Poner código nuevo", onPress: () => setMostrarConexion(true) },
    ]);
  }

  function tocarIndicadorSync() {
    if (!sync.conectadoAlErp) {
      setMostrarConexion(true);
      return;
    }
    Alert.alert(
      "Sincronización",
      `${ETIQUETA_SYNC[sync.estado]}${sync.pendientes > 0 ? `\n${sync.pendientes} evento(s) pendiente(s)` : ""}${sync.ultimoError ? `\n\n${sync.ultimoError}` : ""}`,
      [
        { text: "Cerrar", style: "cancel" },
        { text: "Sincronizar ahora", onPress: () => { sincronizarAhora(); } },
        { text: "Ver detalle", onPress: () => { setPantalla("admin"); setPantallaAdmin("sync"); } },
        { text: "Configurar conexión", onPress: () => setMostrarConexion(true) },
      ],
    );
  }

  function confirmarSalir() {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres cerrar tu sesión?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Cerrar sesión", style: "destructive", onPress: salir },
    ]);
  }

  async function cobroConfirmado(ventaId: string, folio: number, total: number) {
    setUltimoFolio({ folio, total });
    setPantalla("venta");
    // El ticket ya se intentó imprimir dentro de PosCobroScreen (best-effort, después de
    // confirmar la venta) — si sigue pendiente, este es el respaldo en pantalla.
    const db = await abrirBaseDeDatos();
    const pendientes = await listarTicketsPendientes(db);
    if (pendientes.some((p) => p.id === ventaId)) setReciboPendiente(ventaId);
  }

  if (mostrarConexion) {
    return <ConexionErpScreen onCerrar={() => setMostrarConexion(false)} onConectado={() => setMostrarConexion(false)} />;
  }

  if (reciboPendiente) {
    return <ReciboEnPantallaScreen ventaId={reciboPendiente} onCerrar={() => setReciboPendiente(null)} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <View style={estilos.header}>
        <View style={{ flex: 1 }}>
          <Text style={estilos.headerTitulo} numberOfLines={1}>HANGAR 421 · {usuario?.nombre}</Text>
          {/* Selector de sucursal activa: siempre visible, y tocarlo lleva a cambiarla. Si la
              terminal no está enlazada lo dice, en vez de dejar el hueco en blanco. */}
          <TouchableOpacity onPress={tocarSucursal} accessibilityLabel="Opciones de sucursal">
            <Text style={estilos.headerSucursal} numberOfLines={1}>
              {sucursalActiva ? `🏪 ${sucursalActiva}` : "🏪 Sin sucursal enlazada"} ▾
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TouchableOpacity onPress={tocarIndicadorSync}>
            <Text style={estilos.indicadorSync}>{ETIQUETA_SYNC[sync.estado]}</Text>
          </TouchableOpacity>
          {/* El interruptor de modo noche vive en la barra inferior (BarraActualizacion), que se
              dibuja en TODAS las pantallas — incluida la de login, que es la primera que ve un
              cajero al abrir el turno de noche. */}
          <TouchableOpacity onPress={confirmarSalir} style={estilos.botonHeader} accessibilityLabel="Cerrar sesión">
            <Text style={estilos.botonHeaderTexto}>🚪</Text>
          </TouchableOpacity>
        </View>
      </View>

      {turnoPendiente && avisoOcultoDe !== turnoPendiente.turno.id && (
        <View style={estilos.avisoTurno} accessibilityRole="alert">
          <Text style={estilos.avisoTurnoTitulo}>
            ⚠ Turno sin cerrar{" "}
            {diasDeTurnoAbierto(turnoPendiente.turno.abiertoAt) <= 1
              ? "desde ayer"
              : `desde hace ${diasDeTurnoAbierto(turnoPendiente.turno.abiertoAt)} días`}
          </Text>
          <Text style={estilos.avisoTurnoTexto}>
            {turnoPendiente.sucursal} · abierto el{" "}
            {new Date(turnoPendiente.turno.abiertoAt).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {" · "}responsable: {turnoPendiente.responsable} · turno {turnoPendiente.turno.id.slice(-6)}
          </Text>
          <Text style={estilos.avisoTurnoTexto}>Las ventas nuevas se suman a ese mismo corte hasta que se cierre.</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {pantalla !== "caja" && (
              <TouchableOpacity onPress={() => setPantalla("caja")} style={estilos.avisoTurnoBoton}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>Ir a Caja para cerrarlo</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setAvisoOcultoDe(turnoPendiente.turno.id)} style={estilos.avisoTurnoBotonSecundario}>
              <Text style={{ color: colores.red, fontWeight: "700" }}>Entendido</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {ultimoFolio && (
        <View style={estilos.avisoFolio}>
          <Text style={estilos.avisoFolioTexto}>✓ Venta #{ultimoFolio.folio} confirmada — ${ultimoFolio.total.toFixed(2)}</Text>
          <TouchableOpacity onPress={() => setUltimoFolio(null)}><Text style={estilos.avisoFolioCerrar}>✕</Text></TouchableOpacity>
        </View>
      )}

      <View style={{ flex: 1 }}>
        {pantalla === "venta" && <PosVentaScreen onCobrar={() => setPantalla("cobro")} />}
        {pantalla === "cobro" && <PosCobroScreen onCerrar={() => setPantalla("venta")} onCobrado={cobroConfirmado} />}
        {pantalla === "caja" && <PosCajaScreen />}
        {pantalla === "consultar" && <PosConsultarVentasScreen onCerrar={() => setPantalla("venta")} />}
        {pantalla === "admin" && (
          <View style={{ flex: 1 }}>
            {/* Horizontal: con cuatro pestañas ya no caben en el ancho de un celular. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={estilos.subTabs} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
              <TouchableOpacity onPress={() => setPantallaAdmin("catalogo")} style={[estilos.subTab, pantallaAdmin === "catalogo" && estilos.subTabActivo]}>
                <Text style={{ color: pantallaAdmin === "catalogo" ? "#fff" : colores.texto, fontWeight: "700" }}>Catálogo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPantallaAdmin("inventario")} style={[estilos.subTab, pantallaAdmin === "inventario" && estilos.subTabActivo]}>
                <Text style={{ color: pantallaAdmin === "inventario" ? "#fff" : colores.texto, fontWeight: "700" }}>Inventario</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPantallaAdmin("reportes")} style={[estilos.subTab, pantallaAdmin === "reportes" && estilos.subTabActivo]}>
                <Text style={{ color: pantallaAdmin === "reportes" ? "#fff" : colores.texto, fontWeight: "700" }}>Reportes</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPantallaAdmin("usuarios")} style={[estilos.subTab, pantallaAdmin === "usuarios" && estilos.subTabActivo]}>
                <Text style={{ color: pantallaAdmin === "usuarios" ? "#fff" : colores.texto, fontWeight: "700" }}>Usuarios</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPantallaAdmin("sync")} style={[estilos.subTab, pantallaAdmin === "sync" && estilos.subTabActivo]}>
                <Text style={{ color: pantallaAdmin === "sync" ? "#fff" : colores.texto, fontWeight: "700" }}>Sincronización</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPantallaAdmin("pagos")} style={[estilos.subTab, pantallaAdmin === "pagos" && estilos.subTabActivo]}>
                <Text style={{ color: pantallaAdmin === "pagos" ? "#fff" : colores.texto, fontWeight: "700" }}>Pagos</Text>
              </TouchableOpacity>
            </ScrollView>
            <View style={{ flex: 1 }}>
              {pantallaAdmin === "catalogo" && <PosAdminCatalogoScreen onCerrar={() => setPantalla("venta")} />}
              {pantallaAdmin === "reportes" && <PosAdminReportesScreen onCerrar={() => setPantalla("venta")} />}
              {pantallaAdmin === "usuarios" && <PosAdminUsuariosScreen onCerrar={() => setPantalla("venta")} />}
              {pantallaAdmin === "pagos" && <PosAdminPagosScreen onCerrar={() => setPantalla("venta")} />}
              {pantallaAdmin === "inventario" && <PosAdminInventarioScreen onCerrar={() => setPantalla("venta")} />}
              {pantallaAdmin === "sync" && <PosAdminSincronizacionScreen onCerrar={() => setPantalla("venta")} />}
            </View>
          </View>
        )}
      </View>

      {/* Cambiar de sucursal o renombrarla exige PIN de gerente: un cajero no debe poder
          reapuntar la terminal a otra sucursal, porque a partir de ahí TODAS sus ventas irían al
          sitio equivocado. Queda registrado en el ERP al aplicarse. */}
      {autorizando && usuario && (
        <ModalAutorizacion
          titulo={autorizando === "cambiar" ? "Cambiar de sucursal" : "Cambiar nombre de la sucursal"}
          descripcion={
            autorizando === "cambiar"
              ? "Reapuntar esta terminal a otra sucursal cambia a dónde van todas sus ventas. Hace falta el PIN de un supervisor o administrador."
              : "El nombre se cambia en el ERP y lo ven todas las terminales. Hace falta el PIN de un supervisor o administrador."
          }
          solicitanteId={usuario.id}
          onCancelar={() => setAutorizando(null)}
          onAutorizado={() => {
            const accion = autorizando;
            setAutorizando(null);
            if (accion === "cambiar") setMostrarConexion(true);
            else setRenombrando(true);
          }}
        />
      )}

      {renombrando && sucursalActiva && (
        <ModalRenombrarSucursal
          nombreActual={sucursalActiva}
          onCerrar={() => setRenombrando(false)}
          onRenombrada={(nuevo) => { setSucursalActiva(nuevo); setRenombrando(false); }}
        />
      )}

      {pantalla !== "cobro" && (
        <View style={estilos.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity key={tab.id} onPress={() => setPantalla(tab.id)} style={[estilos.tabBoton, pantalla === tab.id && estilos.tabBotonActivo]}>
              <Text style={[estilos.tabTexto, pantalla === tab.id && estilos.tabTextoActivo]}>{tab.etiqueta}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, backgroundColor: colores.navy },
    headerTitulo: { color: colores.amber, fontWeight: "800", fontSize: 15 },
    headerSucursal: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
    indicadorSync: { color: "#fff", fontSize: 11 },
    botonHeader: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
    botonHeaderTexto: { fontSize: 15 },
    avisoFolio: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colores.green, padding: 10, paddingHorizontal: 16 },
    avisoFolioTexto: { color: "#fff", fontWeight: "700", fontSize: 13 },
    avisoFolioCerrar: { color: "#fff", fontSize: 16 },
    avisoTurno: { backgroundColor: colores.red + "18", borderBottomWidth: 2, borderBottomColor: colores.red, padding: 12, paddingHorizontal: 16 },
    avisoTurnoTitulo: { color: colores.red, fontWeight: "800", fontSize: 15 },
    avisoTurnoTexto: { color: colores.texto, fontSize: 13, marginTop: 2 },
    avisoTurnoBoton: { backgroundColor: colores.red, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    avisoTurnoBotonSecundario: { borderWidth: 1, borderColor: colores.red, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    subTabs: { flexGrow: 0, paddingVertical: 12, backgroundColor: colores.superficie, borderBottomWidth: 1, borderBottomColor: colores.borde },
    subTab: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colores.gray50 },
    subTabActivo: { backgroundColor: colores.navy },
    tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colores.borde, backgroundColor: colores.superficie },
    tabBoton: { flex: 1, paddingVertical: 12, alignItems: "center", minHeight: 56, justifyContent: "center" },
    tabBotonActivo: { borderTopWidth: 3, borderTopColor: colores.navy },
    tabTexto: { color: colores.textoSecundario, fontWeight: "600", fontSize: 14 },
    tabTextoActivo: { color: colores.navyTexto },
  });
}
