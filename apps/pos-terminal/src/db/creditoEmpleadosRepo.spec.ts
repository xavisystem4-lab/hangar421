import { consumosCreditoLocales } from "./creditoEmpleadosRepo";

function baseFalsa() {
  return {
    getAllAsync: jest.fn(async (sql: string) => {
      if (sql.includes("FROM pagos")) return [{ venta_id: "v1", empleado_id: "ana", monto: 95, folio_local: 12, total: 95, created_at: "2026-10-12T15:00:00.000Z", nombre: "Ana" }];
      if (sql.includes("FROM venta_items")) return [{ id: "i1", venta_id: "v1", nombre_snapshot: "Latte", cantidad: 1, precio_unit_snapshot: 70 }];
      return [{ venta_item_id: "i1", nombre_snapshot: "Avena", precio_extra_snapshot: 25 }];
    }),
  } as any;
}

describe("consumosCreditoLocales", () => {
  it("arma cada consumo con su folio, fecha y productos con modificadores", async () => {
    const r = await consumosCreditoLocales(baseFalsa(), "2026-10-12T00:00:00.000Z", "2026-10-12T23:59:59.999Z");
    expect(r).toEqual([{
      empleadoId: "ana", empleado: "Ana", ventaId: "v1", folio: "12", fecha: "2026-10-12T15:00:00.000Z", sucursal: null,
      montoCredito: 95, totalVenta: 95,
      productos: [{ nombre: "Latte", cantidad: 1, precioUnitario: 70, modificadores: [{ nombre: "Avena", precioExtra: 25 }] }],
    }]);
  });

  it("solo ventas cobradas con crédito de empleado", async () => {
    const db = baseFalsa();
    await consumosCreditoLocales(db, "a", "b");
    const sql = db.getAllAsync.mock.calls[0][0];
    expect(sql).toContain("p.metodo = 'MONEDERO_EMPLEADO'");
    expect(sql).toContain("v.estado = 'COBRADA'");
  });
});
