import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolUsuario } from "@hangar421/shared";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { SUCURSAL_LIBRE_KEY } from "../decorators/sucursal-libre.decorator";

/**
 * Verifica que la sucursal referida en `params.sucursalId` (o `body`/`query`) coincida con la
 * sucursal activa de la sesión — evita que un dispositivo/usuario de una sucursal opere sobre
 * datos de otra. ADMIN_CORPORATIVO queda exento (visión global sobre las sucursales de su
 * empresa; el alcance entre empresas lo cierra EmpresaScopeGuard, que a él no lo exime).
 *
 * Es global (ver app.module.ts). Puede serlo sin romper nada porque:
 *  - Solo rechaza cuando la petición NOMBRA una sucursal distinta de la activa. Los endpoints
 *    acotados únicamente por empresa (catálogo central, por ejemplo) no declaran `sucursalId` y
 *    pasan sin comprobación, que es el comportamiento correcto para ellos.
 *  - Todo access token en circulación tiene una sucursal activa válida: el login nunca emite uno
 *    sin resolverla (ver AuthService.resolverSucursalActiva), y cambiar de sucursal exige pasar
 *    por `POST /auth/switch-sucursal`, que revalida el acceso contra `UsuarioSucursal`.
 *
 * Ese segundo invariante es la razón por la que este guard NO se conectó junto a
 * EmpresaScopeGuard: mientras el login podía dejar sesiones sin sucursal resuelta, activarlo
 * habría roto el enlace del APK sin darle recambio.
 */
@Injectable()
export class SucursalAccessGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Igual que EmpresaScopeGuard: los guards globales corren también sobre el gateway de
    // Socket.IO, donde no hay petición HTTP que inspeccionar.
    if (context.getType() !== "http") return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // `POST /auth/switch-sucursal` nombra por definición una sucursal distinta de la activa —
    // sin esta exención el guard haría imposible cambiar de sucursal (ver SucursalLibre).
    const sucursalLibre = this.reflector.getAllAndOverride<boolean>(SUCURSAL_LIBRE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (sucursalLibre) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return false;
    if (user.rol === RolUsuario.ADMIN_CORPORATIVO) return true;

    const sucursalId =
      request.params?.sucursalId ?? request.body?.sucursalId ?? request.query?.sucursalId;

    if (!sucursalId) return true; // el endpoint no está acotado por sucursal
    if (sucursalId !== user.sucursalId) {
      throw new ForbiddenException("No tienes acceso a esta sucursal");
    }
    return true;
  }
}
