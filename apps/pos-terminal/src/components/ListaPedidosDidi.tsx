import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import type { PedidoDidiLocal } from "../db/pedidosDidiRepo";

/** Minutos desde que se confirmó: lo que más importa cuando llega el repartidor. */
function hace(iso: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 1 ? "recién" : `hace ${min} min`;
}

/**
 * "DiDi en preparación": los pedidos confirmados que esperan al repartidor. Al llegar, "Cobrar"
 * deja la venta con sus productos ya cargados y lleva directo a cobrar.
 */
export function ListaPedidosDidi({ pedidos, onCobrar, onCancelar }: {
  pedidos: PedidoDidiLocal[];
  onCobrar: (p: PedidoDidiLocal) => void;
  onCancelar: (p: PedidoDidiLocal) => void;
}) {
  const colores = usarColores();
  const e = crearEstilos(colores);
  if (pedidos.length === 0) return null;
  return (
    <View style={e.barra}>
      <Text style={e.titulo}>🛵 DiDi en preparación ({pedidos.length})</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {pedidos.map((p) => (
          <View key={p.id} style={e.tarjeta}>
            <Text style={e.numero}>{p.numero ? `#${p.numero}` : "Sin número"}{p.cliente ? ` · ${p.cliente}` : ""}</Text>
            <Text style={e.detalle} numberOfLines={2}>
              {p.items.map((i) => `${i.cantidad} ${i.nombreProducto ?? "?"}`).join(", ")}
            </Text>
            <Text style={e.detalle}>{hace(p.createdAt)}</Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
              <TouchableOpacity onPress={() => onCobrar(p)} style={e.botonCobrar}><Text style={e.botonCobrarTexto}>Cobrar</Text></TouchableOpacity>
              <TouchableOpacity
                onPress={() => Alert.alert("Cancelar pedido", `¿Quitar el pedido ${p.numero ? `#${p.numero}` : ""} de la lista? No se cobra nada.`, [
                  { text: "No", style: "cancel" },
                  { text: "Sí, cancelar", style: "destructive", onPress: () => onCancelar(p) },
                ])}
                style={e.botonCancelar}
              >
                <Text style={e.botonCancelarTexto}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function crearEstilos(c: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    barra: { backgroundColor: "#FFF1E8", paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: "#FF6A13" },
    titulo: { fontWeight: "800", color: "#B54708", marginBottom: 6 },
    tarjeta: { width: 220, backgroundColor: "#fff", borderRadius: 10, padding: 10, borderLeftWidth: 4, borderLeftColor: "#FF6A13" },
    numero: { fontWeight: "800", fontSize: 15, color: "#111827" },
    detalle: { fontSize: 12, color: "#4B5563", marginTop: 2 },
    botonCobrar: { flex: 1, backgroundColor: c.green, borderRadius: 8, paddingVertical: 8, alignItems: "center" },
    botonCobrarTexto: { color: "#fff", fontWeight: "800" },
    botonCancelar: { paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "#D1D5DB", justifyContent: "center" },
    botonCancelarTexto: { color: "#6B7280", fontWeight: "800" },
  });
}
