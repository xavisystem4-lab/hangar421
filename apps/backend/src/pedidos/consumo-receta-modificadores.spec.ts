import { PedidosService } from "./pedidos.service";

/**
 * Un Latte no puede llevar las cinco leches en su receta: cada venta descontaría las cinco del
 * inventario (fallo real reportado desde sucursal). La leche la aporta la OPCIÓN de modificador
 * que eligió el cliente, y la receta del producto solo lo fijo (café, vaso).
 *
 * Aquí se fija qué consume un renglón de venta: receta del producto + receta de cada opción
 * elegida, multiplicado por la cantidad del renglón.
 */
function crearServicio(
  recetaProducto: { insumoId: string; cantidad: number }[],
  recetasOpcion: { opcionModificadorId: string; insumoId: string; cantidad: number }[],
  recetasPreparacion: { preparacionId: string; insumoId: string; cantidad: number }[] = [],
) {
  const prisma = {
    recetaItem: { findMany: jest.fn(() => Promise.resolve(recetaProducto)) },
    recetaOpcion: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(recetasOpcion.filter((r) => where.opcionModificadorId.in.includes(r.opcionModificadorId))),
      ),
    },
    recetaPreparacion: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(recetasPreparacion.filter((r) => where.preparacionId.in.includes(r.preparacionId))),
      ),
    },
  };
  return { service: new PedidosService(prisma as any, {} as any, {} as any), prisma };
}

const CAFE = { insumoId: "cafe", cantidad: 20 };
const VASO = { insumoId: "vaso", cantidad: 1 };
const LECHE_AVENA = { opcionModificadorId: "op-avena", insumoId: "leche-avena", cantidad: 240 };
const LECHE_ENTERA = { opcionModificadorId: "op-entera", insumoId: "leche-entera", cantidad: 240 };
const SHOT = { opcionModificadorId: "op-shot", insumoId: "cafe", cantidad: 10 };

describe("consumo de un renglón de venta", () => {
  it("descuenta SOLO la leche elegida, no todas", async () => {
    const { service } = crearServicio([CAFE, VASO], [LECHE_AVENA, LECHE_ENTERA]);
    const consumo = await (service as any).consumoDeItem({
      productoId: "latte", cantidad: 1, modificadores: [{ opcionModificadorId: "op-avena" }],
    });
    // El consumo sale ordenado por insumo (contrato de consumoDeVenta en shared).
    expect(consumo).toEqual([
      { insumoId: "cafe", cantidad: 20 },
      { insumoId: "leche-avena", cantidad: 240 },
      { insumoId: "vaso", cantidad: 1 },
    ]);
    expect(consumo.find((c: any) => c.insumoId === "leche-entera")).toBeUndefined();
  });

  it("multiplica por la cantidad del renglón", async () => {
    const { service } = crearServicio([CAFE], [LECHE_AVENA]);
    const consumo = await (service as any).consumoDeItem({
      productoId: "latte", cantidad: 3, modificadores: [{ opcionModificadorId: "op-avena" }],
    });
    expect(consumo).toEqual([
      { insumoId: "cafe", cantidad: 60 },
      { insumoId: "leche-avena", cantidad: 720 },
    ]);
  });

  it("suma en el mismo insumo lo que aportan el producto y una opción (shot extra de café)", async () => {
    const { service } = crearServicio([CAFE], [SHOT]);
    const consumo = await (service as any).consumoDeItem({
      productoId: "latte", cantidad: 2, modificadores: [{ opcionModificadorId: "op-shot" }],
    });
    expect(consumo).toEqual([{ insumoId: "cafe", cantidad: 60 }]);
  });

  it("una opción elegida dos veces en el renglón consume dos veces", async () => {
    const { service } = crearServicio([], [SHOT]);
    const consumo = await (service as any).consumoDeItem({
      productoId: "latte", cantidad: 1, modificadores: [{ opcionModificadorId: "op-shot" }, { opcionModificadorId: "op-shot" }],
    });
    expect(consumo).toEqual([{ insumoId: "cafe", cantidad: 20 }]);
  });

  it("sin modificadores no consulta recetas de opción y descuenta solo la del producto", async () => {
    const { service, prisma } = crearServicio([CAFE], [LECHE_AVENA]);
    const consumo = await (service as any).consumoDeItem({ productoId: "americano", cantidad: 1, modificadores: [] });
    expect(consumo).toEqual([{ insumoId: "cafe", cantidad: 20 }]);
    expect(prisma.recetaOpcion.findMany).not.toHaveBeenCalled();
  });

  it("conserva fracciones de receta (4 decimales), no las redondea a 2", async () => {
    const { service } = crearServicio([{ insumoId: "canela", cantidad: 0.1255 }], []);
    const consumo = await (service as any).consumoDeItem({ productoId: "latte", cantidad: 1 });
    expect(consumo).toEqual([{ insumoId: "canela", cantidad: 0.1255 }]);
  });

  it("una opción que lleva una preparación de la casa (cold foam) descuenta sus ingredientes", async () => {
    const FOAM = { opcionModificadorId: "op-foam", insumoId: "cold-foam", cantidad: 1 };
    const { service } = crearServicio([CAFE], [FOAM], [
      { preparacionId: "cold-foam", insumoId: "crema", cantidad: 35 },
      { preparacionId: "cold-foam", insumoId: "agave", cantidad: 15 },
      { preparacionId: "cold-foam", insumoId: "matcha", cantidad: 2 },
    ]);
    const consumo = await (service as any).consumoDeItem({
      productoId: "cold-brew", cantidad: 2, modificadores: [{ opcionModificadorId: "op-foam" }],
    });
    expect(consumo).toEqual([
      { insumoId: "agave", cantidad: 30 },
      { insumoId: "cafe", cantidad: 40 },
      { insumoId: "crema", cantidad: 70 },
      { insumoId: "matcha", cantidad: 4 },
    ]);
  });
});
