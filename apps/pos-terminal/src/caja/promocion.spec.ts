import { fechaATexto, fechaDesdeTexto, validarPromocion, type BorradorPromocion } from "./promocion";

const base = (cambio: Partial<BorradorPromocion> = {}): BorradorPromocion => ({
  nombre: "Latte a $49", tipo: "PRECIO", valor: "49", productoIds: ["latte"], dias: [], horaInicio: "", horaFin: "", fechaInicio: "", fechaFin: "", soloEstaSucursal: false, ...cambio,
});

describe("validarPromocion", () => {
  it("promoción simple: siempre vigente, en todas las sucursales", () => {
    expect(validarPromocion(base(), "suc-1")).toEqual({
      ok: true,
      valor: { nombre: "Latte a $49", tipo: "PRECIO", valor: 49, productoIds: ["latte"], dias: [], horaInicio: null, horaFin: null, fechaInicio: null, fechaFin: null, sucursalId: null },
    });
  });

  it("convierte fechas DD/MM/AAAA, normaliza horas y ordena los días", () => {
    const r = validarPromocion(base({ dias: [5, 1, 3], horaInicio: "7:05", horaFin: "17:00", fechaInicio: "1/10/2026", fechaFin: "31/10/2026", soloEstaSucursal: true }), "suc-1");
    expect(r.ok && r.valor).toMatchObject({ dias: [1, 3, 5], horaInicio: "07:05", horaFin: "17:00", fechaInicio: "2026-10-01", fechaFin: "2026-10-31", sucursalId: "suc-1" });
  });

  it("los 7 días equivalen a todos los días", () => {
    const r = validarPromocion(base({ dias: [0, 1, 2, 3, 4, 5, 6] }), null);
    expect(r.ok && r.valor.dias).toEqual([]);
  });

  it("porcentaje acepta el signo % y la coma", () => {
    const r = validarPromocion(base({ tipo: "PORCENTAJE", valor: "12,5%" }), null);
    expect(r.ok && r.valor.valor).toBe(12.5);
  });

  it.each([
    ["sin nombre", { nombre: " " }, "nombre"],
    ["precio vacío", { valor: "" }, "precio especial"],
    ["precio cero", { valor: "0" }, "mayor que"],
    ["precio no numérico", { valor: "abc" }, "precio especial"],
    ["porcentaje de 0", { tipo: "PORCENTAJE" as const, valor: "0" }, "porcentaje"],
    ["porcentaje mayor a 100", { tipo: "PORCENTAJE" as const, valor: "101" }, "porcentaje"],
    ["sin productos", { productoIds: [] }, "al menos un producto"],
    ["hora inválida", { horaInicio: "25:00" }, "HH:MM"],
    ["hora de fin antes del inicio", { horaInicio: "17:00", horaFin: "14:00" }, "posterior"],
    ["fecha inexistente", { fechaInicio: "31/02/2026" }, "DD/MM/AAAA"],
    ["fecha mal escrita", { fechaFin: "2026-10-01" }, "DD/MM/AAAA"],
    ["fechas al revés", { fechaInicio: "02/10/2026", fechaFin: "01/10/2026" }, "posterior"],
  ])("rechaza %s", (_caso: string, cambio: Partial<BorradorPromocion>, texto: string) => {
    const r = validarPromocion(base(cambio), null);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(texto);
  });
});

describe("fechas", () => {
  it("ida y vuelta", () => {
    expect(fechaDesdeTexto("07/10/2026")).toBe("2026-10-07");
    expect(fechaATexto("2026-10-07")).toBe("07/10/2026");
    expect(fechaDesdeTexto("")).toBeNull();
    expect(fechaATexto(null)).toBe("");
  });
});
