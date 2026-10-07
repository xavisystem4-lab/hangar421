import { describirVigencia, mejorPromocion, minutosDeHora, precioConPromocion, promocionVigente, type Promocion } from "./promociones";

const promo = (cambio: Partial<Promocion> = {}): Promocion => ({
  id: "pr-1", nombre: "Latte a $49", tipo: "PRECIO", valor: 49, productoIds: ["latte"], dias: [], activo: true, ...cambio,
});
// Miércoles 7 oct 2026, 15:30 (hora local del equipo).
const MIE_1530 = new Date(2026, 9, 7, 15, 30);

describe("precioConPromocion", () => {
  it("precio directo reemplaza el de lista", () => expect(precioConPromocion({ tipo: "PRECIO", valor: 49 }, 80)).toBe(49));
  it("porcentaje descuenta y redondea a centavos", () => {
    expect(precioConPromocion({ tipo: "PORCENTAJE", valor: 20 }, 85)).toBe(68);
    expect(precioConPromocion({ tipo: "PORCENTAJE", valor: 33 }, 95)).toBe(63.65);
  });
  it("100% deja el producto en $0 y nunca negativo", () => expect(precioConPromocion({ tipo: "PORCENTAJE", valor: 100 }, 50)).toBe(0));
});

describe("promocionVigente", () => {
  it("sin restricciones aplica siempre; apagada nunca", () => {
    expect(promocionVigente(promo(), MIE_1530)).toBe(true);
    expect(promocionVigente(promo({ activo: false }), MIE_1530)).toBe(false);
  });

  it("días de la semana (0 = domingo)", () => {
    expect(promocionVigente(promo({ dias: [1, 2, 3] }), MIE_1530)).toBe(true); // miércoles = 3
    expect(promocionVigente(promo({ dias: [0, 6] }), MIE_1530)).toBe(false);
  });

  it("horario: incluye el inicio y excluye el fin", () => {
    const p = promo({ horaInicio: "14:00", horaFin: "15:30" });
    expect(promocionVigente(p, new Date(2026, 9, 7, 14, 0))).toBe(true);
    expect(promocionVigente(p, new Date(2026, 9, 7, 15, 29))).toBe(true);
    expect(promocionVigente(p, new Date(2026, 9, 7, 15, 30))).toBe(false);
    expect(promocionVigente(p, new Date(2026, 9, 7, 13, 59))).toBe(false);
  });

  it("solo hora de inicio o solo de fin", () => {
    expect(promocionVigente(promo({ horaInicio: "16:00" }), MIE_1530)).toBe(false);
    expect(promocionVigente(promo({ horaFin: "16:00" }), MIE_1530)).toBe(true);
  });

  it("fechas: ambos extremos incluidos", () => {
    const p = promo({ fechaInicio: "2026-10-07", fechaFin: "2026-10-07" });
    expect(promocionVigente(p, new Date(2026, 9, 7, 0, 0))).toBe(true);
    expect(promocionVigente(p, new Date(2026, 9, 7, 23, 59))).toBe(true);
    expect(promocionVigente(p, new Date(2026, 9, 8, 0, 0))).toBe(false);
    expect(promocionVigente(p, new Date(2026, 9, 6, 23, 59))).toBe(false);
  });

  it("sucursal: una promoción de otra sucursal no aplica; sin sucursal aplica en todas", () => {
    expect(promocionVigente(promo({ sucursalId: "suc-1" }), MIE_1530, "suc-2")).toBe(false);
    expect(promocionVigente(promo({ sucursalId: "suc-1" }), MIE_1530, "suc-1")).toBe(true);
    expect(promocionVigente(promo({ sucursalId: null }), MIE_1530, "suc-2")).toBe(true);
  });
});

describe("mejorPromocion", () => {
  it("elige la que deja el producto más barato, solo entre las vigentes del producto", () => {
    const lista = [
      promo({ id: "a", valor: 60 }),
      promo({ id: "b", tipo: "PORCENTAJE", valor: 50 }), // 80 → 40
      promo({ id: "c", valor: 10, productoIds: ["otro"] }),
      promo({ id: "d", valor: 5, activo: false }),
    ];
    const r = mejorPromocion(lista, "latte", 80, MIE_1530);
    expect(r?.promocion.id).toBe("b");
    expect(r?.precio).toBe(40);
  });

  it("una promoción que no baja el precio no cuenta", () => {
    expect(mejorPromocion([promo({ valor: 90 })], "latte", 80, MIE_1530)).toBeNull();
    expect(mejorPromocion([], "latte", 80, MIE_1530)).toBeNull();
  });
});

describe("utilidades", () => {
  it("minutosDeHora valida el formato", () => {
    expect(minutosDeHora("14:30")).toBe(870);
    expect(minutosDeHora("7:05")).toBe(425);
    expect(minutosDeHora("24:00")).toBeNull();
    expect(minutosDeHora("abc")).toBeNull();
    expect(minutosDeHora("")).toBeNull();
  });

  it("describirVigencia", () => {
    expect(describirVigencia({ dias: [], horaInicio: null, horaFin: null, fechaInicio: null, fechaFin: null })).toBe("Todos los días");
    expect(describirVigencia({ dias: [1, 2, 3, 4, 5], horaInicio: "14:00", horaFin: "17:00", fechaInicio: "2026-10-01", fechaFin: "2026-10-31" }))
      .toBe("Lun, Mar, Mié, Jue, Vie · 14:00–17:00 · del 01/10/2026 al 31/10/2026");
  });
});
