import { useEffect, useState } from "react";
import { WS_EVENTS } from "@hangar421/shared";
import { useAuthStore } from "./store/authStore";
import { useCatalogoStore } from "./store/catalogStore";
import { useOrderStore } from "./store/orderStore";
import { conectarSocket, configurarWsUrl } from "./api/socket";
import { iniciarMotorDeSincronizacion, detenerMotorDeSincronizacion, procesarColaSalida } from "./sync/syncEngine";
import { apiFetch, configurarApiUrl } from "./api/http";
import { Login } from "./screens/Login";
import { Mesas } from "./screens/Mesas";
import { POSHome } from "./screens/POSHome";
import { Caja } from "./screens/Caja";
import { Administracion } from "./screens/Administracion";
import { PantallaArranque } from "./screens/PantallaArranque";
import { BarraSuperior, type Pantalla } from "./components/BarraSuperior";
import { BarraActualizacion } from "./components/BarraActualizacion";
import "./theme.css";

export default function App() {
  const auth = useAuthStore();
  const catalogo = useCatalogoStore();
  const [pantalla, setPantalla] = useState<Pantalla>("mesas");
  const [mesaActiva, setMesaActiva] = useState<{ id: string; nombre: string } | null>(null);
  const [sucursalNombre, setSucursalNombre] = useState("");
  const [backendListo, setBackendListo] = useState(false);
  const [mensajeArranque, setMensajeArranque] = useState("Iniciando…");
  const [errorArranque, setErrorArranque] = useState<string | null>(null);
  const [intentoArranque, setIntentoArranque] = useState(0);

  // Primero se resuelve dónde vive el backend (embebido, cloud, o dev) — recién entonces
  // se configuran los clientes HTTP/WebSocket y se puede intentar cualquier login. Si falla
  // (antivirus bloqueando un binario, timeout, etc.) se muestra el error con un botón para
  // reintentar, en vez de quedarse la pantalla de carga congelada sin explicación.
  useEffect(() => {
    const quitarListener = window.hangar.backend.onEstado(setMensajeArranque);
    setErrorArranque(null);
    window.hangar.backend
      .obtenerUrl()
      .then((url) => {
        if (url) {
          // `url` es el origen pelado (http://127.0.0.1:<puerto>) — el backend expone la
          // API bajo /api/v1 (API_PREFIX) pero el WebSocket va sobre el origen sin prefijo
          // (path "/realtime" aparte, ver api/socket.ts), igual que VITE_API_URL/VITE_WS_URL.
          configurarApiUrl(`${url}/api/v1`);
          configurarWsUrl(url);
        }
        setBackendListo(true);
      })
      .catch((e) => setErrorArranque(e.message ?? "Error desconocido al iniciar el backend local"));
    return quitarListener;
  }, [intentoArranque]);

  useEffect(() => {
    if (backendListo) auth.inicializar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendListo]);

  useEffect(() => {
    if (!auth.usuario || !auth.sucursalId) return;
    catalogo.cargar(auth.usuario.empresaId, auth.sucursalId);
    iniciarMotorDeSincronizacion();
    apiFetch<{ nombre: string }>(`/sucursales/${auth.sucursalId}`).then((s) => setSucursalNombre(s.nombre)).catch(() => undefined);

    const socket = conectarSocket(auth.sucursalId);
    socket.on(WS_EVENTS.MESA_ACTUALIZADA, () => catalogo.refrescarMesas(auth.sucursalId!));
    socket.on(WS_EVENTS.PEDIDO_ITEM_ACTUALIZADO, () => { /* podría resaltar "pedido listo" en Mesas */ });

    return () => {
      detenerMotorDeSincronizacion();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.usuario, auth.sucursalId]);

  if (!backendListo) {
    return (
      <PantallaArranque
        mensaje={mensajeArranque}
        error={errorArranque}
        onReintentar={() => setIntentoArranque((n) => n + 1)}
      />
    );
  }
  if (auth.cargando) return null;
  if (!auth.usuario) {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <Login />
        </div>
        <BarraActualizacion />
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <BarraSuperior
        sucursalNombre={sucursalNombre || auth.sucursalId || ""}
        pantallaActual={pantalla}
        onCambiarPantalla={(p) => {
          if (p === "venta" && !mesaActiva) useOrderStore.getState().iniciar(null, 1);
          setPantalla(p);
        }}
      />
      <div style={{ flex: 1, overflow: "hidden" }}>
        {pantalla === "mesas" && (
          <Mesas
            sucursalId={auth.sucursalId!}
            onAbrirMesa={(id, nombre) => { setMesaActiva({ id, nombre }); setPantalla("venta"); }}
          />
        )}
        {pantalla === "venta" && (
          <POSHome
            mesaNombre={mesaActiva?.nombre ?? null}
            onVentaCobrada={() => {
              setMesaActiva(null);
              procesarColaSalida();
              setPantalla("mesas");
            }}
          />
        )}
        {pantalla === "caja" && <Caja sucursalId={auth.sucursalId!} />}
        {pantalla === "administracion" && <Administracion />}
      </div>
      <BarraActualizacion />
    </div>
  );
}
