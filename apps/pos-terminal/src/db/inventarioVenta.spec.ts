import { descontarConsumoLocal, recetasParaConsumo, lecheParaConsumo } from "./inventarioRepo";

/**
 * La tablet descuenta el almacén al cobrar para enseñar la existencia real en el momento, también
 * sin conexión. No encola nada al ERP: el servidor descuenta por su cuenta al recibir la venta, y
 * mandar además un movimiento desde aquí descontaría dos veces.
 */
function baseFalsa(filas: Record<string, any[]> = {}) {
  const ejecutados: { sql: string; params: any[] }[] = [];
  return {
    db: {
      getAllAsync: jest.fn(async (sql: string) =>
        sql.includes("FROM recetas_preparacion") ? filas.preparacion ?? []
          : sql.includes("FROM recetas_opcion") ? filas.opcion ?? [] : filas.producto ?? []),
      runAsync: jest.fn(async (sql: string, ...params: any[]) => { ejecutados.push({ sql, params }); }),
      withTransactionAsync: jest.fn(async (fn: any) => fn()),
    } as any,
    ejecutados,
  };
}

describe("recetasParaConsumo", () => {
  it("devuelve la receta del producto y la de las opciones elegidas", async () => {
    const { db } = baseFalsa({
      producto: [{ producto_id: "latte", insumo_id: "cafe", cantidad: 20 }],
      opcion: [{ opcion_modificador_id: "avena", insumo_id: "leche-avena", cantidad: 240 }],
    });
    await expect(recetasParaConsumo(db, ["latte"], ["avena"])).resolves.toEqual({
      porProducto: [{ productoId: "latte", insumoId: "cafe", cantidad: 20 }],
      porOpcion: [{ opcionModificadorId: "avena", insumoId: "leche-avena", cantidad: 240 }],
      porPreparacion: [],
    });
  });

  it("sin productos ni opciones no consulta nada", async () => {
    const { db } = baseFalsa();
    await expect(recetasParaConsumo(db, [], [])).resolves.toEqual({ porProducto: [], porOpcion: [], porPreparacion: [] });
    expect(db.getAllAsync).not.toHaveBeenCalled();
  });
});

describe("recetasParaConsumo con preparaciones", () => {
  it("trae también las recetas de las preparaciones de la casa (cold foam)", async () => {
    const { db } = baseFalsa({
      producto: [{ producto_id: "cold-brew", insumo_id: "cold-foam", cantidad: 1 }],
      preparacion: [{ preparacion_id: "cold-foam", insumo_id: "crema", cantidad: 35 }],
    });
    const r = await recetasParaConsumo(db, ["cold-brew"], []);
    expect(r.porPreparacion).toEqual([{ preparacionId: "cold-foam", insumoId: "crema", cantidad: 35 }]);
  });
});

describe("descontarConsumoLocal", () => {
  it("resta la cantidad consumida en la sucursal de la terminal", async () => {
    const { db, ejecutados } = baseFalsa();
    await descontarConsumoLocal(db, [{ insumoId: "leche-avena", cantidad: 240 }], "suc-1");
    expect(ejecutados).toHaveLength(1);
    expect(ejecutados[0].sql).toContain("existencia = existencia - ?");
    expect(ejecutados[0].params).toEqual(["suc-1", "leche-avena", -240, "leche-avena", 240]);
  });

  it("solo toca insumos que existen en la tablet (sin romper la llave foránea)", async () => {
    const { db, ejecutados } = baseFalsa();
    await descontarConsumoLocal(db, [{ insumoId: "jugo-limon", cantidad: 30 }], "suc-1");
    expect(ejecutados[0].sql).toContain("WHERE EXISTS (SELECT 1 FROM insumos WHERE id = ?)");
  });

  it("con la venta, recuerda el consumo hasta que el ERP la reciba", async () => {
    const { db, ejecutados } = baseFalsa();
    await descontarConsumoLocal(db, [{ insumoId: "cafe", cantidad: 20 }], "suc-1", "venta-1");
    expect(ejecutados).toHaveLength(2);
    expect(ejecutados[1].sql).toContain("INSERT INTO consumo_local_pendiente");
    expect(ejecutados[1].params.slice(0, 4)).toEqual(["venta-1", "suc-1", "cafe", 20]);
  });

  it("ignora cantidades en cero o negativas", async () => {
    const { db, ejecutados } = baseFalsa();
    await descontarConsumoLocal(db, [{ insumoId: "a", cantidad: 0 }, { insumoId: "b", cantidad: -5 }], "suc-1");
    expect(ejecutados).toHaveLength(0);
  });
});

describe("lecheParaConsumo", () => {
  it("trae los gramos del producto y el grupo de cada opción elegida", async () => {
    const db = {
      getAllAsync: jest.fn(async (sql: string) =>
        sql.includes("FROM productos")
          ? [{ id: "iced-latte", leche_base: 240, leche_con_cold_foam: 190, leche_con_shot: 240, leche_con_ambos: 150 }]
          : [{ id: "op-entera", opcion: "Entera", grupo: "Tipo de leche" }]),
    } as any;
    await expect(lecheParaConsumo(db, ["iced-latte"], ["op-entera"])).resolves.toEqual({
      porProducto: { "iced-latte": { base: 240, conColdFoam: 190, conShot: 240, conAmbos: 150 } },
      opciones: { "op-entera": { grupo: "Tipo de leche", opcion: "Entera" } },
    });
  });

  it("sin opciones, sin leche definida o con error de base regresa vacío", async () => {
    const vacio = { porProducto: {}, opciones: {} };
    const sinFilas = { getAllAsync: jest.fn(async () => []) } as any;
    await expect(lecheParaConsumo(sinFilas, ["x"], [])).resolves.toEqual(vacio);
    expect(sinFilas.getAllAsync).not.toHaveBeenCalled();
    await expect(lecheParaConsumo(sinFilas, ["x"], ["o"])).resolves.toEqual(vacio);
    const rota = { getAllAsync: jest.fn(async () => { throw new Error("no such column: leche_base"); }) } as any;
    await expect(lecheParaConsumo(rota, ["x"], ["o"])).resolves.toEqual(vacio);
  });
});
