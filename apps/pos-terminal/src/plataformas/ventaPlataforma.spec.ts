import {
  buscarProductos,
  normalizarNombre,
  notasPedidoPlataforma,
  sugerirProducto,
  totalSegunCatalogo,
  validarMapeo,
  ventaDesdePedidoErp,
  type PedidoEntrante,
} from "./ventaPlataforma";

const PRODUCTOS = [
  { id: "p-latte", nombre: "Latte", precioBase: 55 },
  { id: "p-latte-vainilla", nombre: "Latte Vainilla", precioBase: 65 },
  { id: "p-croissant", nombre: "Croissant de mantequilla", precioBase: 45 },
  { id: "p-te", nombre: "Té", precioBase: 35 },
];

const PEDIDO: PedidoEntrante = {
  id: "orden-1",
  plataforma: "didi",
  nombreVisible: "DiDi Food",
  ordenExternaId: "A123",
  estado: "RECIBIDA",
  clienteNombre: "María López",
  totalExterno: "160.00",
  items: [
    { nombreExterno: "LATTE VAINILLA (grande)", cantidad: 2 },
    { nombreExterno: "Croissant", cantidad: 1 },
  ],
  motivoError: null,
  pedidoId: null,
  createdAt: "2026-09-30T18:00:00.000Z",
};

describe("ventaPlataforma", () => {
  it("normaliza acentos, mayúsculas y signos", () => {
    expect(normalizarNombre("  Café Latte (Grande)! ")).toBe("cafe latte grande");
  });

  it("sugiere el producto exacto o el nombre contenido más largo", () => {
    expect(sugerirProducto("latte", PRODUCTOS)?.id).toBe("p-latte");
    expect(sugerirProducto("LATTE VAINILLA (grande)", PRODUCTOS)?.id).toBe("p-latte-vainilla");
    expect(sugerirProducto("Croissant", PRODUCTOS)?.id).toBe("p-croissant");
    expect(sugerirProducto("Pizza", PRODUCTOS)).toBeNull();
  });

  it("no sugiere a partir de nombres demasiado cortos", () => {
    expect(sugerirProducto("Té verde matcha", PRODUCTOS)).toBeNull();
  });

  it("busca productos por todas las palabras", () => {
    expect(buscarProductos("latte vai", PRODUCTOS).map((p) => p.id)).toEqual(["p-latte-vainilla"]);
    expect(buscarProductos("", PRODUCTOS)).toEqual([]);
  });

  it("valida que cada item tenga producto y cantidad entera positiva", () => {
    expect(validarMapeo(PEDIDO, [{ productoId: "p-latte", cantidad: 2, notas: "" }, { productoId: "", cantidad: 0, notas: "" }])).toEqual([
      'Falta elegir el producto para "Croissant".',
      'Cantidad inválida para "Croissant".',
    ]);
    expect(validarMapeo(PEDIDO, [{ productoId: "p-latte", cantidad: 2, notas: "" }, { productoId: "p-croissant", cantidad: 1, notas: "" }])).toEqual([]);
  });

  it("calcula el total con los precios de la terminal", () => {
    expect(totalSegunCatalogo([{ productoId: "p-latte-vainilla", cantidad: 2, notas: "" }, { productoId: "p-croissant", cantidad: 1, notas: "" }], PRODUCTOS)).toBe(175);
  });

  it("arma la nota con plataforma, orden y cliente", () => {
    expect(notasPedidoPlataforma(PEDIDO)).toBe("Pedido de DiDi Food #A123 — Cliente: María López");
    expect(notasPedidoPlataforma({ ...PEDIDO, clienteNombre: null })).toBe("Pedido de DiDi Food #A123");
  });

  it("convierte el pedido del ERP en una venta con su mismo id, pagada por la plataforma", () => {
    const venta = ventaDesdePedidoErp(
      {
        id: "0192f0a1-0000-7000-8000-000000000001",
        subtotal: "175.00",
        descuentoTotal: "0",
        impuesto: "0",
        total: "175.00",
        items: [
          { id: "i1", productoId: "p-latte-vainilla", cantidad: 2, precioUnitario: "65.00", producto: { nombre: "Latte Vainilla" } },
          { id: "i2", productoId: "p-croissant", cantidad: 1, precioUnitario: "45.00", producto: null },
        ],
      },
      PEDIDO,
      { "p-croissant": "Croissant de mantequilla" },
    );

    expect(venta.opciones).toEqual({
      ventaId: "0192f0a1-0000-7000-8000-000000000001",
      canalOrigen: "PLATAFORMA_DELIVERY",
      tipo: "DOMICILIO",
      notas: "Pedido de DiDi Food #A123 — Cliente: María López",
    });
    expect(venta.totales).toEqual({ subtotal: 175, descuentoTotal: 0, impuesto: 0, total: 175 });
    expect(venta.pagos).toEqual([{ metodo: "OTRO", monto: 175, referencia: "DiDi Food #A123" }]);
    expect(venta.items.map((i) => [i.productoId, i.nombreProducto, i.cantidad, i.precioUnitario])).toEqual([
      ["p-latte-vainilla", "Latte Vainilla", 2, 65],
      ["p-croissant", "Croissant de mantequilla", 1, 45],
    ]);
  });
});
