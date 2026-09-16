import { EstadoSolicitudPago, OrigenEventoPago } from "@hangar421/shared";
import { PagosService } from "./pagos.service";

/** Pruebas de la máquina de estados de pagos con tarjeta: idempotencia al crear, bloqueo de
 *  solicitudes duplicadas/concurrentes sobre la misma cuenta, cancelación y que un pago
 *  APROBADO liquide el pedido exactamente una vez incluso si el webhook llega repetido (MP
 *  reintenta notificaciones). Mocks simples en vez de un TestingModule — mismo estilo que
 *  sync.service.spec.ts. */
function crearServicio() {
  const solicitudes = new Map<string, any>();
  let contador = 0;

  const prisma = {
    paymentRequest: {
      findUnique: jest.fn(({ where }: any) => {
        if (where.id) return Promise.resolve(solicitudes.get(where.id) ?? null);
        if (where.idempotencyKey) {
          return Promise.resolve(Array.from(solicitudes.values()).find((s) => s.idempotencyKey === where.idempotencyKey) ?? null);
        }
        if (where.referenciaInterna) {
          return Promise.resolve(Array.from(solicitudes.values()).find((s) => s.referenciaInterna === where.referenciaInterna) ?? null);
        }
        return Promise.resolve(null);
      }),
      findFirst: jest.fn(({ where }: any) => {
        const encontrada = Array.from(solicitudes.values()).find(
          (s) => s.pedidoId === where.pedidoId && !where.estado.notIn.includes(s.estado),
        );
        return Promise.resolve(encontrada ?? null);
      }),
      create: jest.fn(({ data }: any) => {
        const id = `sol-${++contador}`;
        const nueva = { id, estado: EstadoSolicitudPago.PENDIENTE, referenciaExterna: null, motivoError: null, ...data };
        solicitudes.set(id, nueva);
        return Promise.resolve(nueva);
      }),
      update: jest.fn(({ where, data }: any) => {
        const actual = solicitudes.get(where.id);
        const actualizada = { ...actual, ...data };
        solicitudes.set(where.id, actualizada);
        return Promise.resolve(actualizada);
      }),
    },
    paymentEvent: { create: jest.fn(() => Promise.resolve({})) },
    paymentTerminal: {
      findUnique: jest.fn(() => Promise.resolve({ id: "term-1", activo: true, proveedorConfigId: "cfg-1", identificadorExterno: "EXT-1" })),
    },
    paymentProviderConfig: {
      findUnique: jest.fn(() => Promise.resolve({ id: "cfg-1", proveedor: "mock", ambiente: "PRUEBAS", identificadorComercio: null, webhookUrl: null, credencialesCifradas: "cifrado" })),
    },
    pedido: {
      findUnique: jest.fn(() => Promise.resolve({ id: "pedido-1", empresaId: "emp-1", sucursalId: "suc-1", mesaId: null, meseroId: "mesero-1", total: 80 })),
    },
    pago: { aggregate: jest.fn(() => Promise.resolve({ _sum: { monto: 0 } })) },
  };

  const realtime = { emitirASucursal: jest.fn(), emitirAUsuario: jest.fn() };
  const cifrado = { descifrarJson: jest.fn(() => ({ accessToken: "tok" })), cifrarJson: jest.fn(() => "cifrado") };
  const mockAdapter = {
    codigo: "mock",
    crearSolicitudDePago: jest.fn(() => Promise.resolve({ referenciaExterna: "ext-1", estado: "EN_PROCESO" })),
    cancelarSolicitudDePago: jest.fn(() => Promise.resolve()),
    consultarEstadoDePago: jest.fn(() => Promise.resolve({ estado: "APROBADO" })),
    procesarWebhook: jest.fn(),
    probarConexion: jest.fn(),
  };
  const proveedores = { obtener: jest.fn(() => mockAdapter) };
  const pedidos = { cobrar: jest.fn(() => Promise.resolve({ id: "pedido-1", estado: "COBRADO" })) };
  const push = { enviarPush: jest.fn(() => Promise.resolve()) };

  const service = new PagosService(prisma as any, realtime as any, cifrado as any, proveedores as any, pedidos as any, push as any);
  return { service, prisma, realtime, pedidos, mockAdapter, solicitudes };
}

describe("PagosService — crearSolicitud", () => {
  it("devuelve la misma solicitud si se reenvía la misma idempotencyKey (doble tap de 'Tarjeta')", async () => {
    const { service } = crearServicio();
    const dto = { pedidoId: "pedido-1", terminalId: "term-1", importe: 80, idempotencyKey: "idem-1" };
    const primera = await service.crearSolicitud(dto, "user-1");
    const segunda = await service.crearSolicitud(dto, "user-1");
    expect(segunda.id).toBe(primera.id);
  });

  it("rechaza una segunda solicitud activa para la misma cuenta (evita cobros duplicados)", async () => {
    const { service } = crearServicio();
    await service.crearSolicitud({ pedidoId: "pedido-1", terminalId: "term-1", importe: 80, idempotencyKey: "idem-1" }, "user-1");
    await expect(
      service.crearSolicitud({ pedidoId: "pedido-1", terminalId: "term-1", importe: 80, idempotencyKey: "idem-2" }, "user-1"),
    ).rejects.toThrow(/en curso/);
  });

  it("rechaza un importe mayor a lo que falta por cobrar de la cuenta", async () => {
    const { service } = crearServicio();
    await expect(
      service.crearSolicitud({ pedidoId: "pedido-1", terminalId: "term-1", importe: 999, idempotencyKey: "idem-1" }, "user-1"),
    ).rejects.toThrow(/excede/);
  });
});

describe("PagosService — transiciones y liquidación", () => {
  it("un webhook APROBADO liquida el pedido exactamente una vez aunque llegue repetido", async () => {
    const { service, pedidos } = crearServicio();
    const solicitud = await service.crearSolicitud({ pedidoId: "pedido-1", terminalId: "term-1", importe: 80, idempotencyKey: "idem-1" }, "user-1");
    await service.iniciarCobro(solicitud.id, OrigenEventoPago.APK);

    await (service as any).transicionar(solicitud.id, EstadoSolicitudPago.APROBADO, OrigenEventoPago.WEBHOOK);
    await (service as any).transicionar(solicitud.id, EstadoSolicitudPago.APROBADO, OrigenEventoPago.WEBHOOK); // reintento de MP

    expect(pedidos.cobrar).toHaveBeenCalledTimes(1);
    expect(pedidos.cobrar).toHaveBeenCalledWith("pedido-1", expect.objectContaining({ pagos: [expect.objectContaining({ monto: 80 })] }));
  });

  it("no permite que una solicitud RECHAZADA (estado terminal) se mueva a APROBADO después", async () => {
    const { service, pedidos } = crearServicio();
    const solicitud = await service.crearSolicitud({ pedidoId: "pedido-1", terminalId: "term-1", importe: 80, idempotencyKey: "idem-1" }, "user-1");
    await (service as any).transicionar(solicitud.id, EstadoSolicitudPago.RECHAZADO, OrigenEventoPago.WEBHOOK);
    await (service as any).transicionar(solicitud.id, EstadoSolicitudPago.APROBADO, OrigenEventoPago.WEBHOOK);

    const final = await service.obtener(solicitud.id);
    expect(final.estado).toBe(EstadoSolicitudPago.RECHAZADO);
    expect(pedidos.cobrar).not.toHaveBeenCalled();
  });
});

describe("PagosService — cancelar", () => {
  it("cancela una solicitud PENDIENTE y permite crear una nueva para el mismo pedido después", async () => {
    const { service } = crearServicio();
    const solicitud = await service.crearSolicitud({ pedidoId: "pedido-1", terminalId: "term-1", importe: 80, idempotencyKey: "idem-1" }, "user-1");
    const cancelada = await service.cancelarSolicitud(solicitud.id, OrigenEventoPago.POS);
    expect(cancelada.estado).toBe(EstadoSolicitudPago.CANCELADO);

    const nueva = await service.crearSolicitud({ pedidoId: "pedido-1", terminalId: "term-1", importe: 80, idempotencyKey: "idem-2" }, "user-1");
    expect(nueva.estado).toBe(EstadoSolicitudPago.PENDIENTE);
  });

  it("cancelar una solicitud ya APROBADA es un no-op (no revierte un cobro ya liquidado)", async () => {
    const { service } = crearServicio();
    const solicitud = await service.crearSolicitud({ pedidoId: "pedido-1", terminalId: "term-1", importe: 80, idempotencyKey: "idem-1" }, "user-1");
    await (service as any).transicionar(solicitud.id, EstadoSolicitudPago.APROBADO, OrigenEventoPago.WEBHOOK);
    const resultado = await service.cancelarSolicitud(solicitud.id, OrigenEventoPago.POS);
    expect(resultado.estado).toBe(EstadoSolicitudPago.APROBADO);
  });
});
