import { PedidosService } from "./pedidos.service";
import { EstadoPedido, MetodoPago } from "@hangar421/shared";

/**
 * Regresión de un fallo que costó tres ventas reales.
 *
 * `crear` ya toleraba un `meseroId` desconocido (se guarda el pedido sin atribución), pero
 * `cobrar` seguía lanzando un 400 si el `cajeroId` no existía en la base. Resultado: el pedido
 * entraba, el pago se rechazaba, y la venta se quedaba en ENVIADO — visible en el listado pero
 * sin sumar a ningún total, y reintentándose en la cola indefinidamente.
 *
 * El caso que lo dispara es un cajero dado de alta en la terminal SIN conexión: su id es un
 * uuid7 generado en la tablet que el ERP nunca ha visto.
 */
function crearServicio(usuariosExistentes: string[], opciones: { turnoIdDelPedido?: string | null; turnosAbiertos?: any[] } = {}) {
  const pedido = {
    turnoId: opciones.turnoIdDelPedido ?? null,
    id: "pedido-1",
    sucursalId: "suc-1",
    empresaId: "emp-1",
    mesaId: null,
    total: 225,
    estado: EstadoPedido.ENVIADO,
    items: [],
    descuentos: [],
  };

  const pagosCreados: any[] = [];
  const actualizaciones: any[] = [];

  const tx = {
    pago: { createMany: jest.fn((args: any) => { pagosCreados.push(...args.data); return Promise.resolve({}); }) },
    pedido: { update: jest.fn((args: any) => { actualizaciones.push(args.data); return Promise.resolve({}); }) },
    mesa: { update: jest.fn(() => Promise.resolve({})) },
  };

  const prisma = {
    pedido: {
      findUnique: jest.fn(() => Promise.resolve({ ...pedido, pagos: [], mesero: null, cajero: null, mesa: null })),
    },
    usuario: {
      findUnique: jest.fn(({ where: { id } }: any) =>
        Promise.resolve(usuariosExistentes.includes(id) ? { id } : null),
      ),
    },
    // Turnos que el ERP tiene del cajero: se filtra como lo haría la consulta real (sucursal,
    // cajero y ventana apertura–cierre que contenga el momento del cobro).
    turno: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          (opciones.turnosAbiertos ?? []).find(
            (t) =>
              t.sucursalId === where.sucursalId &&
              t.usuarioId === where.usuarioId &&
              t.fechaApertura <= where.fechaApertura.lte &&
              (t.fechaCierre === null || t.fechaCierre >= where.fechaApertura.lte),
          ) ?? null,
        ),
      ),
    },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };

  const realtime = { emitirASucursal: jest.fn(), emitirAEmpresa: jest.fn() };
  const service = new PedidosService(prisma as any, realtime as any, {} as any);

  // Solo se sustituye el descuento de inventario, que va contra tablas que este test no modela.
  // `obtener` se deja tal cual, leyendo del mock de Prisma: sustituirlo por un pedido ya
  // COBRADO haría que `cobrar` saliera por su atajo de idempotencia sin ejecutar nada de lo que
  // se quiere probar.
  (service as any).descontarInventarioPorReceta = jest.fn(() => Promise.resolve());

  return { service, prisma, pagosCreados, actualizaciones, realtime };
}

const PAGOS = [{ metodo: MetodoPago.EFECTIVO, monto: 225 }];

describe("PedidosService.cobrar — cajero desconocido", () => {
  it("registra el cobro aunque el cajero no exista en el ERP", async () => {
    const { service, actualizaciones } = crearServicio([]);

    await expect(
      service.cobrar("pedido-1", { pagos: PAGOS, cajeroId: "01a0bed8-c5d4-7cf0-976e-6dc90afffa6d" } as any),
    ).resolves.toBeDefined();

    expect(actualizaciones[0]).toEqual(expect.objectContaining({ estado: EstadoPedido.COBRADO }));
  });

  it("guarda el pago SIN cajero en vez de perder el cobro", async () => {
    // Perder de quién fue el cobro es mucho menos grave que perder el cobro.
    const { service, pagosCreados, actualizaciones } = crearServicio([]);
    await service.cobrar("pedido-1", { pagos: PAGOS, cajeroId: "id-que-no-existe" } as any);

    expect(pagosCreados[0].usuarioId).toBeUndefined();
    expect(actualizaciones[0].cajeroId).toBeUndefined();
  });

  it("conserva la atribución cuando el cajero SÍ existe", async () => {
    const { service, pagosCreados, actualizaciones } = crearServicio(["cajero-real"]);
    await service.cobrar("pedido-1", { pagos: PAGOS, cajeroId: "cajero-real" } as any);

    expect(pagosCreados[0].usuarioId).toBe("cajero-real");
    expect(actualizaciones[0].cajeroId).toBe("cajero-real");
  });

  it("funciona sin cajeroId, sin llegar a consultar la tabla de usuarios", async () => {
    const { service, prisma } = crearServicio([]);
    await service.cobrar("pedido-1", { pagos: PAGOS } as any);

    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
  });

  it("sigue rechazando un pago que no cubre el total", async () => {
    // La tolerancia es SOLO con la atribución: un importe insuficiente sigue siendo un error.
    const { service } = crearServicio(["cajero-real"]);

    await expect(
      service.cobrar("pedido-1", { pagos: [{ metodo: MetodoPago.EFECTIVO, monto: 10 }], cajeroId: "cajero-real" } as any),
    ).rejects.toThrow(/no cubre el total/i);
  });

  it("avisa al ERP por WebSocket para que la venta aparezca sola en la web", async () => {
    const { service, realtime } = crearServicio(["cajero-real"]);
    await service.cobrar("pedido-1", { pagos: PAGOS, cajeroId: "cajero-real" } as any);

    expect(realtime.emitirAEmpresa).toHaveBeenCalledWith("emp-1", "pedido:actualizado", expect.anything());
  });
});

describe("PedidosService.cobrar — enlace al turno", () => {
  const turno = (id: string, apertura: string, cierre: string | null) => ({
    id, sucursalId: "suc-1", usuarioId: "cajero-1", fechaApertura: new Date(apertura), fechaCierre: cierre ? new Date(cierre) : null,
  });

  it("un pedido sin turno se enlaza al turno del cajero abierto al momento del cobro", async () => {
    const { service, actualizaciones } = crearServicio(["cajero-1"], {
      turnosAbiertos: [turno("turno-ayer", "2026-09-20T08:00:00Z", "2026-09-20T20:00:00Z"), turno("turno-hoy", "2026-09-21T08:00:00Z", null)],
    });
    await service.cobrar("pedido-1", { pagos: PAGOS, cajeroId: "cajero-1" } as any, new Date("2026-09-21T10:00:00Z"));
    expect(actualizaciones[0].turnoId).toBe("turno-hoy");
  });

  it("un cobro que llega tarde por la cola offline cae en el turno de SU hora, aunque ya esté cerrado", async () => {
    const { service, actualizaciones } = crearServicio(["cajero-1"], {
      turnosAbiertos: [turno("turno-ayer", "2026-09-20T08:00:00Z", "2026-09-20T20:00:00Z"), turno("turno-hoy", "2026-09-21T08:00:00Z", null)],
    });
    await service.cobrar("pedido-1", { pagos: PAGOS, cajeroId: "cajero-1" } as any, new Date("2026-09-20T19:00:00Z"));
    expect(actualizaciones[0].turnoId).toBe("turno-ayer");
  });

  it("respeta el turno que ya trae el pedido (el APK lo manda al crear la venta)", async () => {
    const { service, actualizaciones } = crearServicio(["cajero-1"], {
      turnoIdDelPedido: "turno-del-apk",
      turnosAbiertos: [turno("turno-hoy", "2026-09-21T08:00:00Z", null)],
    });
    await service.cobrar("pedido-1", { pagos: PAGOS, cajeroId: "cajero-1" } as any, new Date("2026-09-21T10:00:00Z"));
    expect(actualizaciones[0].turnoId).toBe("turno-del-apk");
  });

  it("sin cajero conocido o sin turno que cuadre, lo deja vacío", async () => {
    const { service, actualizaciones } = crearServicio([], { turnosAbiertos: [] });
    await service.cobrar("pedido-1", { pagos: PAGOS, cajeroId: "desconocido" } as any);
    expect(actualizaciones[0].turnoId).toBeNull();
  });
});
