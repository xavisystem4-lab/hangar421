import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { EstadoMesa, type Mesa } from "@hangar421/shared";
import { apiFetch } from "../../api/http";
import * as outbox from "../../db/outbox";
import { useAuthStore } from "../../store/authStore";
import { usePosOrderStore } from "../../store/posOrderStore";
import { usarColores } from "../../store/temaStore";
import { columnasMesas, useDispositivo } from "../../hooks/useDispositivo";

const ETIQUETA: Record<EstadoMesa, string> = {
  [EstadoMesa.LIBRE]: "Libre",
  [EstadoMesa.OCUPADA]: "Ocupada",
  [EstadoMesa.RESERVADA]: "Reservada",
  [EstadoMesa.POR_COBRAR]: "Por cobrar",
  [EstadoMesa.PEDIDO_LISTO]: "Pedido listo",
};

/** Mesas de Punto de Venta — mismo grid que `MesasScreen.tsx` (Comandero), pero arranca el
 *  carrito en `posOrderStore` en vez de `orderStore`. Igual que en el POS Windows
 *  (`apps/pos-desktop/src/screens/Mesas.tsx`), tocar cualquier mesa siempre abre un pedido en
 *  blanco — un pedido ya enviado y pendiente de cobro se cobra desde la pestaña "Por cobrar", no
 *  desde aquí (así funciona hoy en el POS de escritorio, no es un atajo nuevo). */
export function PosMesasScreen({ onAbrirMesa, onMostrador }: { onAbrirMesa: (mesa: Mesa) => void; onMostrador: () => void }) {
  const { sucursalId } = useAuthStore();
  const colores = usarColores();
  const { ancho, esTablet } = useDispositivo();
  const columnas = columnasMesas(ancho);
  const estilos = crearEstilos(colores, esTablet);
  const COLOR: Record<EstadoMesa, string> = {
    [EstadoMesa.LIBRE]: colores.gray400,
    [EstadoMesa.OCUPADA]: colores.blue,
    [EstadoMesa.RESERVADA]: "#8B5CF6",
    [EstadoMesa.POR_COBRAR]: colores.yellow,
    [EstadoMesa.PEDIDO_LISTO]: colores.green,
  };
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(async () => {
    if (!sucursalId) return;
    try {
      const data = await apiFetch<Mesa[]>(`/mesas?sucursalId=${sucursalId}`);
      setMesas(data);
      await outbox.guardarEnCache("mesas", data);
    } catch {
      setMesas(await outbox.leerCache<Mesa>("mesas"));
    }
  }, [sucursalId]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 15_000);
    return () => clearInterval(t);
  }, [cargar]);

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <TouchableOpacity style={estilos.mostrador} onPress={onMostrador}>
        <Text style={estilos.mostradorTexto}>＋ Nuevo pedido de mostrador</Text>
      </TouchableOpacity>

      <FlatList
        key={`pos-mesas-${columnas}`}
        data={mesas}
        numColumns={columnas}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={async () => { setRefrescando(true); await cargar(); setRefrescando(false); }} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[estilos.mesa, { borderColor: COLOR[item.estado] }]}
            onPress={() => { usePosOrderStore.getState().iniciar(item.id, 2); onAbrirMesa(item); }}
          >
            <Text style={estilos.mesaNombre}>{item.nombre}</Text>
            <Text style={[estilos.mesaEstado, { color: COLOR[item.estado] }]}>{ETIQUETA[item.estado]}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>, esTablet: boolean) {
  const escala = esTablet ? 1.2 : 1;
  return StyleSheet.create({
    mostrador: { backgroundColor: colores.navy, margin: 12, borderRadius: 12, padding: 16, alignItems: "center" },
    mostradorTexto: { color: "#fff", fontWeight: "700", fontSize: 15 * escala },
    mesa: { flex: 1, margin: 6, minHeight: 90 * escala, borderWidth: 3, borderRadius: 12, backgroundColor: colores.superficie, alignItems: "center", justifyContent: "center" },
    mesaNombre: { fontSize: 16 * escala, fontWeight: "800", color: colores.texto },
    mesaEstado: { fontSize: 12 * escala, fontWeight: "700", marginTop: 4 },
  });
}
