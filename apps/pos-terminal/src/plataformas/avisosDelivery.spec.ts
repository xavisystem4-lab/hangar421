import { esperaTrasFallos, idsParaRecordar, minutosEsperando, pedidosNuevos, textoAviso, INTERVALO_NORMAL_MS } from "./avisosDelivery";

describe("avisosDelivery", () => {
  it("backoff: intervalo normal sin fallos, se duplica y se topa en 5 minutos", () => {
    expect(esperaTrasFallos(0)).toBe(INTERVALO_NORMAL_MS);
    expect(esperaTrasFallos(1)).toBe(30_000);
    expect(esperaTrasFallos(2)).toBe(60_000);
    expect(esperaTrasFallos(3)).toBe(120_000);
    expect(esperaTrasFallos(4)).toBe(240_000);
    expect(esperaTrasFallos(5)).toBe(300_000);
    expect(esperaTrasFallos(50)).toBe(300_000);
  });

  it("solo avisa los pedidos que la terminal no había visto (también tras reiniciar)", () => {
    const pendientes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(pedidosNuevos(pendientes, ["a", "c"]).map((p) => p.id)).toEqual(["b"]);
    expect(pedidosNuevos(pendientes, [])).toHaveLength(3);
  });

  it("recuerda solo los pendientes actuales, con tope", () => {
    expect(idsParaRecordar([{ id: "x" }, { id: "y" }])).toEqual(["x", "y"]);
    expect(idsParaRecordar(Array.from({ length: 300 }, (_, i) => ({ id: String(i) })))).toHaveLength(200);
  });

  it("texto del aviso con uno o varios pedidos", () => {
    expect(textoAviso([{ nombreVisible: "Uber Eats", folioCorto: "A1B2", ordenExternaId: "x" }])).toBe("Nuevo pedido de Uber Eats #A1B2");
    expect(textoAviso([
      { nombreVisible: "Rappi", ordenExternaId: "1" },
      { nombreVisible: "DiDi Food", ordenExternaId: "2" },
      { nombreVisible: "Rappi", ordenExternaId: "3" },
    ])).toBe("3 pedidos nuevos (Rappi, DiDi Food)");
  });

  it("minutos esperando nunca es negativo", () => {
    const ahora = Date.parse("2026-10-06T12:10:00Z");
    expect(minutosEsperando("2026-10-06T12:00:30Z", ahora)).toBe(9);
    expect(minutosEsperando("2026-10-06T12:20:00Z", ahora)).toBe(0);
  });
});
