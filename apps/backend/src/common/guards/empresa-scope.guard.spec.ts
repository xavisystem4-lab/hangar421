import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { EmpresaScopeGuard } from "./empresa-scope.guard";

const EMPRESA_PROPIA = "empresa-propia";
const EMPRESA_AJENA = "empresa-ajena";

function contextoHttp(request: any): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function crearGuard(esPublico = false): EmpresaScopeGuard {
  const reflector = { getAllAndOverride: () => esPublico } as unknown as Reflector;
  return new EmpresaScopeGuard(reflector);
}

const sesion = { sub: "u1", empresaId: EMPRESA_PROPIA, rol: "ADMIN_CORPORATIVO" };

describe("EmpresaScopeGuard", () => {
  it("deja pasar el empresaId propio por query", () => {
    const ctx = contextoHttp({ user: sesion, query: { empresaId: EMPRESA_PROPIA } });
    expect(crearGuard().canActivate(ctx)).toBe(true);
  });

  it("rechaza el empresaId de otra empresa por query — la fuga que cierra este guard", () => {
    const ctx = contextoHttp({ user: sesion, query: { empresaId: EMPRESA_AJENA } });
    expect(() => crearGuard().canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("rechaza también por body (altas: productos, usuarios, sucursales)", () => {
    const ctx = contextoHttp({ user: sesion, body: { empresaId: EMPRESA_AJENA, nombre: "X" } });
    expect(() => crearGuard().canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("rechaza también por params — es como llega en /empresas/:empresaId", () => {
    const ctx = contextoHttp({ user: sesion, params: { empresaId: EMPRESA_AJENA } });
    expect(() => crearGuard().canActivate(ctx)).toThrow(ForbiddenException);
  });

  // ADMIN_CORPORATIVO es transversal sobre las SUCURSALES de su empresa, no sobre otras
  // empresas — por eso este guard no lo exime, a diferencia de RolesGuard.
  it("no exime a ADMIN_CORPORATIVO de su propia empresa", () => {
    const ctx = contextoHttp({ user: { ...sesion, rol: "ADMIN_CORPORATIVO" }, query: { empresaId: EMPRESA_AJENA } });
    expect(() => crearGuard().canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("deja pasar lo que no declara empresa — el endpoint no está acotado por empresa", () => {
    const ctx = contextoHttp({ user: sesion, query: {}, body: {}, params: {} });
    expect(crearGuard().canActivate(ctx)).toBe(true);
  });

  it("trata el string vacío como 'no declarada' y no como una empresa distinta", () => {
    const ctx = contextoHttp({ user: sesion, query: { empresaId: "" } });
    expect(crearGuard().canActivate(ctx)).toBe(true);
  });

  it("rechaza si la sesión no tiene empresa pero la petición sí la declara", () => {
    const ctx = contextoHttp({ user: { sub: "u1" }, query: { empresaId: EMPRESA_PROPIA } });
    expect(() => crearGuard().canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("no toca las rutas @Public() (login, health, webhooks: no hay sesión que comparar)", () => {
    const ctx = contextoHttp({ query: { empresaId: EMPRESA_AJENA } });
    expect(crearGuard(true).canActivate(ctx)).toBe(true);
  });

  // Los guards globales corren también sobre el gateway de Socket.IO (cocina, meseros), donde
  // no hay petición HTTP que inspeccionar.
  it("no se aplica fuera de HTTP", () => {
    const ctx = { getType: () => "ws" } as unknown as ExecutionContext;
    expect(crearGuard().canActivate(ctx)).toBe(true);
  });
});
