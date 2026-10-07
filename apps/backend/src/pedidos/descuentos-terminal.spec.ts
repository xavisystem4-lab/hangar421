import { PedidosService } from "./pedidos.service";
import { CanalOrigen, TipoDescuento, TipoPedido } from "@hangar421/shared";

/** Descuentos del cajero en el APK (sin PIN): el ERP los RECALCULA con sus precios, con la misma
 *  función que la tablet, y los guarda como filas de `descuentos` (una por línea + una general). */
function crearServicio() {
  const creados: any[] = [];
  const tx = {
    pedido: { create: jest.fn((args: any) => { creados.push(args.data); return Promise.resolve({ ...args.data, items: [], mesa: null }); }) },
    mesa: { update: jest.fn() },
  };
  const prisma = {
    pedido: { findUnique: jest.fn(() => Promise.resolve(null)) },
    sucursal: { findUniqueOrThrow: jest.fn(() => Promise.resolve({ id: "suc-1", tasaImpuesto: 0 })) },
    usuario: { findUnique: jest.fn(() => Promise.resolve(null)) },
    turno: { findUnique: jest.fn(() => Promise.resolve(null)) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const service = new PedidosService(prisma as any, { emitirASucursal: jest.fn(), emitirAEmpresa: jest.fn() } as any, {} as any);
  (service as any).generarFolio = jest.fn(() => Promise.resolve("F-1"));
  // Latte $85 (+ avena $20 = $105 por pieza) y Pan $40.
  const precios: Record<string, { nombre: string; precio: number; extra: number }> = {
    latte: { nombre: "Latte", precio: 85, extra: 20 },
    pan: { nombre: "Pan", precio: 40, extra: 0 },
  };
  (service as any).resolverItem = jest.fn((it: any) => {
    const p = precios[it.productoId];
    return Promise.resolve({
      productoId: it.productoId, nombreProducto: p.nombre, cantidad: it.cantidad, precioUnitario: p.precio,
      modificadoresPrecio: p.extra, modificadoresSeleccionados: p.extra ? [{ id: "op-avena", precioExtra: p.extra }] : [],
    });
  });
  return { service, creados };
}

const DTO = {
  id: "venta-1",
  empresaId: "emp-1",
  sucursalId: "suc-1",
  tipo: TipoPedido.MOSTRADOR,
  canalOrigen: CanalOrigen.APP_POS_MOVIL,
  enviarInmediato: true,
};

describe("PedidosService.crear — descuentos de la terminal", () => {
  it("descuento general por porcentaje", async () => {
    const { service, creados } = crearServicio();
    await service.crear({
      ...DTO,
      items: [{ productoId: "latte", cantidad: 1 }, { productoId: "pan", cantidad: 1 }], // 105 + 40 = 145
      descuentoGeneral: { tipo: TipoDescuento.PORCENTAJE, valor: 10, motivo: "Descuento general 10%" },
    } as any);

    expect(creados[0].subtotal).toBe(145);
    expect(creados[0].descuentoTotal).toBe(14.5);
    expect(creados[0].total).toBe(130.5);
    expect(creados[0].descuentos.create).toEqual([
      { tipo: "PORCENTAJE", valor: 10, montoAplicado: 14.5, motivo: "Descuento general 10%" },
    ]);
  });

  it("descuento por producto: solo rebaja esa línea y queda una fila por línea", async () => {
    const { service, creados } = crearServicio();
    await service.crear({
      ...DTO,
      items: [
        { productoId: "latte", cantidad: 2, descuento: { tipo: TipoDescuento.MONTO, valor: 30, motivo: "Descuento $30.00: Latte" } }, // línea 210
        { productoId: "pan", cantidad: 1 },
      ],
    } as any);

    expect(creados[0].subtotal).toBe(250);
    expect(creados[0].descuentoTotal).toBe(30);
    expect(creados[0].total).toBe(220);
    expect(creados[0].descuentos.create).toEqual([
      { tipo: "MONTO", valor: 30, montoAplicado: 30, motivo: "Descuento $30.00: Latte" },
    ]);
  });

  it("combinados: el general se calcula DESPUÉS de los descuentos por producto", async () => {
    const { service, creados } = crearServicio();
    await service.crear({
      ...DTO,
      items: [{ productoId: "latte", cantidad: 1, descuento: { tipo: TipoDescuento.PORCENTAJE, valor: 50 } }, { productoId: "pan", cantidad: 1 }],
      descuentoGeneral: { tipo: TipoDescuento.PORCENTAJE, valor: 10 },
    } as any);

    // línea latte 105 − 52.5 = 52.5; queda 52.5 + 40 = 92.5; general 10% = 9.25
    expect(creados[0].descuentoTotal).toBe(61.75);
    expect(creados[0].total).toBe(83.25);
    expect(creados[0].descuentos.create).toHaveLength(2);
    expect(creados[0].descuentos.create[0]).toMatchObject({ motivo: "Descuento: Latte", montoAplicado: 52.5 });
    expect(creados[0].descuentos.create[1]).toMatchObject({ motivo: "Descuento general", montoAplicado: 9.25 });
  });

  it("un descuento nunca deja el total en negativo", async () => {
    const { service, creados } = crearServicio();
    await service.crear({ ...DTO, items: [{ productoId: "pan", cantidad: 1 }], descuentoGeneral: { tipo: TipoDescuento.MONTO, valor: 999 } } as any);
    expect(creados[0].total).toBe(0);
    expect(creados[0].descuentoTotal).toBe(40);
  });

  it("con cortesía los descuentos no se aplican (la cortesía ya regala la venta)", async () => {
    const { service, creados } = crearServicio();
    await service.crear({
      ...DTO,
      items: [{ productoId: "pan", cantidad: 1 }],
      cortesia: { totalACobrar: 0 },
      descuentoGeneral: { tipo: TipoDescuento.PORCENTAJE, valor: 10 },
    } as any);
    expect(creados[0].descuentos.create).toHaveLength(1);
    expect(creados[0].descuentos.create[0]).toMatchObject({ motivo: "Cortesía", montoAplicado: 40 });
  });

  it("sin descuentos el pedido queda igual que siempre", async () => {
    const { service, creados } = crearServicio();
    await service.crear({ ...DTO, items: [{ productoId: "pan", cantidad: 1 }] } as any);
    expect(creados[0].total).toBe(40);
    expect(creados[0].descuentos).toBeUndefined();
  });
});
