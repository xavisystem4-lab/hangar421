import { useState, type CSSProperties } from "react";
import type { Producto } from "@hangar421/shared";

interface SeleccionModificador {
  opcionModificadorId: string;
  nombreOpcion: string;
  precioExtra: number;
}

export function ModalModificadores({
  producto,
  onCancelar,
  onConfirmar,
}: {
  producto: Producto;
  onCancelar: () => void;
  onConfirmar: (cantidad: number, seleccion: SeleccionModificador[], notas: string) => void;
}) {
  const [cantidad, setCantidad] = useState(1);
  const [notas, setNotas] = useState("");
  const [seleccionUnica, setSeleccionUnica] = useState<Record<string, SeleccionModificador>>({});
  const [seleccionMultiple, setSeleccionMultiple] = useState<Record<string, SeleccionModificador>>({});

  const modificadores = producto.modificadores ?? [];
  const seleccion = [...Object.values(seleccionUnica), ...Object.values(seleccionMultiple)];
  const precioExtra = seleccion.reduce((s, o) => s + o.precioExtra, 0);
  const total = (producto.precioSucursal ?? producto.precioBase) * cantidad + precioExtra * cantidad;

  return (
    <div style={overlay}>
      <div style={{ ...modal, width: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{producto.nombre}</h2>
          <button onClick={onCancelar} style={{ background: "none", color: "var(--h421-gray-400)", fontSize: 20 }}>✕</button>
        </div>

        {modificadores.map((mod) => (
          <div key={mod.id} style={{ marginTop: 16 }}>
            <strong style={{ fontSize: 13 }}>{mod.nombre}{mod.obligatorio ? " *" : ""}</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {mod.opciones.map((op) => {
                const esMultiple = mod.tipo === "MULTIPLE";
                const activa = esMultiple ? !!seleccionMultiple[op.id] : seleccionUnica[mod.id]?.opcionModificadorId === op.id;
                return (
                  <button
                    key={op.id}
                    onClick={() => {
                      const valor = { opcionModificadorId: op.id, nombreOpcion: op.nombre, precioExtra: op.precioExtra };
                      if (esMultiple) {
                        setSeleccionMultiple((s) => {
                          const copia = { ...s };
                          if (copia[op.id]) delete copia[op.id];
                          else copia[op.id] = valor;
                          return copia;
                        });
                      } else {
                        setSeleccionUnica((s) => ({ ...s, [mod.id]: valor }));
                      }
                    }}
                    style={{
                      padding: "8px 12px", fontSize: 13, minHeight: 40,
                      background: activa ? "var(--h421-navy)" : "var(--h421-gray-50)",
                      color: activa ? "#fff" : "var(--h421-black)",
                      border: "1px solid var(--h421-gray-200)",
                    }}
                  >
                    {op.nombre}{op.precioExtra > 0 ? ` (+$${op.precioExtra})` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 16 }}>
          <strong style={{ fontSize: 13 }}>Nota</strong>
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. sin hielo, alergia a nuez…"
            style={{ width: "100%", padding: 10, marginTop: 6, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
          <button onClick={() => setCantidad((c) => Math.max(1, c - 1))} style={{ width: 40, height: 40, background: "var(--h421-gray-50)" }}>−</button>
          <span style={{ fontSize: 18, fontWeight: 700 }}>{cantidad}</span>
          <button onClick={() => setCantidad((c) => c + 1)} style={{ width: 40, height: 40, background: "var(--h421-gray-50)" }}>+</button>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onCancelar} style={{ flex: 1, padding: 14, background: "var(--h421-gray-200)" }}>Cancelar</button>
          <button
            onClick={() => onConfirmar(cantidad, seleccion, notas)}
            style={{ flex: 2, padding: 14, background: "var(--h421-green)", color: "#fff", fontSize: 16 }}
          >
            Agregar — ${total.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
};
const modal: CSSProperties = {
  background: "#fff", borderRadius: 16, padding: 24, maxHeight: "85vh", overflowY: "auto",
};
