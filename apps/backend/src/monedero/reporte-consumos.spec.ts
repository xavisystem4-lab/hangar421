import { MonederoService } from "./monedero.service";

describe("reporteConsumos (crédito de empleados)", () => {
  it("une cada consumo con su venta: folio, sucursal, productos y modificadores, agrupado por empleada", async () => {
    const prisma = {
      movimientoMonedero: {
        findMany: jest.fn(async () => [
          { usuarioId: "ana", pedidoId: "p1", monto: "95", createdAt: new Date("2026-10-12T15:00:00Z"), monedero: { usuario: { nombre: "Ana" } } },
        ]),
      },
      pedido: {
        findMany: jest.fn(async () => [
          {
            id: "p1", folio: "12", total: "95", sucursal: { nombre: "Benito Juárez" },
            items: [{ cantidad: 1, precioUnitario: "70", producto: { nombre: "Latte" }, modificadores: [{ precioExtra: "25", opcionModificador: { nombre: "Avena" } }] }],
          },
        ]),
      },
    };
    const r = await new MonederoService(prisma as any).reporteConsumos("e1", { desde: "2026-10-12T00:00:00Z", hasta: "2026-10-12T23:59:59Z", sucursalId: "bj" });
    expect(prisma.movimientoMonedero.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ monedero: { empresaId: "e1" }, sucursalId: "bj" }),
    }));
    expect(r).toEqual([{
      empleadoId: "ana", empleado: "Ana", totalCredito: 95, numConsumos: 1, numProductos: 1,
      consumos: [{
        empleadoId: "ana", empleado: "Ana", ventaId: "p1", folio: "12", fecha: "2026-10-12T15:00:00.000Z", sucursal: "Benito Juárez",
        montoCredito: 95, totalVenta: 95,
        productos: [{ nombre: "Latte", cantidad: 1, precioUnitario: 70, modificadores: [{ nombre: "Avena", precioExtra: 25 }] }],
      }],
    }]);
  });

  it("sin consumos no consulta ventas", async () => {
    const prisma = { movimientoMonedero: { findMany: jest.fn(async () => []) }, pedido: { findMany: jest.fn() } };
    expect(await new MonederoService(prisma as any).reporteConsumos("e1", {})).toEqual([]);
    expect(prisma.pedido.findMany).not.toHaveBeenCalled();
  });
});

describe("enviarReporteConsumos", () => {
  it("arma el correo con los datos de la base y adjunta PDF y Excel", async () => {
    const prisma = {
      movimientoMonedero: { findMany: jest.fn(async () => [{ usuarioId: "ana", pedidoId: "p1", monto: "95", createdAt: new Date("2026-10-12T15:00:00Z"), monedero: { usuario: { nombre: "Ana" } } }]) },
      pedido: { findMany: jest.fn(async () => [{ id: "p1", folio: "12", total: "95", sucursal: { nombre: "Benito Juárez" }, items: [] }]) },
      sucursal: { findUnique: jest.fn(async () => ({ nombre: "Benito Juárez" })) },
    };
    const correo = { enviar: jest.fn(async () => ({ enviadoA: ["a@b.com"] })) };
    await new MonederoService(prisma as any, correo as any).enviarReporteConsumos("e1", {
      sucursalId: "bj", destinatarios: "a@b.com, malo", periodo: "12/10/2026", pdfBase64: "UERG", excelBase64: "WExT",
    }, "Admin");
    const [msg] = (correo.enviar.mock.calls as any[])[0];
    expect(msg.destinatarios).toEqual(["a@b.com"]);
    expect(msg.asunto).toBe("Crédito de empleados · Benito Juárez · 12/10/2026");
    expect(msg.html).toContain("Ana · $95.00");
    expect(msg.adjuntos.map((a: any) => a.nombre)).toEqual(["credito-empleados-12-10-2026.pdf", "credito-empleados-12-10-2026.xlsx"]);
  });

  it("sin correos válidos no envía", async () => {
    const correo = { enviar: jest.fn() };
    await expect(new MonederoService({} as any, correo as any).enviarReporteConsumos("e1", { destinatarios: "nada" })).rejects.toThrow("correo válido");
    expect(correo.enviar).not.toHaveBeenCalled();
  });
});
