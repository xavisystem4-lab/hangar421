/** Gráfica de barras minimalista en SVG puro (sin dependencias externas) — misma que usa
 *  apps/crm-web (ver skill dataviz para lineamientos de color/forma). */
export function BarChart({ data, alto = 160 }: { data: { etiqueta: string; valor: number }[]; alto?: number }) {
  const max = Math.max(1, ...data.map((d) => d.valor));
  const anchoBarra = 100 / data.length;

  return (
    <svg viewBox={`0 0 100 ${alto}`} preserveAspectRatio="none" style={{ width: "100%", height: alto }}>
      {data.map((d, i) => {
        const h = (d.valor / max) * (alto - 20);
        return (
          <g key={i}>
            <rect
              x={i * anchoBarra + anchoBarra * 0.15}
              y={alto - 20 - h}
              width={anchoBarra * 0.7}
              height={h}
              fill={d.valor > 0 ? "var(--h421-navy)" : "var(--h421-gray-200)"}
              rx={1}
            />
            {i % 3 === 0 && (
              <text x={i * anchoBarra + anchoBarra / 2} y={alto - 6} fontSize={4} textAnchor="middle" fill="#9ca3af">
                {d.etiqueta}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
