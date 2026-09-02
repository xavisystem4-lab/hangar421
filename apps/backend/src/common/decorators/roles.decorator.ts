import { SetMetadata } from "@nestjs/common";
import { RolUsuario } from "@hangar421/shared";

export const ROLES_KEY = "roles";
/** Restringe un endpoint a uno o más roles (evaluado por RolesGuard sobre la sucursal activa). */
export const Roles = (...roles: RolUsuario[]) => SetMetadata(ROLES_KEY, roles);
