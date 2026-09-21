import { RolUsuario, SyncEntidad, SyncOperacion, SyncStatus } from "@hangar421/shared";
import { SyncService } from "./sync.service";

/** Pruebas de la cola de sincronización: idempotencia (no reprocesar un idempotencyKey ya
 *  aplicado), manejo de errores por item sin tumbar el resto del lote, y alcance de la sesión
 *  (empresa y sucursal del token). Se usan mocks simples en vez de un TestingModule de Nest
 *  porque SyncService no depende de nada específico de Nest en su lógica — solo de las
 *  inyecciones del constructor. */

/** Sesión por defecto: cajero de emp-1 con acceso solo a suc-1. */
const SESION = { sub: "user-1", empresaId: "emp-1", sucursalId: "suc-1", rol: RolUsuario.CAJERO, type: "access" } as const;

/** Filas "existentes" en el ERP para las pruebas de alcance: dueño de cada id. */
const DUENOS: Record<string, Record<string, any>> = {
  sucursal: { "suc-1": { empresaId: "emp-1" }, "suc-2": { empresaId: "emp-1" }, "suc-ajena": { empresaId: "emp-2" } },
  pedido: { "pedido-suc-2": { sucursalId: "suc-2" } },
  mesa: { "mesa-suc-2": { sucursalId: "suc-2" } },
  turno: { "turno-suc-2": { sucursalId: "suc-2" } },
  caja: {},
  solicitudProducto: { "solicitud-suc-2": { sucursalId: "suc-2" } },
  insumo: { "insumo-ajeno": { empresaId: "emp-2" } },
  producto: { "producto-ajeno": { empresaId: "emp-2" } },
  usuario: { "user-1": { empresaId: "emp-1" }, "user-ajeno": { empresaId: "emp-2" } },
};

function tabla(nombre: string) {
  return { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(DUENOS[nombre][id] ?? null)) };
}

function crearServicio() {
  const registros = new Map<string, any>();

  const prisma = {
    sucursal: tabla("sucursal"),
    pedido: tabla("pedido"),
    mesa: tabla("mesa"),
    turno: tabla("turno"),
    caja: tabla("caja"),
    insumo: tabla("insumo"),
    producto: tabla("producto"),
    usuario: tabla("usuario"),
    solicitudProducto: tabla("solicitudProducto"),
    usuarioSucursal: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(where.usuarioId === "user-1" && where.sucursalId === "suc-1" ? { id: "acceso-1" } : null),
      ),
    },
    syncQueueItem: {
      findUnique: jest.fn(({ where: { idempotencyKey } }: any) => Promise.resolve(registros.get(idempotencyKey) ?? null)),
      upsert: jest.fn(({ where: { idempotencyKey }, create, update }: any) => {
        const existente = registros.get(idempotencyKey);
        const nuevo = existente ? { ...existente, ...update, intentos: (existente.intentos ?? 0) + 1 } : create;
        registros.set(idempotencyKey, nuevo);
        return Promise.resolve(nuevo);
      }),
    },
    dispositivo: {
      update: jest.fn(() => Promise.resolve({})),
      // resolverDispositivoId (common/dispositivo.util.ts) los usa para dar de alta el
      // dispositivo sobre la marcha la primera vez que se ve — sin estos dos el mock queda
      // incompleto y cualquier item con dispositivoId truena con "is not a function".
      findUnique: jest.fn(() => Promise.resolve(null)),
      create: jest.fn(() => Promise.resolve({ id: "dispositivo-1" })),
    },
  };

  const pedidos = { crear: jest.fn(() => Promise.resolve({ id: "pedido-1" })) };
  const mesas = { cambiarEstado: jest.fn() };
  const inventario = { registrarMovimiento: jest.fn() };
  const caja = { abrirTurno: jest.fn(), cerrarTurno: jest.fn(), registrarMovimiento: jest.fn() };
  const catalogo = { fijarPrecioSucursal: jest.fn(), fijarDisponibilidad: jest.fn() };
  const solicitudes = { crear: jest.fn(() => Promise.resolve({})) };

  const service = new SyncService(prisma as any, pedidos as any, mesas as any, inventario as any, caja as any, catalogo as any, solicitudes as any);
  const push = (items: any[], sesion: any = SESION) => service.push(items, sesion);
  return { service, push, prisma, pedidos, mesas, inventario, caja, catalogo, solicitudes, registros };
}

function envolverPedido(idempotencyKey: string) {
  return {
    id: "pedido-1",
    entidad: SyncEntidad.PEDIDO,
    operacion: SyncOperacion.CREATE,
    idempotencyKey,
    dispositivoId: "dev-1",
    sucursalId: "suc-1",
    usuarioId: "user-1",
    createdAtLocal: new Date().toISOString(),
    payload: { empresaId: "emp-1", tipo: "MOSTRADOR", items: [{ productoId: "p1", cantidad: 1 }] },
  };
}

describe("SyncService.push — idempotencia", () => {
  it("aplica un item nuevo y lo marca SYNCED", async () => {
    const { push, pedidos } = crearServicio();
    const resp = await push([envolverPedido("dev-1-PEDIDO-1") as any]);

    expect(pedidos.crear).toHaveBeenCalledTimes(1);
    expect(resp.resultados[0].estado).toBe(SyncStatus.SYNCED);
  });

  it("no vuelve a aplicar un idempotencyKey ya sincronizado (reintento de red)", async () => {
    const { push, pedidos } = crearServicio();
    const envelope = envolverPedido("dev-1-PEDIDO-2");

    await push([envelope as any]);
    await push([envelope as any]); // simula el mismo lote reenviado tras un timeout

    expect(pedidos.crear).toHaveBeenCalledTimes(1);
  });

  it("un item con error no impide sincronizar el resto del lote", async () => {
    const { push, pedidos } = crearServicio();
    pedidos.crear
      .mockRejectedValueOnce(new Error("sucursal inexistente"))
      .mockResolvedValueOnce({ id: "pedido-2" });

    const resp = await push([
      envolverPedido("dev-1-PEDIDO-ERR") as any,
      envolverPedido("dev-1-PEDIDO-OK") as any,
    ]);

    expect(resp.resultados[0].estado).toBe(SyncStatus.ERROR);
    expect(resp.resultados[0].error).toContain("sucursal inexistente");
    expect(resp.resultados[1].estado).toBe(SyncStatus.SYNCED);
  });

  it("un item marcado ERROR sí se reintenta en el siguiente push (a diferencia de uno SYNCED)", async () => {
    const { push, pedidos } = crearServicio();
    const envelope = envolverPedido("dev-1-PEDIDO-RETRY");
    pedidos.crear.mockRejectedValueOnce(new Error("timeout de red"));

    await push([envelope as any]);
    expect(pedidos.crear).toHaveBeenCalledTimes(1);

    pedidos.crear.mockResolvedValueOnce({ id: "pedido-3" });
    const segundo = await push([envelope as any]);

    expect(pedidos.crear).toHaveBeenCalledTimes(2);
    expect(segundo.resultados[0].estado).toBe(SyncStatus.SYNCED);
  });

  it("MOVIMIENTO_CAJA enruta a caja.registrarMovimiento (no a inventario, no a turno)", async () => {
    const { push, caja } = crearServicio();
    await push([{
      id: "mov-1", entidad: SyncEntidad.MOVIMIENTO_CAJA, operacion: SyncOperacion.CREATE,
      idempotencyKey: "dev-1-MOV-1", dispositivoId: "dev-1", sucursalId: "suc-1", usuarioId: "user-1",
      createdAtLocal: new Date().toISOString(),
      payload: { turnoId: "turno-1", tipo: "INGRESO", monto: 100, motivo: "fondo extra" },
    } as any]);
    expect(caja.registrarMovimiento).toHaveBeenCalledWith({ turnoId: "turno-1", tipo: "INGRESO", monto: 100, motivo: "fondo extra", usuarioId: "user-1" });
  });

  it("PRODUCTO_SUCURSAL con precio enruta a fijarPrecioSucursal", async () => {
    const { push, catalogo } = crearServicio();
    await push([{
      id: "prod-1", entidad: SyncEntidad.PRODUCTO_SUCURSAL, operacion: SyncOperacion.UPDATE,
      idempotencyKey: "dev-1-PROD-1", dispositivoId: "dev-1", sucursalId: "suc-1", usuarioId: "user-1",
      createdAtLocal: new Date().toISOString(),
      payload: { productoId: "p1", precio: 55, disponible: true },
    } as any]);
    expect(catalogo.fijarPrecioSucursal).toHaveBeenCalledWith("p1", "suc-1", 55, true);
  });

  it("PRODUCTO_SUCURSAL sin precio (solo disponibilidad) enruta a fijarDisponibilidad", async () => {
    const { push, catalogo } = crearServicio();
    await push([{
      id: "prod-2", entidad: SyncEntidad.PRODUCTO_SUCURSAL, operacion: SyncOperacion.UPDATE,
      idempotencyKey: "dev-1-PROD-2", dispositivoId: "dev-1", sucursalId: "suc-1", usuarioId: "user-1",
      createdAtLocal: new Date().toISOString(),
      payload: { productoId: "p1", disponible: false },
    } as any]);
    expect(catalogo.fijarDisponibilidad).toHaveBeenCalledWith("p1", "suc-1", false);
  });
});

describe("SyncService.push — alcance de la sesión", () => {
  const sobre = (extra: any) => ({
    id: "x-1", entidad: SyncEntidad.PEDIDO, operacion: SyncOperacion.CREATE,
    idempotencyKey: `k-${Math.random()}`, dispositivoId: "dev-1", sucursalId: "suc-1", usuarioId: "user-1",
    createdAtLocal: new Date().toISOString(), payload: { tipo: "MOSTRADOR", items: [] },
    ...extra,
  });

  it("la empresa del pedido sale del token, no del payload", async () => {
    const { push, pedidos } = crearServicio();
    await push([sobre({ payload: { empresaId: "emp-2", tipo: "MOSTRADOR", items: [] } })]);
    expect(pedidos.crear).toHaveBeenCalledWith(expect.objectContaining({ empresaId: "emp-1" }));
  });

  it("rechaza una sucursal de otra empresa sin registrar nada", async () => {
    const { push, pedidos, prisma } = crearServicio();
    const resp = await push([sobre({ sucursalId: "suc-ajena" })]);
    expect(resp.resultados[0]).toMatchObject({ estado: SyncStatus.ERROR, error: "No tienes acceso a esta sucursal" });
    expect(pedidos.crear).not.toHaveBeenCalled();
    expect(prisma.syncQueueItem.upsert).not.toHaveBeenCalled();
    expect(prisma.dispositivo.create).not.toHaveBeenCalled();
  });

  it("rechaza una sucursal de la misma empresa a la que el usuario no tiene acceso", async () => {
    const { push } = crearServicio();
    const resp = await push([sobre({ sucursalId: "suc-2" })]);
    expect(resp.resultados[0].error).toBe("No tienes acceso a esta sucursal");
  });

  it("ADMIN_CORPORATIVO opera en cualquier sucursal de su empresa, pero no en otra empresa", async () => {
    const { push } = crearServicio();
    const admin = { ...SESION, rol: RolUsuario.ADMIN_CORPORATIVO };
    const resp = await push([sobre({ sucursalId: "suc-2" }), sobre({ sucursalId: "suc-ajena" })], admin);
    expect(resp.resultados[0].estado).toBe(SyncStatus.SYNCED);
    expect(resp.resultados[1].estado).toBe(SyncStatus.ERROR);
  });

  it("no deja cobrar un pedido de otra sucursal nombrando su id", async () => {
    const { push, pedidos } = crearServicio();
    (pedidos as any).cobrar = jest.fn();
    const resp = await push([sobre({ entidad: SyncEntidad.PAGO, operacion: SyncOperacion.CREATE, payload: { pedidoId: "pedido-suc-2", pagos: [] } })]);
    expect(resp.resultados[0].error).toBe("El pedido pertenece a otra sucursal");
    expect((pedidos as any).cobrar).not.toHaveBeenCalled();
  });

  it("no deja reutilizar el id de un pedido de otra sucursal", async () => {
    const { push } = crearServicio();
    const resp = await push([sobre({ id: "pedido-suc-2" })]);
    expect(resp.resultados[0].error).toBe("El pedido pertenece a otra sucursal");
  });

  it("rechaza mesa, turno, insumo o producto ajenos", async () => {
    const { push } = crearServicio();
    const resp = await push([
      sobre({ payload: { mesaId: "mesa-suc-2", items: [] } }),
      sobre({ entidad: SyncEntidad.MOVIMIENTO_CAJA, payload: { turnoId: "turno-suc-2", tipo: "INGRESO", monto: 1 } }),
      sobre({ entidad: SyncEntidad.MOVIMIENTO_INVENTARIO, payload: { insumoId: "insumo-ajeno", cantidad: 1 } }),
      sobre({ entidad: SyncEntidad.PRODUCTO_SUCURSAL, operacion: SyncOperacion.UPDATE, payload: { productoId: "producto-ajeno", disponible: false } }),
    ]);
    expect(resp.resultados.map((r) => r.estado)).toEqual(Array(4).fill(SyncStatus.ERROR));
  });

  it("rechaza atribuir la operación a un usuario de otra empresa, pero acepta uno aún no sincronizado", async () => {
    const { push } = crearServicio();
    const resp = await push([
      sobre({ payload: { meseroId: "user-ajeno", items: [] } }),
      sobre({ payload: { meseroId: "usuario-creado-offline", items: [] } }),
    ]);
    expect(resp.resultados[0].error).toBe("El usuario indicado pertenece a otra empresa");
    expect(resp.resultados[1].estado).toBe(SyncStatus.SYNCED);
  });
});

describe("SyncService.push — USUARIO dado de alta en la terminal", () => {
  function conAltas() {
    const ctx = crearServicio();
    (ctx.prisma.usuario as any).create = jest.fn(() => Promise.resolve({}));
    (ctx.prisma as any).usuarioSucursal.upsert = jest.fn(() => Promise.resolve({}));
    return ctx;
  }
  const alta = (extra: any = {}) => ({
    id: "usuario-offline-1", entidad: SyncEntidad.USUARIO, operacion: SyncOperacion.CREATE,
    idempotencyKey: `k-${Math.random()}`, dispositivoId: "dev-1", sucursalId: "suc-1", usuarioId: "user-1",
    createdAtLocal: new Date().toISOString(), payload: { nombre: "Ana", rol: "CAJERO" }, ...extra,
  });

  it("lo crea con el MISMO id, en la empresa del token y sin credenciales", async () => {
    const { push, prisma } = conAltas();
    const resp = await push([alta()]);
    expect(resp.resultados[0].estado).toBe(SyncStatus.SYNCED);
    const data = (prisma.usuario as any).create.mock.calls[0][0].data;
    expect(data).toMatchObject({ id: "usuario-offline-1", empresaId: "emp-1", nombre: "Ana" });
    expect(data.passwordHash).toBeUndefined();
    expect(data.pinHash).toBeUndefined();
    expect((prisma as any).usuarioSucursal.upsert.mock.calls[0][0].create).toMatchObject({ sucursalId: "suc-1", rol: "CAJERO" });
  });

  it("nunca crea administradores: un Admin local llega como SUPERVISOR", async () => {
    const { push, prisma } = conAltas();
    await push([alta({ payload: { nombre: "Luis", rol: "ADMIN_SUCURSAL" } })]);
    expect((prisma as any).usuarioSucursal.upsert.mock.calls[0][0].create.rol).toBe("SUPERVISOR");
  });

  it("si ya existe no lo vuelve a crear (reintento idempotente)", async () => {
    const { push, prisma } = conAltas();
    await push([alta({ id: "user-1" })]);
    expect((prisma.usuario as any).create).not.toHaveBeenCalled();
  });

  it("rechaza reutilizar el id de un usuario de otra empresa", async () => {
    const { push } = conAltas();
    const resp = await push([alta({ id: "user-ajeno" })]);
    expect(resp.resultados[0].error).toBe("El usuario indicado pertenece a otra empresa");
  });
});

describe("SyncService.push — SOLICITUD_PRODUCTO", () => {
  const solicitud = (extra: any = {}) => ({
    id: "solicitud-1", entidad: SyncEntidad.SOLICITUD_PRODUCTO, operacion: SyncOperacion.CREATE,
    idempotencyKey: `k-${Math.random()}`, dispositivoId: "tablet-1", sucursalId: "suc-1", usuarioId: "user-1",
    createdAtLocal: "2026-09-21T15:30:00.000Z", payload: { texto: "Chai latte de avena" }, ...extra,
  });

  it("registra la solicitud con empresa del token, sucursal, usuario, equipo y la hora de la terminal", async () => {
    const { push, solicitudes } = crearServicio();
    const resp = await push([solicitud()]);
    expect(resp.resultados[0].estado).toBe(SyncStatus.SYNCED);
    expect(solicitudes.crear).toHaveBeenCalledWith({
      id: "solicitud-1", empresaId: "emp-1", sucursalId: "suc-1", usuarioId: "user-1",
      dispositivoHuella: "tablet-1", texto: "Chai latte de avena", solicitadaEn: new Date("2026-09-21T15:30:00.000Z"),
    });
  });

  it("no deja reutilizar el id de una solicitud de otra sucursal", async () => {
    const { push, solicitudes } = crearServicio();
    const resp = await push([solicitud({ id: "solicitud-suc-2" })]);
    expect(resp.resultados[0].error).toBe("La solicitud pertenece a otra sucursal");
    expect(solicitudes.crear).not.toHaveBeenCalled();
  });
});
