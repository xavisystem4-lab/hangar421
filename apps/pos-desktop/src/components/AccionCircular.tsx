/** Botón de acción circular con ícono + etiqueta debajo (estilo referencia).
 *  Los íconos nunca van solos: cada uno lleva su etiqueta de texto (accesibilidad). */
export function AccionCircular({
  icono,
  etiqueta,
  color,
  onClick,
  disabled,
}: {
  icono: string;
  etiqueta: string;
  color: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || !onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        background: "transparent", minHeight: "auto", padding: 0,
        opacity: disabled || !onClick ? 0.4 : 1,
      }}
    >
      <span style={{
        width: 48, height: 48, borderRadius: 24, background: color, color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
        boxShadow: `0 3px 8px ${color}66`,
      }}>
        {icono}
      </span>
      <span style={{ fontSize: 11, color: "var(--h421-black)", fontWeight: 600 }}>{etiqueta}</span>
    </button>
  );
}
