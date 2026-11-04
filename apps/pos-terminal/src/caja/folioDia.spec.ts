import { inicioDelDiaLocal } from "./folioDia";

describe("inicioDelDiaLocal", () => {
  it("es la medianoche local del mismo día", () => {
    const ahora = new Date(2026, 10, 3, 18, 45, 12);
    expect(new Date(inicioDelDiaLocal(ahora))).toEqual(new Date(2026, 10, 3, 0, 0, 0, 0));
  });

  it("una venta de hoy queda después del inicio y una de ayer antes", () => {
    const inicio = inicioDelDiaLocal(new Date(2026, 10, 3, 9, 0));
    expect(new Date(2026, 10, 3, 0, 0, 1).toISOString() >= inicio).toBe(true);
    expect(new Date(2026, 10, 2, 23, 59, 59).toISOString() >= inicio).toBe(false);
  });

  it("no modifica la fecha recibida", () => {
    const ahora = new Date(2026, 10, 3, 18, 0);
    inicioDelDiaLocal(ahora);
    expect(ahora.getHours()).toBe(18);
  });
});
