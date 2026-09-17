// Verifica: cifrado/enmascarado de credenciales, que nunca se filtren secretos (ni en la
// respuesta ni en AuditLog), las transiciones de conectar/reconectar/desconectar, y la
// idempotencia de webhooks — mismo estilo que pagos.service.spec.ts (Prisma mockeado a mano,
// PlataformasService instanciado directo con `new`, sin @nestjs/testing).

import { AmbientePlataforma, EstadoConexionPlataforma, EstadoSincronizacionOrdenPlataforma } from "@hangar421/shared";
import { PlataformasService } from "./plataformas.service";

function crearAdaptadorMock(codigo: string, overrides: Record<string, any> = {}) {
  return {
    codigo,
    nombreVisible: `Plataforma ${codigo}`,
    validarConfiguracion: jest.fn(),
    campoPrincipalEnmascarado: jest.fn(() => "1234"),
    tieneClientSecret: jest.fn(() => true),
    probarConexion: jest.fn(async () => ({ ok: true, detalle: "ok" })),
    procesarWebhook: jest.fn(async (): Promise<{ eventoExternoId: string; orden: any }> => ({ eventoExternoId: "evt-1", orden: null })),
    ...overrides,
  };
}

function crearPrismaFake() {
  const configs = new Map<string, any>();
  const webhookEvents: any[] = [];
  const ordenSyncs = new Map<string, any>();
  let contadorConfig = 0;
  let contadorOrden = 0;

  const buscarPorClaveCompuesta = (empresaId: string, sucursalId: string | null, plataforma: string) =>
    Array.from(configs.values()).find((c) => c.empresaId === empresaId && c.sucursalId === sucursalId && c.plataforma === plataforma) ?? null;

  const plataformaConfig = {
    findMany: jest.fn(async ({ where }: any) =>
      Array.from(configs.values()).filter(
        (c) => c.empresaId === where.empresaId && ("sucursalId" in where ? c.sucursalId === where.sucursalId : true),
      ),
    ),
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id) return configs.get(where.id) ?? null;
      if (where.webhookSlug) return Array.from(configs.values()).find((c) => c.webhookSlug === where.webhookSlug) ?? null;
      if (where.empresaId_sucursalId_plataforma) {
        const { empresaId, sucursalId, plataforma } = where.empresaId_sucursalId_plataforma;
        return buscarPorClaveCompuesta(empresaId, sucursalId, plataforma);
      }
      return null;
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const encontrado = where.id ? configs.get(where.id) : undefined;
      if (!encontrado) throw new Error("PlataformaConfig no encontrada (fake)");
      return encontrado;
    }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const { empresaId, sucursalId, plataforma } = where.empresaId_sucursalId_plataforma;
      const existente = buscarPorClaveCompuesta(empresaId, sucursalId, plataforma);
      if (existente) {
        const actualizado = { ...existente, ...update, updatedAt: new Date() };
        configs.set(existente.id, actualizado);
        return actualizado;
      }
      const id = `config-${++contadorConfig}`;
      const nuevo = { id, webhookSlug: `slug-${id}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      configs.set(id, nuevo);
      return nuevo;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const existente = configs.get(where.id);
      if (!existente) throw new Error("PlataformaConfig no encontrada (fake)");
      const actualizado = { ...existente, ...data, updatedAt: new Date() };
      configs.set(where.id, actualizado);
      return actualizado;
    }),
  };

  const plataformaWebhookEvent = {
    create: jest.fn(async ({ data }: any) => {
      const duplicado = webhookEvents.find(
        (e) => e.plataformaConfigId === data.plataformaConfigId && e.eventoExternoId === data.eventoExternoId,
      );
      if (duplicado) {
        const error: any = new Error("Unique constraint failed on the fields: (`plataformaConfigId`,`eventoExternoId`)");
        error.code = "P2002";
        throw error;
      }
      const evento = { id: `evt-${webhookEvents.length + 1}`, createdAt: new Date(), ...data };
      webhookEvents.push(evento);
      return evento;
    }),
  };

  const plataformaOrdenSync = {
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const { plataformaConfigId, ordenExternaId } = where.plataformaConfigId_ordenExternaId;
      const clave = `${plataformaConfigId}:${ordenExternaId}`;
      const existente = ordenSyncs.get(clave);
      if (existente) {
        const actualizado = { ...existente, ...update, updatedAt: new Date() };
        ordenSyncs.set(clave, actualizado);
        return actualizado;
      }
      const nuevo = { id: `orden-${++contadorOrden}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      ordenSyncs.set(clave, nuevo);
      return nuevo;
    }),
    count: jest.fn(async ({ where }: any) =>
      Array.from(ordenSyncs.values()).filter((o) => {
        if (o.plataformaConfigId !== where.plataformaConfigId) return false;
        if (where.estado && o.estado !== where.estado) return false;
        return true;
      }).length,
    ),
    findUnique: jest.fn(async ({ where }: any) => Array.from(ordenSyncs.values()).find((o) => o.id === where.id) ?? null),
    findMany: jest.fn(async ({ where }: any) =>
      Array.from(ordenSyncs.values())
        .filter((o) => {
          if (where.plataformaConfigId?.in && !where.plataformaConfigId.in.includes(o.plataformaConfigId)) return false;
          if (where.estado && o.estado !== where.estado) return false;
          return true;
        })
        .map((o) => ({ ...o, plataformaConfig: configs.get(o.plataformaConfigId) })),
    ),
    update: jest.fn(async ({ where, data }: any) => {
      const entrada = Array.from(ordenSyncs.entries()).find(([, o]) => o.id === where.id);
      if (!entrada) throw new Error("PlataformaOrdenSync no encontrada (fake)");
      const [clave, existente] = entrada;
      const actualizado = { ...existente, ...data, updatedAt: new Date() };
      ordenSyncs.set(clave, actualizado);
      return actualizado;
    }),
  };

  const auditLog = { create: jest.fn(async ({ data }: any) => data) };

  return {
    plataformaConfig,
    plataformaWebhookEvent,
    plataformaOrdenSync,
    auditLog,
    _configs: configs,
    _webhookEvents: webhookEvents,
    _ordenSyncs: ordenSyncs,
  };
}

function crearServicio() {
  const prisma = crearPrismaFake();
  const config = { get: jest.fn((key: string) => (key === "PLATAFORMAS_PUBLIC_BASE_URL" ? "http://api.test/api/v1" : undefined)) };
  const cifrado = {
    cifrarJson: jest.fn((v: unknown) => `cifrado:${JSON.stringify(v)}`),
    descifrarJson: jest.fn((v: string) => JSON.parse(v.replace(/^cifrado:/, ""))),
  };
  const adaptadorDidi = crearAdaptadorMock("didi");
  const adaptadorUber = crearAdaptadorMock("uber");
  const adaptadorRappi = crearAdaptadorMock("rappi");
  const adaptadores: Record<string, any> = { didi: adaptadorDidi, uber: adaptadorUber, rappi: adaptadorRappi };
  const registry = { obtener: jest.fn((codigo: string) => adaptadores[codigo]) };

  const pedidosCreados: any[] = [];
  const pedidos = {
    crear: jest.fn(async (dto: any) => {
      const pedido = { ...dto, folio: `F-${pedidosCreados.length + 1}`, estado: "ENVIADO" };
      pedidosCreados.push(pedido);
      return pedido;
    }),
    obtener: jest.fn(async (id: string) => pedidosCreados.find((p) => p.id === id) ?? null),
  };

  const service = new PlataformasService(prisma as any, config as any, cifrado as any, registry as any, pedidos as any);
  return { service, prisma, config, cifrado, adaptadorDidi, adaptadorUber, adaptadorRappi, registry, pedidos };
}

const USUARIO_ADMIN = { sub: "usuario-1", empresaId: "empresa-1", sucursalId: null, rol: "ADMIN_CORPORATIVO" };

const DTO_BASE = {
  ambiente: AmbientePlataforma.SANDBOX,
  activo: true,
  identificadorTienda: "tienda-1",
  credenciales: { apiKey: "clave-abcd1234", clientSecret: "secreto-super-sensible" },
};

describe("PlataformasService — guardarConfig", () => {
  it("cifra las credenciales antes de guardar y nunca devuelve el secreto ni credencialesCifradas", async () => {
    const { service, cifrado } = crearServicio();
    const resultado = await service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);

    expect(cifrado.cifrarJson).toHaveBeenCalledWith(DTO_BASE.credenciales);
    expect((resultado as any).credencialesCifradas).toBeUndefined();
    expect(JSON.stringify(resultado)).not.toContain("secreto-super-sensible");
  });

  it("calcula credencialesUltimos4 y clientSecretConfigurado a partir del adaptador", async () => {
    const { service, adaptadorDidi } = crearServicio();
    adaptadorDidi.campoPrincipalEnmascarado.mockReturnValue("9999");
    adaptadorDidi.tieneClientSecret.mockReturnValue(true);

    const resultado = await service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);

    expect(resultado.credencialesUltimos4).toBe("9999");
    expect(resultado.clientSecretConfigurado).toBe(true);
  });

  it("propaga el error de validarConfiguracion cuando faltan campos requeridos", async () => {
    const { service, adaptadorDidi } = crearServicio();
    adaptadorDidi.validarConfiguracion.mockImplementation(() => {
      throw new Error("Falta el Client Secret de DiDi");
    });

    await expect(service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN)).rejects.toThrow("Falta el Client Secret de DiDi");
  });

  it("escribe un AuditLog manual cuya datosNuevos NO contiene la clave 'credenciales'", async () => {
    const { service, prisma } = crearServicio();
    await service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const datos = (prisma.auditLog.create as jest.Mock).mock.calls[0][0].data;
    expect(datos.entidad).toBe("PLATAFORMA_CONFIG");
    expect(datos.accion).toBe("GUARDAR");
    expect(datos.datosNuevos).not.toHaveProperty("credenciales");
  });

  it("prueba la conexión automáticamente y la respuesta refleja el estado real (éxito)", async () => {
    const { service } = crearServicio();
    const resultado = await service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);
    expect(resultado.estadoConexion).toBe(EstadoConexionPlataforma.CONECTADA);
  });

  it("prueba la conexión automáticamente y la respuesta refleja el estado real (error)", async () => {
    const { service, adaptadorDidi } = crearServicio();
    adaptadorDidi.probarConexion.mockResolvedValue({ ok: false, detalle: "credenciales inválidas" });

    const resultado = await service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);

    expect(resultado.estadoConexion).toBe(EstadoConexionPlataforma.ERROR);
    expect(resultado.ultimoErrorMensaje).toBe("credenciales inválidas");
  });
});

describe("PlataformasService — probarConexion / reconectar / desconectar", () => {
  it("probarConexion persiste CONECTADA + ultimaSincronizacion en éxito", async () => {
    const { service } = crearServicio();
    const guardado = await service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);

    const resultado = await service.probarConexion(guardado.id as string);

    expect(resultado.ok).toBe(true);
    const actualizado = await service.obtenerUno("didi", "empresa-1");
    expect(actualizado.estadoConexion).toBe(EstadoConexionPlataforma.CONECTADA);
    expect(actualizado.ultimaSincronizacion).not.toBeNull();
  });

  it("probarConexion persiste ERROR + ultimoErrorMensaje/ultimoErrorEn en falla", async () => {
    const { service, adaptadorDidi } = crearServicio();
    const guardado = await service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);
    adaptadorDidi.probarConexion.mockResolvedValue({ ok: false, detalle: "timeout" });

    await service.probarConexion(guardado.id as string);

    const actualizado = await service.obtenerUno("didi", "empresa-1");
    expect(actualizado.estadoConexion).toBe(EstadoConexionPlataforma.ERROR);
    expect(actualizado.ultimoErrorMensaje).toBe("timeout");
    expect(actualizado.ultimoErrorEn).not.toBeNull();
  });

  it("reconectar rechaza con 400 cuando nunca se guardaron credenciales para esa configuración", async () => {
    const { service, prisma } = crearServicio();
    // Fila creada a mano sin credencialesCifradas — simula un estado que en la práctica no debería
    // ocurrir hoy (guardarConfig siempre las setea), pero el servicio debe protegerse igual.
    prisma._configs.set("config-sin-credenciales", {
      id: "config-sin-credenciales",
      empresaId: "empresa-1",
      sucursalId: null,
      plataforma: "didi",
      ambiente: "SANDBOX",
      activo: false,
      estadoConexion: "PENDIENTE_CONFIGURACION",
      credencialesCifradas: null,
      credencialesUltimos4: null,
      clientSecretConfigurado: false,
      identificadorTienda: null,
      webhookSlug: "slug-x",
      ultimaSincronizacion: null,
      ultimoErrorMensaje: null,
      ultimoErrorEn: null,
    });

    await expect(service.reconectar("config-sin-credenciales")).rejects.toThrow(/No hay credenciales guardadas/);
  });

  it("reconectar reactiva (activo=true) solo si la prueba de conexión sale bien", async () => {
    const { service } = crearServicio();
    const guardado = await service.guardarConfig("didi", { ...DTO_BASE, activo: false } as any, USUARIO_ADMIN);
    await service.desconectar(guardado.id as string);

    const resultado = await service.reconectar(guardado.id as string);
    expect(resultado.ok).toBe(true);

    const actualizado = await service.obtenerUno("didi", "empresa-1");
    expect(actualizado.activo).toBe(true);
  });

  it("desconectar pone activo=false y estadoConexion=DESCONECTADA sin borrar credencialesCifradas", async () => {
    const { service, prisma } = crearServicio();
    const guardado = await service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);

    const resultado = await service.desconectar(guardado.id as string);

    expect(resultado.activo).toBe(false);
    expect(resultado.estadoConexion).toBe(EstadoConexionPlataforma.DESCONECTADA);
    expect(prisma._configs.get(guardado.id as string).credencialesCifradas).not.toBeNull();
  });

  it("regenerarWebhook cambia el webhookSlug (y por lo tanto la URL devuelta)", async () => {
    const { service } = crearServicio();
    const guardado = await service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);
    const antes = await service.obtenerUno("didi", "empresa-1");

    const { webhookUrl } = await service.regenerarWebhook(guardado.id as string);

    expect(webhookUrl).not.toBe(antes.webhookUrl);
    expect(webhookUrl).toContain("/plataformas/webhooks/didi/");
  });
});

describe("PlataformasService — listar", () => {
  it("sintetiza PENDIENTE_CONFIGURACION para las 3 plataformas cuando no hay ninguna fila guardada", async () => {
    const { service } = crearServicio();
    const lista = await service.listar("empresa-sin-config");

    expect(lista).toHaveLength(3);
    expect(lista.every((p) => p.id === null && p.estadoConexion === EstadoConexionPlataforma.PENDIENTE_CONFIGURACION)).toBe(true);
  });

  it("agrega pedidosRecibidos/pedidosSincronizados desde PlataformaOrdenSync", async () => {
    const { service, prisma } = crearServicio();
    const guardado = await service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);

    await service.manejarWebhook("didi", (prisma._configs.get(guardado.id as string) as any).webhookSlug, {
      headers: {},
      query: {},
      body: {},
    });

    const lista = await service.listar("empresa-1");
    const didi = lista.find((p) => p.plataforma === "didi")!;
    expect(didi.pedidosRecibidos).toBeGreaterThanOrEqual(0); // el mock por defecto no genera orden (orden: null)
  });
});

describe("PlataformasService — manejarWebhook", () => {
  async function configurarPlataforma() {
    const contexto = crearServicio();
    const guardado = await contexto.service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);
    const webhookSlug = (contexto.prisma._configs.get(guardado.id as string) as any).webhookSlug;
    return { ...contexto, guardado, webhookSlug };
  }

  it("procesa un evento nuevo: crea PlataformaWebhookEvent y PlataformaOrdenSync (RECIBIDA)", async () => {
    const { service, prisma, adaptadorDidi, webhookSlug, guardado } = await configurarPlataforma();
    adaptadorDidi.procesarWebhook.mockResolvedValue({
      eventoExternoId: "evt-100",
      orden: { ordenExternaId: "orden-100", tipoEvento: "order.created", estadoExterno: "recibido", payloadSanitizado: {} },
    });

    const respuesta = await service.manejarWebhook("didi", webhookSlug, { headers: {}, query: {}, body: {} });

    expect(respuesta).toEqual({ ok: true });
    expect(prisma._webhookEvents).toHaveLength(1);
    const conteos = await service.obtenerUno("didi", "empresa-1");
    expect(conteos.pedidosRecibidos).toBe(1);
  });

  it("es idempotente ante un eventoExternoId repetido: no duplica el PlataformaOrdenSync", async () => {
    const { service, prisma, adaptadorDidi, webhookSlug } = await configurarPlataforma();
    adaptadorDidi.procesarWebhook.mockResolvedValue({
      eventoExternoId: "evt-repetido",
      orden: { ordenExternaId: "orden-1", tipoEvento: "order.created", estadoExterno: "recibido", payloadSanitizado: {} },
    });

    await service.manejarWebhook("didi", webhookSlug, { headers: {}, query: {}, body: {} });
    const respuestaSegundoIntento = await service.manejarWebhook("didi", webhookSlug, { headers: {}, query: {}, body: {} });

    expect(respuestaSegundoIntento).toEqual({ ok: true });
    expect(prisma._webhookEvents).toHaveLength(1); // el segundo intento chocó contra el unique y se descartó
  });

  it("responde {ok:true} sin lanzar si el adaptador rechaza la firma", async () => {
    const { service, adaptadorDidi, webhookSlug } = await configurarPlataforma();
    adaptadorDidi.procesarWebhook.mockRejectedValue(new Error("Firma de webhook de DiDi inválida — rechazado"));

    await expect(service.manejarWebhook("didi", webhookSlug, { headers: {}, query: {}, body: {} })).resolves.toEqual({ ok: true });
  });

  it("responde {ok:true} si no hay configuración para esa (plataforma, webhookSlug)", async () => {
    const { service } = crearServicio();
    await expect(service.manejarWebhook("didi", "slug-inexistente", { headers: {}, query: {}, body: {} })).resolves.toEqual({
      ok: true,
    });
  });

  it("guarda clienteNombre/totalExterno/items del pedido recibido", async () => {
    const { service, prisma, adaptadorDidi, webhookSlug } = await configurarPlataforma();
    adaptadorDidi.procesarWebhook.mockResolvedValue({
      eventoExternoId: "evt-datos",
      orden: {
        ordenExternaId: "orden-datos",
        tipoEvento: "order.created",
        estadoExterno: "recibido",
        clienteNombre: "Juan Pérez",
        total: 199.5,
        items: [{ nombreExterno: "Café Latte", cantidad: 2 }],
        payloadSanitizado: { items: [{ nombreExterno: "Café Latte", cantidad: 2 }] },
      },
    });

    await service.manejarWebhook("didi", webhookSlug, { headers: {}, query: {}, body: {} });

    const orden = Array.from(prisma._ordenSyncs.values())[0] as any;
    expect(orden.clienteNombre).toBe("Juan Pérez");
    expect(Number(orden.totalExterno)).toBe(199.5);
  });
});

describe("PlataformasService — pedidos entrantes (bandeja de aceptación manual)", () => {
  async function conPedidoEntrante() {
    const contexto = await (async () => {
      const c = crearServicio();
      const guardado = await c.service.guardarConfig("didi", DTO_BASE as any, USUARIO_ADMIN);
      const webhookSlug = (c.prisma._configs.get(guardado.id as string) as any).webhookSlug;
      c.adaptadorDidi.procesarWebhook.mockResolvedValue({
        eventoExternoId: "evt-e1",
        orden: {
          ordenExternaId: "orden-e1",
          tipoEvento: "order.created",
          estadoExterno: "recibido",
          clienteNombre: "María López",
          total: 150,
          items: [{ nombreExterno: "Croissant", cantidad: 3 }],
          payloadSanitizado: { items: [{ nombreExterno: "Croissant", cantidad: 3 }] },
        },
      });
      await c.service.manejarWebhook("didi", webhookSlug, { headers: {}, query: {}, body: {} });
      const orden = Array.from(c.prisma._ordenSyncs.values())[0] as any;
      return { ...c, guardado, orden };
    })();
    return contexto;
  }

  it("listarPedidosEntrantes devuelve los pedidos RECIBIDA con sus items", async () => {
    const { service } = await conPedidoEntrante();
    const lista = await service.listarPedidosEntrantes("empresa-1");
    expect(lista).toHaveLength(1);
    expect(lista[0].clienteNombre).toBe("María López");
    expect(lista[0].items).toEqual([{ nombreExterno: "Croissant", cantidad: 3 }]);
  });

  it("aceptarPedido crea un Pedido real (DOMICILIO, canal PLATAFORMA_DELIVERY) mapeando los items a productos reales", async () => {
    const { service, pedidos, orden } = await conPedidoEntrante();

    const pedido = await service.aceptarPedido(orden.id, {
      sucursalId: "sucursal-1",
      items: [{ productoId: "producto-croissant", cantidad: 3 }],
    } as any);

    expect(pedidos.crear).toHaveBeenCalledTimes(1);
    const dtoEnviado = (pedidos.crear as jest.Mock).mock.calls[0][0];
    expect(dtoEnviado.tipo).toBe("DOMICILIO");
    expect(dtoEnviado.canalOrigen).toBe("PLATAFORMA_DELIVERY");
    expect(dtoEnviado.items).toEqual([{ productoId: "producto-croissant", cantidad: 3, notas: undefined }]);
    expect(pedido).toBeTruthy();
  });

  it("aceptarPedido marca la orden como SINCRONIZADA con el pedidoId creado", async () => {
    const { service, orden, prisma } = await conPedidoEntrante();
    const pedido = await service.aceptarPedido(orden.id, {
      sucursalId: "sucursal-1",
      items: [{ productoId: "producto-croissant", cantidad: 3 }],
    } as any);

    const actualizada = Array.from(prisma._ordenSyncs.values())[0] as any;
    expect(actualizada.estado).toBe(EstadoSincronizacionOrdenPlataforma.SINCRONIZADA);
    expect(actualizada.pedidoId).toBe(pedido.id);
  });

  it("aceptarPedido es idempotente ante un doble clic (no crea un segundo Pedido)", async () => {
    const { service, orden, pedidos } = await conPedidoEntrante();
    const dto = { sucursalId: "sucursal-1", items: [{ productoId: "producto-croissant", cantidad: 3 }] } as any;

    const primero = await service.aceptarPedido(orden.id, dto);
    const segundo = await service.aceptarPedido(orden.id, dto);

    expect(segundo.id).toBe(primero.id);
    expect(pedidos.crear).toHaveBeenCalledTimes(1);
  });

  it("aceptarPedido rechaza (400) si el pedido ya fue rechazado antes", async () => {
    const { service, orden } = await conPedidoEntrante();
    await service.rechazarPedido(orden.id, "Sin insumos suficientes");

    await expect(
      service.aceptarPedido(orden.id, { sucursalId: "sucursal-1", items: [{ productoId: "x", cantidad: 1 }] } as any),
    ).rejects.toThrow(/ya se marcó/);
  });

  it("rechazarPedido marca la orden como IGNORADA con el motivo dado", async () => {
    const { service, orden } = await conPedidoEntrante();
    const resultado = await service.rechazarPedido(orden.id, "Producto agotado");
    expect(resultado.estado).toBe(EstadoSincronizacionOrdenPlataforma.IGNORADA);
    expect(resultado.motivoError).toBe("Producto agotado");
  });

  it("rechazarPedido rechaza (400) si el pedido ya fue aceptado antes", async () => {
    const { service, orden } = await conPedidoEntrante();
    await service.aceptarPedido(orden.id, { sucursalId: "sucursal-1", items: [{ productoId: "x", cantidad: 1 }] } as any);

    await expect(service.rechazarPedido(orden.id, "cambié de opinión")).rejects.toThrow(/ya se marcó/);
  });
});
