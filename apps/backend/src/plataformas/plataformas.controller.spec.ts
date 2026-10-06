// Prueba de permisos a nivel metadata: como el repo no usa @nestjs/testing para levantar un
// árbol de guards real en specs (ver pagos.service.spec.ts), esta verifica directamente que cada
// ruta administrativa declare @Roles(ADMIN_CORPORATIVO, ADMIN_SUCURSAL) y que la ruta de webhook
// declare @Public() — exactamente lo que RolesGuard/JwtAuthGuard leen en tiempo de ejecución
// (ver common/guards/roles.guard.ts, common/guards/jwt-auth.guard.ts).

import "reflect-metadata";
import { RolUsuario } from "@hangar421/shared";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";
import { PlataformasController } from "./plataformas.controller";

const RUTAS_ADMIN = [
  "listar",
  "obtenerUno",
  "guardarConfig",
  "probarConexion",
  "reconectar",
  "desconectar",
  "regenerarWebhook",
  "simularPedido",
] as const;

/** Revisar/aceptar/rechazar pedidos: también caja y supervisión (no pueden tocar credenciales). */
const RUTAS_PEDIDOS = ["listarPedidosEntrantes", "listarEventosConError", "obtenerPedidoEntrante", "aceptarPedido", "rechazarPedido"] as const;

describe("PlataformasController — permisos", () => {
  it.each(RUTAS_ADMIN)("%s exige exactamente ADMIN_CORPORATIVO/ADMIN_SUCURSAL", (metodo) => {
    const roles = Reflect.getMetadata(ROLES_KEY, PlataformasController.prototype[metodo]);
    expect(roles).toEqual([RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL]);
  });

  it.each(RUTAS_PEDIDOS)("%s permite admin, supervisor y cajero (no mesero ni cocina)", (metodo) => {
    const roles = Reflect.getMetadata(ROLES_KEY, PlataformasController.prototype[metodo]);
    expect(roles).toEqual([RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL, RolUsuario.SUPERVISOR, RolUsuario.CAJERO]);
  });

  it.each([...RUTAS_ADMIN, ...RUTAS_PEDIDOS])("%s NO está marcado @Public()", (metodo) => {
    const esPublico = Reflect.getMetadata(IS_PUBLIC_KEY, PlataformasController.prototype[metodo]);
    expect(esPublico).not.toBe(true);
  });

  it("webhook está marcado @Public() (ninguna plataforma manda JWT)", () => {
    const esPublico = Reflect.getMetadata(IS_PUBLIC_KEY, PlataformasController.prototype.webhook);
    expect(esPublico).toBe(true);
  });

  it("webhook NO exige roles (sería inalcanzable — no hay usuario autenticado en la request)", () => {
    const roles = Reflect.getMetadata(ROLES_KEY, PlataformasController.prototype.webhook);
    expect(roles).toBeUndefined();
  });
});
