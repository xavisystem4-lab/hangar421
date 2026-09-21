import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { EstadoSolicitudProducto, RolUsuario } from "@hangar421/shared";
import { SolicitudesProductoService, normalizarTexto } from "./solicitudes-producto.service";

/** Mocks simples de Prisma, igual que sync.service.spec.ts: lo que se prueba son las reglas del
 *  servicio (idempotencia, atribución, alcance), no el ORM. */
function crearServicio(opciones: { existentes?: Record<string, any>; usuarios?: string[]; productos?: Record<string, string> } = {}) {
  const creadas: any[] = [];
  const actualizadas: any[] = [];
  const prisma = {
    solicitudProducto: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(opciones.existentes?.[id] ?? null)),
      create: jest.fn(({ data }: any) => { creadas.push(data); return Promise.resolve(data); }),
      update: jest.fn(({ data }: any) => { actualizadas.push(data); return Promise.resolve(data); }),
    },
    usuario: { findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(opciones.usuarios?.includes(id) ? { id } : null)) },
    producto: {
      findUnique: jest.fn(({ where: { id } }: any) =>
        Promise.resolve(opciones.productos?.[id] ? { empresaId: opciones.productos[id] } : null),
      ),
    },
    // resolverDispositivoId: huella nueva → la da de alta.
    dispositivo: {
      findUnique: jest.fn(() => Promise.resolve(null)),
      create: jest.fn(() => Promise.resolve({ id: "disp-1" })),
    },
  };
  return { servicio: new SolicitudesProductoService(prisma as any), creadas, actualizadas };
}

const BASE = { id: "s-1", empresaId: "emp-1", sucursalId: "suc-1", usuarioId: "u-1", dispositivoHuella: "tablet-1", texto: "Chai latte de avena" };

describe("SolicitudesProductoService.crear", () => {
  it("guarda texto, usuario, sucursal, dispositivo y la hora real de la terminal", async () => {
    const { servicio, creadas } = crearServicio({ usuarios: ["u-1"] });
    const solicitadaEn = new Date("2026-09-21T15:30:00Z");
    await servicio.crear({ ...BASE, solicitadaEn });
    expect(creadas[0]).toEqual({
      id: "s-1", empresaId: "emp-1", sucursalId: "suc-1", usuarioId: "u-1", dispositivoId: "disp-1", texto: "Chai latte de avena", solicitadaEn,
    });
  });

  it("un usuario que aún no llega al ERP no hace perder la solicitud", async () => {
    const { servicio, creadas } = crearServicio({ usuarios: [] });
    await servicio.crear(BASE);
    expect(creadas[0].usuarioId).toBeNull();
  });

  it("reenviar la misma solicitud no la duplica", async () => {
    const { servicio, creadas } = crearServicio({ existentes: { "s-1": { id: "s-1", sucursalId: "suc-1" } } });
    await servicio.crear(BASE);
    expect(creadas).toHaveLength(0);
  });

  it("no deja reutilizar el id de una solicitud de otra sucursal", async () => {
    const { servicio } = crearServicio({ existentes: { "s-1": { id: "s-1", sucursalId: "suc-2" } } });
    await expect(servicio.crear(BASE)).rejects.toBeInstanceOf(ConflictException);
  });

  it("rechaza un texto vacío", async () => {
    const { servicio } = crearServicio();
    await expect(servicio.crear({ ...BASE, texto: "   " })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("SolicitudesProductoService.resolver", () => {
  const admin = { sub: "admin-1", empresaId: "emp-1", sucursalId: "suc-1", rol: RolUsuario.ADMIN_SUCURSAL };
  const pendiente = { id: "s-1", empresaId: "emp-1", sucursalId: "suc-1", estado: "PENDIENTE" };

  it("marca atendida con el producto con que se resolvió y quién lo hizo", async () => {
    const { servicio, actualizadas } = crearServicio({ existentes: { "s-1": pendiente }, productos: { "p-1": "emp-1" } });
    await servicio.resolver("s-1", admin, { estado: EstadoSolicitudProducto.ATENDIDA, productoId: "p-1" });
    expect(actualizadas[0]).toMatchObject({ estado: "ATENDIDA", resueltaPorId: "admin-1", productoId: "p-1" });
  });

  it("no acepta un producto de otra empresa", async () => {
    const { servicio } = crearServicio({ existentes: { "s-1": pendiente }, productos: { "p-ajeno": "emp-2" } });
    await expect(servicio.resolver("s-1", admin, { estado: EstadoSolicitudProducto.ATENDIDA, productoId: "p-ajeno" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("un admin de sucursal no resuelve solicitudes de otra sucursal; el corporativo sí", async () => {
    const { servicio } = crearServicio({ existentes: { "s-1": { ...pendiente, sucursalId: "suc-2" } } });
    await expect(servicio.resolver("s-1", admin, { estado: EstadoSolicitudProducto.DESCARTADA })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      servicio.resolver("s-1", { ...admin, rol: RolUsuario.ADMIN_CORPORATIVO }, { estado: EstadoSolicitudProducto.DESCARTADA }),
    ).resolves.toBeDefined();
  });

  it("una solicitud de otra empresa no existe para esta sesión", async () => {
    const { servicio } = crearServicio({ existentes: { "s-1": { ...pendiente, empresaId: "emp-2" } } });
    await expect(servicio.resolver("s-1", admin, { estado: EstadoSolicitudProducto.DESCARTADA })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("solo se resuelve como atendida o descartada", async () => {
    const { servicio } = crearServicio({ existentes: { "s-1": pendiente } });
    await expect(servicio.resolver("s-1", admin, { estado: EstadoSolicitudProducto.PENDIENTE })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("normalizarTexto", () => {
  it("colapsa espacios y recorta el largo", () => {
    expect(normalizarTexto("  Chai   latte  ")).toBe("Chai latte");
    expect(normalizarTexto("x".repeat(500))).toHaveLength(120);
    expect(normalizarTexto(42)).toBe("");
  });
});
