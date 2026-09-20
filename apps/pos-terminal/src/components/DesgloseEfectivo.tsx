import { createRef, useMemo, type RefObject } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { totalConteo, type Conteo } from "../caja/denominaciones";

/** Una columna de denominaciones (billetes o monedas). Campos deliberadamente estrechos: solo
 *  caben dos o tres dígitos, que es todo lo que se teclea al contar piezas, y así entran dos
 *  columnas lado a lado en el ancho de una tablet.
 *
 *  Al pulsar Enter el foco baja al campo siguiente de la MISMA columna, como capturar en Excel:
 *  se cuenta un fajo, se teclea, Enter, siguiente. `blurOnSubmit={false}` evita que el teclado
 *  se cierre entre campo y campo, que es lo que arruina el ritmo al contar.
 *
 *  `onUltimo` encadena la última fila de una columna con la primera de la siguiente, para poder
 *  recorrer todo el corte sin levantar el dedo del teclado. */
export function ColumnaDenominaciones({
  titulo,
  denominaciones,
  conteo,
  onChange,
  prefijo = "$",
  refs,
  onUltimo,
}: {
  titulo: string;
  denominaciones: number[];
  conteo: Conteo;
  onChange: (denominacion: number, cantidad: number) => void;
  prefijo?: string;
  refs: RefObject<TextInput>[];
  onUltimo?: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const total = totalConteo(conteo);

  return (
    <View style={estilos.columna}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>{titulo}</Text>
        <Text style={estilos.total}>{prefijo}{total.toFixed(2)}</Text>
      </View>

      {denominaciones.map((d, i) => {
        const piezas = conteo[d] ?? 0;
        return (
          <View key={d} style={estilos.fila}>
            <Text style={estilos.denominacion}>{prefijo}{d % 1 === 0 ? d : d.toFixed(2)}</Text>
            <TextInput
              ref={refs[i]}
              value={piezas > 0 ? String(piezas) : ""}
              onChangeText={(v) => {
                // Solo dígitos: contar piezas no admite decimales ni signo, y filtrarlo aquí
                // evita que un teclado con coma meta NaN en el total del corte.
                const limpio = v.replace(/[^0-9]/g, "").slice(0, 4);
                onChange(d, limpio ? Number(limpio) : 0);
              }}
              onSubmitEditing={() => {
                const siguiente = refs[i + 1];
                if (siguiente?.current) siguiente.current.focus();
                else onUltimo?.();
              }}
              keyboardType="number-pad"
              returnKeyType={i === denominaciones.length - 1 && !onUltimo ? "done" : "next"}
              blurOnSubmit={false}
              placeholder="0"
              placeholderTextColor={colores.textoSecundario}
              style={estilos.input}
              accessibilityLabel={`Piezas de ${prefijo}${d}`}
            />
            <Text style={estilos.subtotal} numberOfLines={1}>{piezas > 0 ? (d * piezas).toFixed(0) : ""}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Crea un juego estable de refs para una columna. Se memoriza porque `createRef` en cada
 *  render devolvería refs nuevas y el foco saltaría al vacío al escribir. */
export function usarRefsDenominaciones(cantidad: number): RefObject<TextInput>[] {
  return useMemo(() => Array.from({ length: cantidad }, () => createRef<TextInput>()), [cantidad]);
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    columna: { flex: 1, backgroundColor: colores.superficie, borderRadius: 10, borderWidth: 1, borderColor: colores.borde, padding: 8 },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 },
    titulo: { fontSize: 12, fontWeight: "800", color: colores.texto },
    total: { fontSize: 12, fontWeight: "800", color: colores.navyTexto },
    fila: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2 },
    denominacion: { width: 44, fontSize: 12, fontWeight: "600", color: colores.texto },
    // 46px de ancho: entran 3-4 dígitos y nada más. Es el campo "mucho más pequeño" que pidió
    // el usuario, y lo que permite poner billetes y monedas lado a lado.
    input: {
      width: 46, minHeight: 38, borderWidth: 1, borderColor: colores.borde, borderRadius: 6,
      paddingHorizontal: 2, paddingVertical: 4, fontSize: 15, textAlign: "center", color: colores.texto,
    },
    subtotal: { flex: 1, textAlign: "right", fontSize: 11, color: colores.textoSecundario },
  });
}
