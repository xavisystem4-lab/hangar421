import { apartar, etiquetaLibre, retomar, tiempoEsperando, type PedidoEnEspera } from "./enEspera";

const ahora = new Date("2026-11-03T18:00:00Z");
const carrito = (nombres: string[], nombreCliente: string | null = null) => ({ items: nombres, nombreCliente, pedidoDidiId: null });

describe("pedidos en espera", () => {
  it("aparta el carrito con el nombre del cliente", () => {
    const l = apartar<string>([], carrito(["Latte"], "Ana"), "a", ahora);
    expect(l).toEqual([{ id: "a", etiqueta: "Ana", nombreCliente: "Ana", items: ["Latte"], pedidoDidiId: null, desde: ahora.toISOString() }]);
  });

  it("sin nombre usa Espera N sin repetir", () => {
    let l: PedidoEnEspera<string>[] = apartar<string>([], carrito(["A"]), "1", ahora);
    l = apartar(l, carrito(["B"]), "2", ahora);
    expect(l.map((p) => p.etiqueta)).toEqual(["Espera 1", "Espera 2"]);
    expect(etiquetaLibre([{ etiqueta: "Espera 2" }])).toBe("Espera 1");
  });

  it("no aparta un carrito vacío", () => {
    expect(apartar<string>([], carrito([]), "x", ahora)).toEqual([]);
  });

  it("retomar con el carrito vacío solo saca el pedido", () => {
    const l = apartar<string>([], carrito(["Latte"], "Ana"), "a", ahora);
    const r = retomar(l, "a", carrito([]), "b", ahora);
    expect(r.retomado?.items).toEqual(["Latte"]);
    expect(r.lista).toEqual([]);
  });

  it("retomar con algo en el carrito lo deja en espera en su lugar", () => {
    const l = apartar<string>([], carrito(["Latte"], "Ana"), "a", ahora);
    const r = retomar(l, "a", carrito(["Moka"], "Luis"), "b", ahora);
    expect(r.retomado?.nombreCliente).toBe("Ana");
    expect(r.lista.map((p) => [p.id, p.etiqueta, p.items])).toEqual([["b", "Luis", ["Moka"]]]);
  });

  it("retomar un id inexistente no cambia nada", () => {
    const l = apartar<string>([], carrito(["Latte"]), "a", ahora);
    expect(retomar(l, "zz", carrito(["Moka"]), "b", ahora)).toEqual({ lista: l, retomado: null });
  });

  it("tiempo esperando", () => {
    expect(tiempoEsperando("2026-11-03T17:57:30Z", ahora)).toBe("2 min");
    expect(tiempoEsperando("2026-11-03T16:55:00Z", ahora)).toBe("1 h 05 min");
  });
});
