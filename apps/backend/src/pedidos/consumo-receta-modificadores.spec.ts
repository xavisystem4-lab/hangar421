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
  extra: {
    leche?: Record<string, number | null>;
    opciones?: { id: string; nombre: string; grupo: string }[];
    gruposObligatorios?: { nombre: string; tipo: string; opciones: { id: string; orden: number }[] }[];
  } = {},
) {
  const prisma = {
    producto: {
      findUnique: jest.fn(() =>
        Promise.resolve({ lecheBase: null, lecheConColdFoam: null, lecheConShot: null, lecheConAmbos: null, ...(extra.leche ?? {}) }),
      ),
    },
    opcionModificador: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id?.in
            ? (extra.opciones ?? [])
                .filter((o) => where.id.in.includes(o.id))
                .map((o) => ({ id: o.id, nombre: o.nombre, modificador: { nombre: o.grupo } }))
            : // Búsqueda de la leche entera por omisión: opciones "entera" de grupos de leche, con receta.
              (extra.opciones ?? [])
                .filter((o) => /entera/i.test(o.nombre) && /leche/i.test(o.grupo))
                .map((o) => ({
                  nombre: o.nombre,
                  modificador: { nombre: o.grupo },
                  recetas: recetasOpcion.filter((r) => r.opcionModificadorId === o.id).map((r) => ({ insumoId: r.insumoId, cantidad: r.cantidad })),
                })),
        ),
      ),
    },
    productoModificador: {
      findMany: jest.fn(() => Promise.resolve((extra.gruposObligatorios ?? []).map((g) => ({ modificador: { ...g, obligatorio: true } })))),
    },
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

  it("bebida con leche vendida SIN elegir leche (pedido de DiDi) descuenta la leche entera por omisión", async () => {
    const { service } = crearServicio([VASO], [LECHE_AVENA, LECHE_ENTERA], [], {
      leche: { lecheBase: 190 },
      opciones: [
        { id: "op-entera", nombre: "Entera", grupo: "Tipo de leche" },
        { id: "op-avena", nombre: "Avena", grupo: "Tipo de leche" },
      ],
    });
    const consumo = await (service as any).consumoDeItem({ productoId: "spooky-latte", cantidad: 2 });
    expect(consumo).toEqual([
      { insumoId: "leche-entera", cantidad: 380 },
      { insumoId: "vaso", cantidad: 2 },
    ]);
  });

  it("pedido de DiDi sin temperatura descuenta el vaso y la tapa de la primera opción (Caliente)", async () => {
    const CALIENTE_VASO = { opcionModificadorId: "op-caliente", insumoId: "vaso-carton", cantidad: 1 };
    const CALIENTE_TAPA = { opcionModificadorId: "op-caliente", insumoId: "tapa-carton", cantidad: 1 };
    const FRIA_TAPA = { opcionModificadorId: "op-fria", insumoId: "tapa-plastico", cantidad: 1 };
    const { service } = crearServicio([CAFE], [CALIENTE_VASO, CALIENTE_TAPA, FRIA_TAPA], [], {
      gruposObligatorios: [{ nombre: "Temperatura", tipo: "SELECCION_UNICA", opciones: [{ id: "op-fria", orden: 2 }, { id: "op-caliente", orden: 1 }] }],
    });
    expect(await (service as any).consumoDeItem({ productoId: "psl-didi", cantidad: 1 })).toEqual([
      { insumoId: "cafe", cantidad: 20 },
      { insumoId: "tapa-carton", cantidad: 1 },
      { insumoId: "vaso-carton", cantidad: 1 },
    ]);
    // Si eligieron Fría, se usa esa.
    expect(await (service as any).consumoDeItem({ productoId: "psl", cantidad: 1, modificadores: [{ opcionModificadorId: "op-fria" }] })).toEqual([
      { insumoId: "cafe", cantidad: 20 },
      { insumoId: "tapa-plastico", cantidad: 1 },
    ]);
  });

  it("un producto sin leche por bebida no descuenta leche aunque no elijan opciones", async () => {
    const { service } = crearServicio([VASO], [LECHE_ENTERA], [], { opciones: [{ id: "op-entera", nombre: "Entera", grupo: "Tipo de leche" }] });
    expect(await (service as any).consumoDeItem({ productoId: "americano", cantidad: 1 })).toEqual([{ insumoId: "vaso", cantidad: 1 }]);
  });

  it("Iced Latte con cold foam y shot baja la leche de la hoja (150 g), no 240", async () => {
    const CF = { opcionModificadorId: "op-cf", insumoId: "crema", cantidad: 50 };
    const { service } = crearServicio([CAFE, VASO], [LECHE_ENTERA, SHOT, CF], [], {
      leche: { lecheBase: 240, lecheConColdFoam: 190, lecheConShot: 240, lecheConAmbos: 150 },
      opciones: [
        { id: "op-entera", nombre: "Entera", grupo: "Tipo de leche" },
        { id: "op-shot", nombre: "Shot extra", grupo: "Extras" },
        { id: "op-cf", nombre: "Vainilla", grupo: "Cold Foam" },
      ],
    });
    const consumo = await (service as any).consumoDeItem({
      productoId: "iced-latte",
      cantidad: 1,
      modificadores: [{ opcionModificadorId: "op-entera" }, { opcionModificadorId: "op-shot" }, { opcionModificadorId: "op-cf" }],
    });
    expect(consumo).toEqual([
      { insumoId: "cafe", cantidad: 30 },
      { insumoId: "crema", cantidad: 50 },
      { insumoId: "leche-entera", cantidad: 150 },
      { insumoId: "vaso", cantidad: 1 },
    ]);
  });
});
