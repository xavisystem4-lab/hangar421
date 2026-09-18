import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { construirTicketPayload, marcarTicketImpreso } from "../db/ticketsRepo";
import { imprimirTicket } from "../printing/imprimirTicket";
import type { TicketPayload } from "../printing/PrinterAdapter";

/** Respaldo cuando no hay impresora disponible (ver printing/imprimirTicket.ts) — el mismo
 *  contenido que iría al papel, mostrado en pantalla para que el cajero se lo enseñe al cliente
 *  o tome una captura. "Reintentar impresión" vuelve a intentar contra el adaptador real (Fase
 *  2f); mientras tanto siempre cae aquí mismo otra vez. */
export function ReciboEnPantallaScreen({ ventaId, onCerrar }: { ventaId: string; onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [ticket, setTicket] = useState<TicketPayload | null>(null);
  const [reintentando, setReintentando] = useState(false);

  useEffect(() => {
    abrirBaseDeDatos().then((db) => construirTicketPayload(db, ventaId)).then(setTicket);
  }, [ventaId]);

  async function reintentar() {
    setReintentando(true);
    try {
      const db = await abrirBaseDeDatos();
      await imprimirTicket(db, ventaId);
    } finally {
      setReintentando(false);
    }
  }

  async function marcarComoImpresoAMano() {
    const db = await abrirBaseDeDatos();
    await marcarTicketImpreso(db, ventaId);
    onCerrar();
  }

  if (!ticket) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colores.navy, alignItems: "center", justifyContent: "center", padding: 16 }}>
      <ScrollView style={estilos.papel} contentContainerStyle={{ padding: 16 }}>
        {ticket.razonSocial && <Text style={estilos.encabezadoTicket}>{ticket.razonSocial}</Text>}
        {ticket.rfc && <Text style={estilos.rfc}>{ticket.rfc}</Text>}
        <Text style={estilos.folio}>Folio #{ticket.folio}</Text>
        <Text style={estilos.fecha}>{new Date(ticket.fecha).toLocaleString("es-MX")}</Text>
        <View style={estilos.linea} />
        {ticket.items.map((it, i) => (
          <View key={i} style={estilos.filaItem}>
            <Text style={estilos.textoItem}>{it.cantidad}× {it.nombre}</Text>
            <Text style={estilos.textoItem}>${it.precioTotal.toFixed(2)}</Text>
          </View>
        ))}
        <View style={estilos.linea} />
        <View style={estilos.filaItem}>
          <Text style={estilos.total}>Total</Text>
          <Text style={estilos.total}>${ticket.total.toFixed(2)}</Text>
        </View>
        <Text style={estilos.pie}>{ticket.pieTicket}</Text>
        <Text style={estilos.avisoSinImpresora}>Sin impresora configurada todavía — este es el respaldo en pantalla.</Text>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: 10, marginTop: 16, width: "100%", maxWidth: 340 }}>
        <TouchableOpacity onPress={reintentar} disabled={reintentando} style={[estilos.boton, { backgroundColor: colores.navyTexto }]}>
          <Text style={estilos.botonTexto}>{reintentando ? "Probando…" : "Reintentar impresión"}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={marcarComoImpresoAMano} style={{ marginTop: 10 }}>
        <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>Ya lo anoté a mano — quitar de pendientes</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCerrar} style={{ marginTop: 14 }}>
        <Text style={{ color: "#fff", fontWeight: "700" }}>Cerrar</Text>
      </TouchableOpacity>
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    papel: { backgroundColor: "#fff", borderRadius: 8, width: "100%", maxWidth: 320, maxHeight: "60%" },
    encabezadoTicket: { fontWeight: "800", fontSize: 15, textAlign: "center", color: "#111" },
    rfc: { fontSize: 11, textAlign: "center", color: "#555" },
    folio: { fontSize: 13, fontWeight: "700", textAlign: "center", marginTop: 8, color: "#111" },
    fecha: { fontSize: 11, textAlign: "center", color: "#555", marginBottom: 6 },
    linea: { borderTopWidth: 1, borderTopColor: "#ccc", borderStyle: "dashed", marginVertical: 8 },
    filaItem: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
    textoItem: { fontSize: 12, color: "#111" },
    total: { fontSize: 14, fontWeight: "800", color: "#111" },
    pie: { fontSize: 11, textAlign: "center", marginTop: 10, color: "#333" },
    avisoSinImpresora: { fontSize: 10, textAlign: "center", marginTop: 10, color: "#999" },
    boton: { flex: 1, padding: 14, borderRadius: 10, alignItems: "center" },
    botonTexto: { color: "#fff", fontWeight: "700" },
  });
}
