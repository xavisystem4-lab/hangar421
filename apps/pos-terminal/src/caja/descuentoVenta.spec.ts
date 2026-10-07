import { TipoDescuento } from "@hangar421/shared";
import type { ItemCarrito } from "../store/carritoStore";
import { SIN_DESCUENTOS, etiquetaDescuento, hayDescuentos, totalesConDescuentos, validarDescuento } from "./descuentoVenta";

const item = (id: string, precio: number, cantidad: number, extra = 0): ItemCarrito => ({
  id,
  productoId: `p-${id}`,
  nombreProducto: `Producto ${id}`,
  cantidad,
  precioUnitario: precio,
  modificadores: extra > 0 ? [{ opcionModificadorId: "o1", nombreOpcion: "Extra", precioExtra: extra }] : [],
});

describe("totalesConDescuentos", () => {
  const items = [item("a", 50, 2, 10), item("b", 80, 1)]; // $120 + $80

  it("sin descuentos no cambia la cuenta", () => {
    expect(totalesConDescuentos(items, SIN_DESCUENTOS)).toMatchObject({ subtotal: 200, descuentoTotal: 0, total: 200 });
  });

  it("combina descuento por producto y general", () => {
    const r = totalesConDescuentos(items, {
      general: { tipo: TipoDescuento.PORCENTAJE, valor: 10 },
      porProducto: { a: { tipo: TipoDescuento.MONTO, valor: 20 } },
    });
    // línea a: 120 − 20 = 100; general: 10% de (200 − 20) = 18
    expect(r).toMatchObject({ descuentoProductos: 20, descuentoGeneral: 18, descuentoTotal: 38, total: 162 });
  });

  it("ignora el descuento de una línea que ya no está en el carrito", () => {
    const r = totalesConDescuentos([items[1]], { general: null, porProducto: { a: { tipo: TipoDescuento.MONTO, valor: 20 } } });
    expect(r.descuentoTotal).toBe(0);
  });
});

describe("validarDescuento", () => {
  it("acepta porcentajes y montos válidos", () => {
    expect(validarDescuento(TipoDescuento.PORCENTAJE, 15)).toBeNull();
    expect(validarDescuento(TipoDescuento.MONTO, 25.5)).toBeNull();
    expect(validarDescuento(TipoDescuento.PORCENTAJE, 100)).toBeNull();
  });

  it("rechaza cero, negativos, no numéricos y porcentajes mayores a 100", () => {
    expect(validarDescuento(TipoDescuento.MONTO, 0)).not.toBeNull();
    expect(validarDescuento(TipoDescuento.MONTO, -5)).not.toBeNull();
    expect(validarDescuento(TipoDescuento.MONTO, NaN)).not.toBeNull();
    expect(validarDescuento(TipoDescuento.PORCENTAJE, 101)).not.toBeNull();
  });
});

describe("etiquetas", () => {
  it("formatea porcentaje y monto", () => {
    expect(etiquetaDescuento({ tipo: TipoDescuento.PORCENTAJE, valor: 10 })).toBe("10%");
    expect(etiquetaDescuento({ tipo: TipoDescuento.MONTO, valor: 25 })).toBe("$25.00");
  });

  it("hayDescuentos detecta cualquiera de los dos tipos", () => {
    expect(hayDescuentos(SIN_DESCUENTOS)).toBe(false);
    expect(hayDescuentos({ general: { tipo: TipoDescuento.MONTO, valor: 5 }, porProducto: {} })).toBe(true);
    expect(hayDescuentos({ general: null, porProducto: { a: { tipo: TipoDescuento.MONTO, valor: 5 } } })).toBe(true);
  });
});
