import { RolUsuario } from "@hangar421/shared";
import { GRUPOS_PERMISOS, PERMISOS_TERMINAL as P, leerPermisosGuardados, permisosEfectivos, tienePermiso } from "./permisosTerminal";

describe("permisosEfectivos", () => {
  it("un administrador lo tiene todo aunque tenga una lista guardada", () => {
    const todos = Object.values(P);
    expect(permisosEfectivos(RolUsuario.ADMIN_SUCURSAL, []).size).toBe(todos.length);
    expect(permisosEfectivos(RolUsuario.ADMIN_CORPORATIVO, null).size).toBe(todos.length);
  });

  it("sin personalizar, un cajero conserva lo que ya podía hacer y solo entra a Admin para Promociones", () => {
    const cajero = permisosEfectivos(RolUsuario.CAJERO, null);
    for (const p of [P.VENTA_COBRAR, P.VENTA_CORTESIA, P.VENTA_CANCELAR, P.CAJA_ABRIR, P.CAJA_MOVIMIENTOS, P.CAJA_CERRAR, P.ERP_SUBIR, P.VENTAS_CONSULTAR]) {
      expect(cajero.has(p)).toBe(true);
    }
    // Todos los roles pueden crear promociones; ninguna otra sección de Admin se abre sola.
    expect(cajero.has(P.ADMIN_PROMOCIONES)).toBe(true);
    expect([...cajero].filter((p) => p.startsWith("admin:"))).toEqual([P.ADMIN_PROMOCIONES]);
  });

  it("un administrador puede quitarle Promociones a alguien", () => {
    expect(permisosEfectivos(RolUsuario.CAJERO, [P.VENTA_COBRAR]).has(P.ADMIN_PROMOCIONES)).toBe(false);
  });

  it("una lista guardada manda sobre el rol, aunque esté vacía", () => {
    expect(permisosEfectivos(RolUsuario.CAJERO, []).size).toBe(0);
    expect([...permisosEfectivos(RolUsuario.CAJERO, [P.ADMIN_INVENTARIO])]).toEqual([P.ADMIN_INVENTARIO]);
  });

  it("ignora claves desconocidas de otra versión", () => {
    expect([...permisosEfectivos(RolUsuario.CAJERO, ["algo:futuro", P.VENTA_COBRAR])]).toEqual([P.VENTA_COBRAR]);
  });
});

describe("tienePermiso", () => {
  it("sin sesión no hay permiso", () => {
    expect(tienePermiso(null, P.VENTA_COBRAR)).toBe(false);
  });

  it("respeta lo personalizado", () => {
    const u = { rol: RolUsuario.CAJERO, permisos: [P.VENTA_COBRAR] };
    expect(tienePermiso(u, P.VENTA_COBRAR)).toBe(true);
    expect(tienePermiso(u, P.CAJA_CERRAR)).toBe(false);
  });
});

describe("leerPermisosGuardados", () => {
  it("null o basura vuelven a los del rol", () => {
    expect(leerPermisosGuardados(null)).toBeNull();
    expect(leerPermisosGuardados("{no es json")).toBeNull();
    expect(leerPermisosGuardados('{"a":1}')).toBeNull();
  });

  it("lee la lista guardada", () => {
    expect(leerPermisosGuardados('["venta:cobrar"]')).toEqual(["venta:cobrar"]);
  });
});

it("todas las funciones aparecen una sola vez en la pantalla de usuarios", () => {
  const enPantalla = GRUPOS_PERMISOS.flatMap((g) => g.permisos.map((p) => p.clave));
  expect(new Set(enPantalla).size).toBe(enPantalla.length);
  expect(new Set(enPantalla)).toEqual(new Set(Object.values(P)));
});
