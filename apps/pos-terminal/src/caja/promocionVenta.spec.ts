import type { Promocion } from "@hangar421/shared";
import { precioDeVenta } from "./promocionVenta";

const promo = (cambio: Partial<Promocion> = {}): Promocion => ({
  id: "pr-1", nombre: "Latte a $49", tipo: "PRECIO", valor: 49, productoIds: ["latte"], dias: [3], horaInicio: "14:00", horaFin: "17:00", activo: true, ...cambio,
});
const LATTE = { id: "latte", precioBase: 85 };
const MIE_1530 = new Date(2026, 9, 7, 15, 30); // miércoles

describe("precioDeVenta", () => {
  it("aplica la promoción vigente y guarda cuál fue y el precio de lista", () => {
    expect(precioDeVenta([promo()], LATTE, MIE_1530)).toEqual({ precioUnitario: 49, promocionId: "pr-1", nombrePromocion: "Latte a $49", precioLista: 85 });
  });

  it("fuera de horario o de día vuelve al precio de catálogo", () => {
    expect(precioDeVenta([promo()], LATTE, new Date(2026, 9, 7, 18, 0))).toEqual({ precioUnitario: 85 });
    expect(precioDeVenta([promo()], LATTE, new Date(2026, 9, 8, 15, 30))).toEqual({ precioUnitario: 85 });
  });

  it("otro producto o promoción apagada: precio de catálogo", () => {
    expect(precioDeVenta([promo()], { id: "pan", precioBase: 40 }, MIE_1530)).toEqual({ precioUnitario: 40 });
    expect(precioDeVenta([promo({ activo: false })], LATTE, MIE_1530)).toEqual({ precioUnitario: 85 });
  });

  it("respeta la sucursal de la promoción", () => {
    expect(precioDeVenta([promo({ sucursalId: "suc-2" })], LATTE, MIE_1530, "suc-1")).toEqual({ precioUnitario: 85 });
    expect(precioDeVenta([promo({ sucursalId: "suc-1" })], LATTE, MIE_1530, "suc-1").precioUnitario).toBe(49);
  });
});
