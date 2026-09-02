export function StatTile({ etiqueta, valor, acento }: { etiqueta: string; valor: string; acento?: string }) {
  return (
    <div className="card" style={{ minWidth: 160, borderTop: `4px solid ${acento ?? "var(--h421-navy)"}` }}>
      <div style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>{etiqueta}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: "var(--h421-navy)" }}>{valor}</div>
    </div>
  );
}
