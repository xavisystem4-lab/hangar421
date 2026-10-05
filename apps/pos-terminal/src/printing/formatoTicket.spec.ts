import { propinaDeReferencia, etiquetaMetodoPago, formatearFechaTicket, ivaIncluido, prepararTicketParaImpresora } from "./formatoTicket";

describe("formatoTicket", () => {
  it("formatea la fecha como dd/mm/aaaa hh:mm en hora local", () => {
    const d = new Date(2026, 8, 30, 14, 5);
    expect(formatearFechaTicket(d.toISOString())).toBe("30/09/2026 14:05");
  });

  it("deja el texto tal cual si la fecha no es válida", () => {
    expect(formatearFechaTicket("no-es-fecha")).toBe("no-es-fecha");
  });

  it("calcula el IVA contenido en un precio final", () => {
    expect(ivaIncluido(116, 0.16)).toBe(16);
    expect(ivaIncluido(100, 0.16)).toBe(13.79);
    expect(ivaIncluido(100, 0)).toBe(0);
    expect(ivaIncluido(0, 0.16)).toBe(0);
  });

  it("traduce el método de pago y conserva los desconocidos", () => {
    expect(etiquetaMetodoPago("EFECTIVO")).toBe("Efectivo");
    expect(etiquetaMetodoPago("VALE")).toBe("VALE");
  });

  it("agrega fechaTexto y etiquetas de pago sin tocar los importes", () => {
    const t = prepararTicketParaImpresora({
      folio: 7,
      fecha: new Date(2026, 0, 2, 9, 3).toISOString(),
      items: [{ cantidad: 1, nombre: "Latte", precioTotal: 55 }],
      subtotal: 55,
      total: 55,
      pieTicket: "Gracias",
      pagos: [{ metodo: "TARJETA", monto: 55 }],
    });
    expect(t.fechaTexto).toBe("02/01/2026 09:03");
    expect(t.pagos).toEqual([{ metodo: "Tarjeta", monto: 55 }]);
    expect(t.total).toBe(55);
  });
});

describe("propinaDeReferencia", () => {
  it("lee la propina anotada en el pago", () => {
    expect(propinaDeReferencia("Propina $20.00")).toBe(20);
    expect(propinaDeReferencia("1234 · Propina $1,050.50")).toBe(1050.5);
  });
  it("devuelve 0 sin propina", () => {
    expect(propinaDeReferencia("DiDi Food #A1")).toBe(0);
    expect(propinaDeReferencia(null)).toBe(0);
  });
});
