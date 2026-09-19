import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolUsuario } from "@hangar421/shared";
import { SucursalAccessGuard } from "./sucursal-access.guard";

const SUC_ACTIVA = "suc-activa";
const SUC_AJENA = "suc-ajena";

function contextoHttp(request: any): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** El reflector real devuelve la metadata de @Public()/@SucursalLibre() según la clave pedida. */
function crearGuard(marcas: { publico?: boolean; sucursalLibre?: boolean } = {}): SucursalAccessGuard {
  const reflector = {
    getAllAndOverride: (clave: string) => (clave === "isPublic" ? !!marcas.publico : !!marcas.sucursalLibre),
  } as unknown as Reflector;
  return new SucursalAccessGuard(reflector);
}

const cajero = { sub: "u1", empresaId: "e1", sucursalId: SUC_ACTIVA, rol: RolUsuario.CAJERO };

describe("SucursalAccessGuard", () => {
  it("deja pasar la sucursal activa de la sesión", () => {
    expect(crearGuard().canActivate(contextoHttp({ user: cajero, query: { sucursalId: SUC_ACTIVA } }))).toBe(true);
  });

  it("rechaza operar sobre otra sucursal", () => {
    const ctx = contextoHttp({ user: cajero, query: { sucursalId: SUC_AJENA } });
    expect(() => crearGuard().canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("rechaza también por body y por params", () => {
    expect(() => crearGuard().canActivate(contextoHttp({ user: cajero, body: { sucursalId: SUC_AJENA } }))).toThrow(ForbiddenException);
    expect(() => crearGuard().canActivate(contextoHttp({ user: cajero, params: { sucursalId: SUC_AJENA } }))).toThrow(ForbiddenException);
  });

  it("exime a ADMIN_CORPORATIVO — tiene visión sobre las sucursales de su empresa", () => {
    const admin = { ...cajero, rol: RolUsuario.ADMIN_CORPORATIVO };
    expect(crearGuard().canActivate(contextoHttp({ user: admin, query: { sucursalId: SUC_AJENA } }))).toBe(true);
  });

  // Los endpoints acotados solo por empresa (el catálogo central, por ejemplo) no nombran
  // sucursal; el alcance entre empresas lo cierra EmpresaScopeGuard, no este guard.
  it("deja pasar lo que no nombra ninguna sucursal", () => {
    expect(crearGuard().canActivate(contextoHttp({ user: cajero, query: {}, body: {}, params: {} }))).toBe(true);
  });

  // Sin esta exención el guard se bloquearía a sí mismo: el cuerpo de switch-sucursal lleva por
  // definición una sucursal distinta de la activa.
  it("no bloquea el cambio de sucursal marcado con @SucursalLibre()", () => {
    const ctx = contextoHttp({ user: cajero, body: { sucursalId: SUC_AJENA } });
    expect(crearGuard({ sucursalLibre: true }).canActivate(ctx)).toBe(true);
  });

  it("no toca las rutas @Public()", () => {
    const ctx = contextoHttp({ query: { sucursalId: SUC_AJENA } });
    expect(crearGuard({ publico: true }).canActivate(ctx)).toBe(true);
  });

  it("no se aplica fuera de HTTP (gateway de Socket.IO)", () => {
    expect(crearGuard().canActivate({ getType: () => "ws" } as unknown as ExecutionContext)).toBe(true);
  });

  it("rechaza una petición autenticada sin sesión resuelta", () => {
    expect(crearGuard().canActivate(contextoHttp({ query: { sucursalId: SUC_ACTIVA } }))).toBe(false);
  });
});
