import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Mesa, Pedido } from "@hangar421/shared";
import { usePosOrderStore } from "../../store/posOrderStore";
import { useAuthStore } from "../../store/authStore";
import { usarColores } from "../../store/temaStore";
import { PosMesasScreen } from "./PosMesasScreen";
import { PosVentaScreen } from "./PosVentaScreen";
import { PosCobroScreen } from "./PosCobroScreen";
import { PosPorCobrarScreen } from "./PosPorCobrarScreen";
import { PosCajaScreen } from "./PosCajaScreen";
import { PosAdminHomeScreen } from "./admin/PosAdminHomeScreen";

type PantallaPos = "mesas" | "venta" | "cobro" | "porCobrar" | "caja" | "admin";

const ROLES_ADMINISTRACION = new Set(["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL"]);

const TABS: { id: PantallaPos; etiqueta: string }[] = [
  { id: "mesas", etiqueta: "Mesas" },
  { id: "venta", etiqueta: "Venta" },
  { id: "porCobrar", etiqueta: "Por cobrar" },
  { id: "caja", etiqueta: "Caja" },
];

/** Shell del modo "Punto de Venta" — mismo patrón de tabs por `useState` que el resto de la app
 *  (ver App.tsx / Administracion.tsx del POS Windows), sin librería de navegación. "Cobro" no es
 *  una pestaña: es una pantalla de paso a la que se llega desde Mesas/Venta/Por cobrar y siempre
 *  regresa a Venta (Cancelar) o a Mesas (pago confirmado). */
export function PosNavigator() {
  const { rol } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [pantalla, setPantalla] = useState<PantallaPos>("mesas");
  const [pantallaAlCancelar, setPantallaAlCancelar] = useState<PantallaPos>("mesas");
  const [nombreCuenta, setNombreCuenta] = useState<string | null>(null);
  const tabs = rol && ROLES_ADMINISTRACION.has(rol) ? [...TABS, { id: "admin" as PantallaPos, etiqueta: "Admin" }] : TABS;

  function abrirMesa(mesa: Mesa) {
    // `posOrderStore.iniciar` ya se llamó dentro de PosMesasScreen al tocar la mesa.
    setNombreCuenta(mesa.nombre);
    setPantalla("venta");
  }

  function abrirMostrador() {
    usePosOrderStore.getState().iniciar(null, 1);
    setNombreCuenta(null);
    setPantalla("venta");
  }

  function irACobrar() {
    setPantallaAlCancelar("venta");
    setPantalla("cobro");
  }

  function cobrarPedidoExistente(pedido: Pedido) {
    // `posOrderStore.cargarPedidoExistente` ya se llamó dentro de PosPorCobrarScreen.
    setNombreCuenta(pedido.mesa?.nombre ?? "Mostrador");
    setPantallaAlCancelar("porCobrar");
    setPantalla("cobro");
  }

  function cobroConfirmado() {
    setNombreCuenta(null);
    setPantalla("mesas");
  }

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <View style={{ flex: 1 }}>
        {pantalla === "mesas" && <PosMesasScreen onAbrirMesa={abrirMesa} onMostrador={abrirMostrador} />}
        {pantalla === "venta" && <PosVentaScreen nombreCuenta={nombreCuenta} onCobrar={irACobrar} />}
        {pantalla === "cobro" && (
          <PosCobroScreen nombreCuenta={nombreCuenta} onCerrar={() => setPantalla(pantallaAlCancelar)} onCobrado={cobroConfirmado} />
        )}
        {pantalla === "porCobrar" && <PosPorCobrarScreen onCobrarPedido={cobrarPedidoExistente} />}
        {pantalla === "caja" && <PosCajaScreen />}
        {pantalla === "admin" && <PosAdminHomeScreen />}
      </View>

      {pantalla !== "cobro" && (
        <View style={estilos.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity key={tab.id} onPress={() => setPantalla(tab.id)} style={[estilos.tabBoton, pantalla === tab.id && estilos.tabBotonActivo]}>
              <Text style={[estilos.tabTexto, pantalla === tab.id && estilos.tabTextoActivo]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                {tab.etiqueta}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colores.borde, backgroundColor: colores.superficie },
    tabBoton: { flex: 1, paddingHorizontal: 4, paddingVertical: 10, alignItems: "center", minHeight: 56, justifyContent: "center" },
    tabBotonActivo: { borderTopWidth: 3, borderTopColor: colores.navy },
    tabTexto: { color: colores.textoSecundario, fontWeight: "600", fontSize: 13 },
    tabTextoActivo: { color: colores.navyTexto },
  });
}
