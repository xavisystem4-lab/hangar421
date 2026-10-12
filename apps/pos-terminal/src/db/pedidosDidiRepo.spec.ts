import { cancelarPedidoDidi, crearPedidoDidi, listarPedidosDidiEnPreparacion, marcarPedidoDidiCobrado } from "./pedidosDidiRepo";

function baseFalsa(filas: any[] = []) {
  const ejecutados: { sql: string; params: any[] }[] = [];
  const db = {
    runAsync: jest.fn(async (sql: string, ...params: any[]) => { ejecutados.push({ sql, params }); }),
    getAllAsync: jest.fn(async () => filas),
    getFirstAsync: jest.fn(async () => filas[0] ?? null),
  } as any;
  return { db, ejecutados };
}

describe("pedidos de DiDi en preparación", () => {
  const item = { leido: "2x Latte", cantidad: 2, productoId: "latte-didi", nombreProducto: "Latte", precioUnitario: 85, categoria: "DIDI", coincidencia: "exacto" as const };

  it("al confirmar se guarda en PREPARANDO con sus productos", async () => {
    const { db, ejecutados } = baseFalsa();
    const id = await crearPedidoDidi(db, { numero: "A1B2", cliente: "Ana", totalLeido: 170, textoOriginal: "2x Latte", items: [item] });
    expect(id).toBeTruthy();
    expect(ejecutados[0].sql).toContain("'PREPARANDO'");
    expect(JSON.parse(ejecutados[0].params[5])).toEqual([item]);
  });

  it("lee la lista con sus productos y tolera un JSON roto", async () => {
    const { db } = baseFalsa([
      { id: "1", numero: "A1", cliente: null, total_leido: null, texto_original: "", items: JSON.stringify([item]), estado: "PREPARANDO", venta_id: null, created_at: "t" },
      { id: "2", numero: "B2", cliente: null, total_leido: null, texto_original: "", items: "{roto", estado: "PREPARANDO", venta_id: null, created_at: "t" },
    ]);
    const lista = await listarPedidosDidiEnPreparacion(db);
    expect(lista[0].items).toEqual([item]);
    expect(lista[1].items).toEqual([]);
  });

  it("cobrar y cancelar solo afectan a un pedido que sigue en preparación", async () => {
    const { db, ejecutados } = baseFalsa();
    await marcarPedidoDidiCobrado(db, "1", "venta-9");
    await cancelarPedidoDidi(db, "2");
    expect(ejecutados[0].sql).toContain("estado = 'COBRADO'");
    expect(ejecutados[0].sql).toContain("AND estado = 'PREPARANDO'");
    expect(ejecutados[1].sql).toContain("estado = 'CANCELADO'");
  });
});
