import { calcularCompra, costoEnUnidadCaptura, rangoDePeriodo, resumirCompras, type CompraRegistro } from "./compras";

describe("calcularCompra", () => {
  it("20 litros a $20 de un insumo en ml: $400, 20,000 ml a $0.02/ml", () => {
    expect(calcularCompra({ cantidadCaptura: 20, factor: 1000, precioCaptura: 20 })).toEqual({
      cantidadBase: 20000, precioCaptura: 20, costoUnitarioBase: 0.02, total: 400,
    });
  });

  it("con el total del ticket calcula el precio unitario", () => {
    expect(calcularCompra({ cantidadCaptura: 3, factor: 1, total: 100 })).toEqual({
      cantidadBase: 3, precioCaptura: 33.3333, costoUnitarioBase: 33.333333, total: 100,
    });
  });

  it("el total manda sobre el precio si vienen los dos", () => {
    expect(calcularCompra({ cantidadCaptura: 2, factor: 1, precioCaptura: 10, total: 25 }).total).toBe(25);
  });

  it("rechaza cantidades, factores o precios inválidos", () => {
    expect(() => calcularCompra({ cantidadCaptura: 0, factor: 1, precioCaptura: 5 })).toThrow();
    expect(() => calcularCompra({ cantidadCaptura: 1, factor: 0, precioCaptura: 5 })).toThrow();
    expect(() => calcularCompra({ cantidadCaptura: 1, factor: 1 })).toThrow();
    expect(() => calcularCompra({ cantidadCaptura: 1, factor: 1, precioCaptura: -1 })).toThrow();
  });

  it("precio cero se acepta (regalo del proveedor)", () => {
    expect(calcularCompra({ cantidadCaptura: 1, factor: 1, precioCaptura: 0 }).total).toBe(0);
  });
});

const compra = (p: Partial<CompraRegistro>): CompraRegistro => ({
  id: Math.random().toString(), fechaCompra: "2026-10-01T10:00:00Z", insumoId: "leche", insumo: "Leche entera", categoria: "Leches",
  unidadBase: "ml", cantidadBase: 20000, costoUnitarioBase: 0.02, unidadCaptura: "litro", cantidadCaptura: 20, precioCaptura: 20, factor: 1000,
  total: 400, proveedor: "Lala", usuario: "Marisa", sucursal: "Mecánicos", estado: "VIGENTE", ...p,
});

describe("resumirCompras", () => {
  const compras = [
    compra({ fechaCompra: "2026-10-01T10:00:00Z" }),
    compra({ fechaCompra: "2026-10-15T10:00:00Z", cantidadBase: 10000, cantidadCaptura: 10, costoUnitarioBase: 0.022, precioCaptura: 22, total: 220 }),
    compra({ fechaCompra: "2026-11-02T10:00:00Z", insumoId: "cafe", insumo: "Café en grano", categoria: "Café", unidadBase: "g", unidadCaptura: "kg", factor: 1000,
      cantidadBase: 5000, cantidadCaptura: 5, costoUnitarioBase: 0.3, precioCaptura: 300, total: 1500, proveedor: "Tostador", usuario: "Tony" }),
    compra({ fechaCompra: "2026-10-20T10:00:00Z", total: 9999, estado: "ANULADA" }),
  ];
  const r = resumirCompras(compras);

  it("no cuenta las anuladas", () => {
    expect(r.compras).toBe(3);
    expect(r.total).toBe(2120);
  });

  it("por insumo: veces, cantidad, total, promedio ponderado, último y variación", () => {
    const leche = r.porInsumo.find((i) => i.insumoId === "leche")!;
    expect(leche).toMatchObject({ compras: 2, cantidadBase: 30000, total: 620, primerCostoBase: 0.02, ultimoCostoBase: 0.022, minimoBase: 0.02, maximoBase: 0.022, variacionPct: 10 });
    expect(leche.costoPromedioBase).toBeCloseTo(0.020667, 6);
    expect(costoEnUnidadCaptura(leche.costoPromedioBase, leche.factorCaptura)).toBe(20.67);
    expect(r.porInsumo[0].insumoId).toBe("cafe"); // mayor inversión primero
  });

  it("los que subieron de precio", () => {
    expect(r.subieron.map((i) => i.insumoId)).toEqual(["leche"]);
  });

  it("por categoría, proveedor, usuario y mes", () => {
    expect(r.porCategoria.map((g) => [g.clave, g.total])).toEqual([["Café", 1500], ["Leches", 620]]);
    expect(r.porProveedor[0]).toMatchObject({ clave: "Tostador", compras: 1 });
    expect(r.porUsuario.map((g) => g.clave)).toEqual(["Tony", "Marisa"]);
    expect(r.porMes).toEqual([{ mes: "2026-10", compras: 2, total: 620 }, { mes: "2026-11", compras: 1, total: 1500 }]);
  });
});

describe("rangoDePeriodo", () => {
  const hoy = new Date(2026, 10, 16); // 16 nov 2026
  it.each([
    ["hoy", "2026-11-16", "2026-11-16"],
    ["ayer", "2026-11-15", "2026-11-15"],
    ["7dias", "2026-11-10", "2026-11-16"],
    ["mes", "2026-11-01", "2026-11-30"],
    ["mesAnterior", "2026-10-01", "2026-10-31"],
    ["anio", "2026-01-01", "2026-12-31"],
  ] as const)("%s", (p, desde, hasta) => {
    expect(rangoDePeriodo(p, hoy)).toEqual({ desde, hasta });
  });
  it("mes anterior en enero cae en diciembre del año pasado", () => {
    expect(rangoDePeriodo("mesAnterior", new Date(2027, 0, 10))).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });
});
