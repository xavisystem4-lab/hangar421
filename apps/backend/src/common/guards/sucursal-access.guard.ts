import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { RolUsuario } from "@hangar421/shared";

/**
 * Verifica que la sucursal referida en `params.sucursalId` (o `body.sucursalId`) coincida
 * con la sucursal activa de la sesión del usuario — evita que un dispositivo/usuario de una
 * sucursal opere sobre datos de otra. ADMIN_CORPORATIVO queda exento (visión global).
 */
@Injectable()
export class SucursalAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return false;
    if (user.rol === RolUsuario.ADMIN_CORPORATIVO) return true;

    const sucursalId =
      request.params?.sucursalId ?? request.body?.sucursalId ?? request.query?.sucursalId;

    if (!sucursalId) return true; // el endpoint no está scoped por sucursal
    if (sucursalId !== user.sucursalId) {
      throw new ForbiddenException("No tienes acceso a esta sucursal");
    }
    return true;
  }
}
