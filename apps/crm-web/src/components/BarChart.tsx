/**
 * Gráfica de barras minimalista, sin dependencias externas.
 *
 * Estaba hecha en SVG con `viewBox="0 0 100 alto"` y `preserveAspectRatio="none"`. Eso escala
 * el ancho hasta el de la tarjeta (~800 px) mientras el alto se queda en sus unidades: el texto
 * salía estirado ~8× en horizontal y aplastado en vertical, que es por lo que los nombres de
 * producto se veían como letras sueltas e ilegibles. Con HTML normal el texto lo dibuja el
 * navegador a su tamaño real y el problema desaparece de raíz.
 *
 * Otros dos fallos que arrastraba:
 *  - Solo pintaba una etiqueta de cada tres (`i % 3 === 0`). Razonable para las 24 horas del
 *    día, absurdo en "Top productos", donde cada barra es un producto distinto: se veían 3 de 8.
 *  - Las barras usaban `--h421-navy`, que NO se redefine en modo oscuro (solo `--h421-navy-texto`
 *    lo hace). Eran navy oscuro sobre fondo oscuro: casi invisibles. Ahora usan la variante que
 *    sí adapta.
 */
export function BarChart({
  data,
  alto = 160,
  formatoValor = (v: number) => String(v),
}: {
  data: { etiqueta: string; valor: number }[];
  alto?: number;
  /** Cómo escribir el valor encima de la barra y en el tooltip (importes, unidades…). */
  formatoValor?: (valor: number) => string;
}) {
  if (data.length === 0) {
    return (
      <div style={{ height: alto, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--h421-gray-400)", fontSize: 13 }}>
        Sin datos en este periodo.
      </div>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.valor));
  // Con muchas barras (las 24 horas) no caben todas las etiquetas ni los valores: se alternan.
  // Con pocas (productos, métodos de pago) se muestran todas, que es lo que hace falta.
  const densa = data.length > 12;
  const alturaEtiquetas = 20;

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: densa ? 2 : 8, height: alto }}>
      {data.map((d, i) => {
        const porcentaje = (d.valor / max) * 100;
        const mostrarEtiqueta = !densa || i % 3 === 0;
        return (
          <div
            key={i}
            title={`${d.etiqueta}: ${formatoValor(d.valor)}`}
            style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}
          >
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", minHeight: 0 }}>
              {!densa && d.valor > 0 && (
                <span style={{ fontSize: 11, textAlign: "center", color: "var(--h421-gray-400)", marginBottom: 3 }}>
                  {formatoValor(d.valor)}
                </span>
              )}
              <div
                style={{
                  height: `${porcentaje}%`,
                  // Una barra con valor pero muy pequeña frente al máximo se quedaba en 0 px y
                  // parecía "sin ventas". 3 px la mantienen visible.
                  minHeight: d.valor > 0 ? 3 : 0,
                  background: d.valor > 0 ? "var(--h421-navy-texto)" : "var(--h421-gray-200)",
                  borderRadius: "4px 4px 0 0",
                }}
              />
            </div>

            <div style={{ height: alturaEtiquetas, display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 4 }}>
              {mostrarEtiqueta && (
                // El nombre completo queda en el `title` del contenedor: se recorta en pantalla,
                // pero nunca se pierde.
                <span
                  style={{
                    fontSize: 11, color: "var(--h421-gray-400)", width: "100%", textAlign: "center",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {d.etiqueta}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
