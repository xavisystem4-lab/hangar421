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
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 380 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Nota — {nombreProducto}</h2>
          <button onClick={onCerrar} style={{ background: "none", fontSize: 20 }}>✕</button>
        </div>

        <textarea
          autoFocus
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Ej. sin hielo, alergia a nuez, extra caliente…"
          rows={3}
          style={{ width: "100%", padding: 10, marginTop: 14, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontFamily: "inherit", fontSize: 14, resize: "none" }}
        />

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 14, background: "var(--h421-gray-200)" }}>Cancelar</button>
          <button onClick={guardar} className="btn-grande" style={{ flex: 2, background: "var(--h421-navy)", color: "#fff" }}>
            Guardar nota
          </button>
        </div>
      </div>
    </div>
  );
}
