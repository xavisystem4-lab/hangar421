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
import { PantallaArranque } from "./screens/PantallaArranque";
import { BarraSuperior } from "./components/BarraSuperior";
import { BarraActualizacion } from "./components/BarraActualizacion";
import "./theme.css";

type Pantalla = "venta" | "mesas" | "caja";

export default function App() {
  const auth = useAuthStore();
  const catalogo = useCatalogoStore();
  const [pantalla, setPantalla] = useState<Pantalla>("mesas");
  const [mesaActiva, setMesaActiva] = useState<{ id: string; nombre: string } | null>(null);
  const [sucursalNombre, setSucursalNombre] = useState("");
  const [backendListo, setBackendListo] = useState(false);
  const [mensajeArranque, setMensajeArranque] = useState("Iniciando…");

  // Primero se resuelve dónde vive el backend (embebido, cloud, o dev) — recién entonces
  // se configuran los clientes HTTP/WebSocket y se puede intentar cualquier login.
  useEffect(() => {
    const quitarListener = window.hangar.backend.onEstado(setMensajeArranque);
    window.hangar.backend
      .obtenerUrl()
      .then((url) => {
        if (url) {
          configurarApiUrl(url);
          configurarWsUrl(url);
        }
        setBackendListo(true);
      })
      .catch((e) => setMensajeArranque(`No se pudo iniciar el backend local: ${e.message}`));
    return quitarListener;
  }, []);

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

  if (!backendListo) return <PantallaArranque mensaje={mensajeArranque} />;
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
      </div>
      <BarraActualizacion />
    </div>
  );
}
