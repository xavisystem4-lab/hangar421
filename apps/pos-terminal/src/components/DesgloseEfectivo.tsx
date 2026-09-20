import { StyleSheet, Text, TextInput, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { totalConteo, type Conteo } from "../caja/denominaciones";

/** Conteo de una familia de denominaciones (billetes MXN, monedas MXN, billetes USD).
 *
 *  Equivale al GrupoDenominaciones del POS Windows, pero sin su navegación con flechas: aquí no
 *  hay teclado físico, se toca cada campo. El teclado numérico se abre solo. */
export function GrupoDenominaciones({
  titulo,
  denominaciones,
  conteo,
  onChange,
  prefijo = "$",
}: {
  titulo: string;
  denominaciones: number[];
  conteo: Conteo;
  onChange: (denominacion: number, cantidad: number) => void;
  prefijo?: string;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const total = totalConteo(conteo);

  return (
    <View style={estilos.grupo}>
      <View style={estilos.encabezadoGrupo}>
        <Text style={estilos.tituloGrupo}>{titulo}</Text>
        <Text style={estilos.totalGrupo}>{prefijo}{total.toFixed(2)}</Text>
      </View>

      {denominaciones.map((d) => {
        const piezas = conteo[d] ?? 0;
        return (
          <View key={d} style={estilos.fila}>
            <Text style={estilos.denominacion}>{prefijo}{d % 1 === 0 ? d : d.toFixed(2)}</Text>
            <TextInput
              value={piezas > 0 ? String(piezas) : ""}
              onChangeText={(v) => {
                // Solo dígitos: un conteo de piezas no admite decimales ni signo, y filtrarlo
                // aquí evita que un teclado con coma meta NaN en el total.
                const limpio = v.replace(/[^0-9]/g, "");
                onChange(d, limpio ? Number(limpio) : 0);
              }}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colores.textoSecundario}
              style={estilos.inputPiezas}
              accessibilityLabel={`Piezas de ${prefijo}${d}`}
            />
            <Text style={estilos.subtotal}>{piezas > 0 ? `${prefijo}${(d * piezas).toFixed(2)}` : "—"}</Text>
          </View>
        );
      })}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    grupo: { marginTop: 14, backgroundColor: colores.superficie, borderRadius: 12, borderWidth: 1, borderColor: colores.borde, padding: 12 },
    encabezadoGrupo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    tituloGrupo: { fontSize: 14, fontWeight: "800", color: colores.texto },
    totalGrupo: { fontSize: 14, fontWeight: "800", color: colores.navyTexto },
    fila: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
    denominacion: { width: 72, fontSize: 14, fontWeight: "600", color: colores.texto },
    // minHeight 44: se teclea con el dedo, contando efectivo con la otra mano.
    inputPiezas: {
      flex: 1, minHeight: 44, borderWidth: 1, borderColor: colores.borde, borderRadius: 8,
      paddingHorizontal: 12, fontSize: 16, textAlign: "center", color: colores.texto,
    },
    subtotal: { width: 90, textAlign: "right", fontSize: 13, color: colores.textoSecundario },
  });
}
