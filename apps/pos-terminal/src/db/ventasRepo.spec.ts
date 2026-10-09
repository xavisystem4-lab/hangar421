import { TipoDescuento } from "@hangar421/shared";
import type { ItemCarrito } from "../store/carritoStore";

// Base falsa que registra el SQL (mismo enfoque que dispositivoLocal.spec.ts): sin expo-sqlite.
// Se fija lo que de verdad importa de una venta con descuentos o con crédito de empleado: lo que
// se guarda local, lo que viaja al ERP y que el saldo del monedero baje (o vuelva) en el acto.
const encolados: any[] = [];
jest.mock("./outboxRepo", () => ({ encolarSync: jest.fn(async (_db: any, evento: any) => { encolados.push(evento); }) }));
jest.mock("./dispositivoLocal", () => ({
  obtenerOCrearDispositivoId: async () => "disp-1",
  obtenerOCrearSucursalIdLocal: async () => "suc-1",
  obtenerOCrearEmpresaIdLocal: async () => "emp-1",
}));

import { cambiarMetodoPago, cancelarVenta, confirmarVenta } from "./ventasRepo";

interface Ejecutado {
  sql: string;
  params: any[];
}

function baseFalsa() {
  const ejecutado: Ejecutado[] = [];
  const db: any = {
    runAsync: async (sql: string, ...params: any[]) => { ejecutado.push({ sql: sql.replace(/\s+/g, " ").trim(), params }); },
    getFirstAsync: async (sql: string) => (sql.includes("MAX(folio_local)") ? { siguiente: 7 } : { id: "venta-x", estado: "COBRADA", folio_local: 7 }),
    withTransactionAsync: async (fn: () => Promise<void>) => { await fn(); },
  };
  const de = (prefijo: string) => ejecutado.filter((e) => e.sql.startsWith(prefijo));
  return { db, ejecutado, de };
}

const item = (id: string, nombre: string, precio: number, cantidad: number): ItemCarrito => ({
  id, productoId: `p-${id}`, nombreProducto: nombre, cantidad, precioUnitario: precio, modificadores: [],
});
const ITEMS = [item("a", "Latte", 100, 2), item("b", "Pan", 50, 1)]; // 200 + 50 = 250
const TOTALES = { subtotal: 250, descuentoTotal: 0, impuesto: 0, total: 250 };

beforeEach(() => { encolados.length = 0; });

describe("confirmarVenta — descuentos", () => {
  const descuentos = {
    general: { tipo: TipoDescuento.PORCENTAJE, valor: 10 },
    porProducto: { a: { tipo: TipoDescuento.MONTO, valor: 40 } },
  };

  it("guarda la venta con los totales YA descontados, aunque el llamador mande los de antes", async () => {
    const { db, de } = baseFalsa();
    // línea a: 200 − 40 = 160; general 10% de (250 − 40) = 21 → descuento 61, total 189.
    const venta = await confirmarVenta(db, { items: ITEMS, pagos: [{ metodo: "EFECTIVO", monto: 189 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" }, { descuentos });

    expect(venta.total).toBe(189);
    const insertVenta = de("INSERT INTO ventas")[0];
    expect(insertVenta.params.slice(3, 7)).toEqual([250, 61, 0, 189]); // subtotal, descuento, impuestos, total
  });

  it("guarda una fila de descuento por línea y una general, y el descuento de cada línea", async () => {
    const { db, de } = baseFalsa();
    await confirmarVenta(db, { items: ITEMS, pagos: [{ metodo: "EFECTIVO", monto: 189 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" }, { descuentos });

    const filas = de("INSERT INTO descuentos");
    expect(filas).toHaveLength(2);
    expect(filas[0].params.slice(2, 5)).toEqual(["MONTO", 40, "Descuento $40.00: Latte"]);
    expect(filas[1].params.slice(2, 5)).toEqual(["PORCENTAJE", 10, "Descuento general 10%"]);
    expect(de("INSERT INTO venta_items").map((e) => e.params[6])).toEqual([40, 0]); // descuento_item
  });

  it("manda al ERP el descuento de cada producto y el general para que los recalcule", async () => {
    const { db } = baseFalsa();
    await confirmarVenta(db, { items: ITEMS, pagos: [{ metodo: "EFECTIVO", monto: 189 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" }, { descuentos });

    const pedido = encolados.find((e) => e.entidad === "PEDIDO").payload;
    expect(pedido.items[0].descuento).toEqual({ tipo: "MONTO", valor: 40, motivo: "Descuento $40.00: Latte" });
    expect(pedido.items[1].descuento).toBeUndefined();
    expect(pedido.descuentoGeneral).toEqual({ tipo: "PORCENTAJE", valor: 10, motivo: "Descuento general 10%" });
    expect(pedido.cortesia).toBeUndefined();
  });

  it("exige pagar el total CON descuento (no el de antes)", async () => {
    const { db } = baseFalsa();
    await expect(
      confirmarVenta(db, { items: ITEMS, pagos: [{ metodo: "EFECTIVO", monto: 100 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" }, { descuentos }),
    ).rejects.toThrow(/faltan \$89\.00/);
  });

  it("un descuento del 100% deja la venta sin cobro", async () => {
    const { db } = baseFalsa();
    const venta = await confirmarVenta(db, { items: ITEMS, pagos: [], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" }, { descuentos: { general: { tipo: TipoDescuento.PORCENTAJE, valor: 100 }, porProducto: {} } });
    expect(venta.total).toBe(0);
  });

  it("descuento y cortesía no se combinan", async () => {
    const { db } = baseFalsa();
    await expect(
      confirmarVenta(db, { items: ITEMS, pagos: [], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" }, { descuentos, cortesia: { motivo: "x", autorizadoPorId: "g-1" } }),
    ).rejects.toThrow(/descuento y cortesía/);
  });

  it("sin descuentos todo queda como antes (sin filas de descuento ni campos nuevos)", async () => {
    const { db, de } = baseFalsa();
    await confirmarVenta(db, { items: ITEMS, pagos: [{ metodo: "EFECTIVO", monto: 250 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" });

    expect(de("INSERT INTO descuentos")).toHaveLength(0);
    const pedido = encolados.find((e) => e.entidad === "PEDIDO").payload;
    expect(pedido.descuentoGeneral).toBeUndefined();
    expect(pedido.items.every((i: any) => i.descuento === undefined)).toBe(true);
  });
});

describe("confirmarVenta — crédito de empleado", () => {
  const monedero = { metodo: "MONEDERO_EMPLEADO", monto: 150, referencia: "Crédito empleado: Diana", empleadoId: "u-diana" };

  it("pago mixto: carga lo que alcanza al monedero (en la misma transacción) y el resto en efectivo", async () => {
    const { db, de } = baseFalsa();
    const venta = await confirmarVenta(db, { items: ITEMS, pagos: [monedero, { metodo: "EFECTIVO", monto: 100 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" });

    const pagos = de("INSERT INTO pagos");
    expect(pagos).toHaveLength(2);
    expect(pagos[0].params[2]).toBe("MONEDERO_EMPLEADO");
    expect(pagos[0].params.at(-1)).toBe("u-diana"); // empleado_id
    expect(pagos[1].params.at(-1)).toBeNull();

    // El consumo se guarda con el id de la VENTA (el mismo con que el ERP lo registrará).
    const consumo = de("INSERT OR REPLACE INTO monedero_movimientos");
    expect(consumo).toHaveLength(1);
    expect(consumo[0].params.slice(0, 3)).toEqual([venta.id, "u-diana", 150]);
  });

  it("el pago que viaja al ERP lleva la empleada", async () => {
    const { db } = baseFalsa();
    await confirmarVenta(db, { items: ITEMS, pagos: [monedero, { metodo: "EFECTIVO", monto: 100 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" });

    const pago = encolados.find((e) => e.entidad === "PAGO").payload;
    expect(pago.pagos[0]).toMatchObject({ metodo: "MONEDERO_EMPLEADO", monto: 150, empleadoId: "u-diana" });
    expect(pago.pagos[1].empleadoId).toBeUndefined();
  });

  it("el monedero puede cubrir toda la cuenta", async () => {
    const { db, de } = baseFalsa();
    await confirmarVenta(db, { items: ITEMS, pagos: [{ ...monedero, monto: 250 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" });
    expect(de("INSERT OR REPLACE INTO monedero_movimientos")[0].params[2]).toBe(250);
  });

  it("combina descuento y crédito: el monedero paga lo ya descontado", async () => {
    const { db, de } = baseFalsa();
    const venta = await confirmarVenta(
      db,
      { items: ITEMS, pagos: [{ ...monedero, monto: 225 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" },
      { descuentos: { general: { tipo: TipoDescuento.PORCENTAJE, valor: 10 }, porProducto: {} } }, // 250 − 25 = 225
    );
    expect(venta.total).toBe(225);
    expect(de("INSERT OR REPLACE INTO monedero_movimientos")[0].params[2]).toBe(225);
  });

  it("rechaza un pago con crédito sin empleada", async () => {
    const { db } = baseFalsa();
    await expect(
      confirmarVenta(db, { items: ITEMS, pagos: [{ metodo: "MONEDERO_EMPLEADO", monto: 250 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" }),
    ).rejects.toThrow(/necesita la empleada/);
  });

  it("una venta sin crédito no toca el monedero", async () => {
    const { db, de } = baseFalsa();
    await confirmarVenta(db, { items: ITEMS, pagos: [{ metodo: "EFECTIVO", monto: 250 }], totales: TOTALES, turnoId: "t-1", usuarioId: "u-1" });
    expect(de("INSERT OR REPLACE INTO monedero_movimientos")).toHaveLength(0);
  });
});

describe("cancelarVenta — crédito de empleado", () => {
  it("al cancelar se borra el consumo de esa venta: el saldo vuelve a la empleada", async () => {
    const { db, de } = baseFalsa();
    await cancelarVenta(db, { ventaId: "venta-x", motivo: "error", solicitadaPorId: "u-1", autorizadaPorId: "g-1", autorizadaPorNombre: "Gerente" });
    expect(de("DELETE FROM monedero_movimientos")[0].params).toEqual(["venta-x"]);
  });
});

describe("confirmarVenta — promociones", () => {
  // Latte con promoción: ya viene a $49 (precio de lista $85); Pan sin promoción a $50.
  const conPromo: ItemCarrito[] = [
    { ...item("a", "Latte", 49, 2), promocionId: "pr-1", nombrePromocion: "Latte a $49", precioLista: 85 },
    item("b", "Pan", 50, 1),
  ];
  const totales = { subtotal: 148, descuentoTotal: 0, impuesto: 0, total: 148 };

  it("cobra al precio de la promoción y guarda cuál fue en cada línea", async () => {
    const { db, de } = baseFalsa();
    const venta = await confirmarVenta(db, { items: conPromo, pagos: [{ metodo: "EFECTIVO", monto: 148 }], totales, turnoId: "t-1", usuarioId: "u-1" });
    expect(venta.total).toBe(148);
    const filas = de("INSERT INTO venta_items");
    expect(filas.map((f) => [f.params[4], f.params[8]])).toEqual([[49, "pr-1"], [50, null]]); // precio_unit_snapshot, promocion_id
  });

  it("manda al ERP el promocionId solo de las líneas con promoción, para que recalcule el precio", async () => {
    const { db } = baseFalsa();
    await confirmarVenta(db, { items: conPromo, pagos: [{ metodo: "EFECTIVO", monto: 148 }], totales, turnoId: "t-1", usuarioId: "u-1" });
    const pedido = encolados.find((e) => e.entidad === "PEDIDO").payload;
    expect(pedido.items[0].promocionId).toBe("pr-1");
    expect(pedido.items[1]).not.toHaveProperty("promocionId");
  });
});

describe("cambiarMetodoPago", () => {
  function baseConPagos(pagosActuales: any[], estado = "COBRADA") {
    const { db, ejecutado, de } = baseFalsa();
    db.getFirstAsync = async () => ({ id: "venta-x", estado, total: 250, folio_local: 7 });
    db.getAllAsync = async () => pagosActuales;
    return { db, ejecutado, de };
  }
  const AUT = { solicitadaPorId: "cajero-1", autorizadaPorId: "sup-1", autorizadaPorNombre: "Sofía" };

  it("reemplaza los pagos locales y encola PAGO/UPDATE con CAMBIAR_METODO para el ERP", async () => {
    const { db, de } = baseConPagos([{ metodo: "EFECTIVO", monto: 250, monto_recibido: 300 }]);
    await cambiarMetodoPago(db, { ventaId: "venta-x", pagos: [{ metodo: "TARJETA", monto: 250, referencia: "1234" }], ...AUT, motivo: "Pagó con tarjeta" });

    expect(de("DELETE FROM pagos")).toHaveLength(1);
    const insertados = de("INSERT INTO pagos");
    expect(insertados).toHaveLength(1);
    expect(insertados[0].params.slice(1, 5)).toEqual(["venta-x", "TARJETA", 250, "1234"]);
    expect(de("UPDATE ventas SET updated_at")).toHaveLength(1);

    expect(encolados).toHaveLength(1);
    expect(encolados[0]).toMatchObject({ entidad: "PAGO", operacion: "UPDATE", entidadId: "venta-x", usuarioId: "cajero-1" });
    expect(encolados[0].payload).toMatchObject({
      accion: "CAMBIAR_METODO", pedidoId: "venta-x", cajeroId: "cajero-1", autorizadoPorId: "sup-1", autorizadoPorNombre: "Sofía", motivo: "Pagó con tarjeta",
      pagos: [{ metodo: "TARJETA", monto: 250, referencia: "1234" }],
    });
  });

  it("rechaza ventas no cobradas, pagos cortos y crédito de empleado (en los pagos viejos o en los nuevos)", async () => {
    const cancelada = baseConPagos([{ metodo: "EFECTIVO", monto: 250 }], "CANCELADA");
    await expect(cambiarMetodoPago(cancelada.db, { ventaId: "venta-x", pagos: [{ metodo: "TARJETA", monto: 250 }], ...AUT })).rejects.toThrow("cobrada");

    const corta = baseConPagos([{ metodo: "EFECTIVO", monto: 250 }]);
    await expect(cambiarMetodoPago(corta.db, { ventaId: "venta-x", pagos: [{ metodo: "TARJETA", monto: 200 }], ...AUT })).rejects.toThrow("no cubren");

    const desdeMonedero = baseConPagos([{ metodo: "MONEDERO_EMPLEADO", monto: 250, empleado_id: "e" }]);
    await expect(cambiarMetodoPago(desdeMonedero.db, { ventaId: "venta-x", pagos: [{ metodo: "EFECTIVO", monto: 250 }], ...AUT })).rejects.toThrow("crédito de empleado");

    const haciaMonedero = baseConPagos([{ metodo: "EFECTIVO", monto: 250 }]);
    await expect(cambiarMetodoPago(haciaMonedero.db, { ventaId: "venta-x", pagos: [{ metodo: "MONEDERO_EMPLEADO", monto: 250, empleadoId: "e" }], ...AUT })).rejects.toThrow("crédito de empleado");

    expect(corta.de("DELETE FROM pagos")).toHaveLength(0);
    expect(encolados).toHaveLength(0);
  });
});
