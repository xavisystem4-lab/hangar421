import { useState } from "react";
import { useOrderStore } from "../store/orderStore";

/** Nota/comentario de un producto ya agregado al carrito (ej. "sin hielo", "alergia a nuez",
 *  "extra caliente"). Antes solo se podía capturar al agregar el producto desde
 *  ModalModificadores — este modal permite agregarla o corregirla después, desde el propio
 *  ícono de notas en PanelPedido, sin tener que quitar el item y volver a agregarlo. */
export function ModalNota({
  itemId,
  nombreProducto,
  notaActual,
  onCerrar,
}: {
  itemId: string;
  nombreProducto: string;
  notaActual?: string;
  onCerrar: () => void;
}) {
  const { cambiarNotas } = useOrderStore();
  const [nota, setNota] = useState(notaActual ?? "");

  function guardar() {
    cambiarNotas(itemId, nota);
    onCerrar();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--h421-white)", borderRadius: 16, padding: 24, width: 380 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Nota — {nombreProducto}</h2>
          <button onClick={onCerrar} style={{ background: "none", fontSize: 20 }}>✕</button>
        </div>

        <textarea
          autoFocus
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          onKeyDown={(e) => {
            // Enter guarda (Shift+Enter deja escribir una segunda línea si hace falta) — Esc
            // cancela, igual que el botón "Cancelar". Así no hay que soltar el teclado para
            // tocar un botón en pantalla, como ya hacen ModalCobro/ModalDescuento.
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); guardar(); }
            else if (e.key === "Escape") { e.preventDefault(); onCerrar(); }
          }}
          placeholder="Ej. sin hielo, alergia a nuez, extra caliente…"
          rows={3}
          style={{ width: "100%", padding: 10, marginTop: 14, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontFamily: "inherit", fontSize: 14, resize: "none" }}
        />

        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--h421-gray-400)" }}>Enter guarda · Esc cancela</p>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 14, background: "var(--h421-gray-200)" }}>Cancelar</button>
          <button onClick={guardar} className="btn-grande" style={{ flex: 2, background: "var(--h421-navy)", color: "#fff" }}>
            Guardar nota
          </button>
        </div>
      </div>
    </div>
  );
}
