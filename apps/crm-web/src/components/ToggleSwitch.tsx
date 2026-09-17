/** Interruptor activar/desactivar — no existía un componente de este tipo en crm-web (el resto
 *  de la app usa un botón que llama a la API y recarga, ver usuarios/page.tsx). Se usa
 *  `role="switch"`/`aria-checked` (en vez de un checkbox visualmente disfrazado sin más) para que
 *  un lector de pantalla anuncie el estado igual que lo haría con un <input type="checkbox">
 *  nativo — mismos tokens de color (var(--h421-...)) que el resto de la UI. */
export function ToggleSwitch({
  activo,
  onCambiar,
  disabled,
  etiqueta,
}: {
  activo: boolean;
  onCambiar: () => void;
  disabled?: boolean;
  etiqueta?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      onClick={onCambiar}
      disabled={disabled}
      style={{
        position: "relative",
        width: 44,
        height: 24,
        minHeight: 0,
        borderRadius: 999,
        padding: 2,
        background: activo ? "var(--h421-green)" : "var(--h421-gray-200)",
        opacity: disabled ? 0.6 : 1,
        transition: "background 150ms ease-out",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: "block",
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          transform: activo ? "translateX(20px)" : "translateX(0)",
          transition: "transform 150ms ease-out",
        }}
      />
    </button>
  );
}
