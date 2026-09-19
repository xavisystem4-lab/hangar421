import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { MetodoPago } from "@hangar421/shared";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { listarMetodosPago, alternarMetodoPago, etiquetaMetodoPago, sembrarMetodosPagoPorDefecto, type MetodoPagoConfig } from "../db/metodosPagoRepo";

const ICONO: Record<MetodoPago, string> = {
  [MetodoPago.EFECTIVO]: "💵",
  [MetodoPago.TARJETA]: "💳",
  [MetodoPago.TRANSFERENCIA]: "🏦",
  [MetodoPago.QR]: "▦",
  [MetodoPago.OTRO]: "•",
};

const DESCRIPCION: Record<MetodoPago, string> = {
  [MetodoPago.EFECTIVO]: "Calcula el cambio con el teclado numérico.",
  [MetodoPago.TARJETA]: "El cliente paga en la terminal del banco y se registra aquí. Entra en el corte de caja y en los reportes como cualquier otro método.",
  [MetodoPago.TRANSFERENCIA]: "Para pagos por app bancaria o SPEI.",
  [MetodoPago.QR]: "Requiere un proveedor configurado.",
  [MetodoPago.OTRO]: "Vales, cortesías, cualquier caso que no encaje arriba.",
};

/** Métodos de pago habilitados — los mismos que ofrece la pantalla de cobro.
 *
 *  Existe porque antes solo se podían elegir en la configuración inicial: si el negocio decía
 *  que no a Tarjeta el primer día, no había forma de activarla después sin reinstalar. Es
 *  configuración local del dispositivo, no viene del ERP. */
export function PosAdminPagosScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [metodos, setMetodos] = useState<MetodoPagoConfig[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

  async function cargar() {
    const db = await abrirBaseDeDatos();
    await sembrarMetodosPagoPorDefecto(db);
    setMetodos(await listarMetodosPago(db));
  }

  useEffect(() => {
    cargar();
  }, []);

  async function alternar(metodo: MetodoPagoConfig, habilitado: boolean) {
    // Dejar el POS sin ningún método deja la pantalla de cobro inservible: no se podría cerrar
    // ninguna venta y no hay forma de darse cuenta hasta tener un cliente esperando en la barra.
    if (!habilitado && metodos.filter((m) => m.habilitado).length === 1) {
      setAviso("Tiene que quedar al menos un método de pago habilitado.");
      return;
    }
    setAviso(null);
    const db = await abrirBaseDeDatos();
    await alternarMetodoPago(db, metodo.id, habilitado);
    setMetodos(await listarMetodosPago(db));
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Métodos de pago</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>
      <Text style={estilos.ayuda}>Los que estén activos aparecen en la pantalla de cobro. Se guarda en este dispositivo.</Text>

      {aviso && <Text style={estilos.aviso}>{aviso}</Text>}

      {metodos.map((m) => (
        <View key={m.id} style={estilos.fila}>
          <Text style={estilos.icono}>{ICONO[m.tipo]}</Text>
          <View style={{ flex: 1 }}>
            <Text style={estilos.nombre}>{etiquetaMetodoPago[m.tipo]}</Text>
            <Text style={estilos.descripcion}>{DESCRIPCION[m.tipo]}</Text>
          </View>
          <Switch
            value={m.habilitado}
            onValueChange={(v) => alternar(m, v)}
            trackColor={{ true: colores.green, false: colores.gray50 }}
            accessibilityLabel={`${etiquetaMetodoPago[m.tipo]}, ${m.habilitado ? "habilitado" : "deshabilitado"}`}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 19, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 6, marginBottom: 14, lineHeight: 18 },
    aviso: { color: colores.red, fontSize: 13, marginBottom: 10 },
    fila: {
      flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginBottom: 10,
      backgroundColor: colores.superficie, borderRadius: 12, borderWidth: 1, borderColor: colores.borde,
    },
    icono: { fontSize: 20 },
    nombre: { fontSize: 15, fontWeight: "700", color: colores.texto },
    descripcion: { fontSize: 12, color: colores.textoSecundario, marginTop: 2, lineHeight: 16 },
  });
}
