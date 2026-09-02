import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolUsuario } from "@hangar421/shared";
import { ROLES_KEY } from "../decorators/roles.decorator";

/**
 * Evalúa el rol del usuario en la sucursal activa de su sesión (embebido en el JWT
 * en el login, ver AuthService). ADMIN_CORPORATIVO siempre pasa (acceso transversal).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RolUsuario[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;
    if (user.rol === RolUsuario.ADMIN_CORPORATIVO) return true;

    return requiredRoles.includes(user.rol);
  }
}
