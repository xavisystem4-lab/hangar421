import { RolUsuario } from "@hangar421/shared";

/**
 * Sucursal efectiva de una consulta del ERP: la pedida, o ninguna (el consolidado de la empresa)
 * solo para ADMIN_CORPORATIVO.
 *
 * SucursalAccessGuard compara la sucursal que NOMBRA la petición contra la de la sesión, pero
 * una petición que no nombra ninguna pasa sin comprobación (no hay nada que comparar). En una
 * consulta donde omitirla significa "todas las sucursales", eso dejaba a cualquier rol ver el
 * consolidado. Aquí se cierra: quien no es corporativo queda en su sucursal activa.
 */
export function sucursalDeLaConsulta(user: { rol?: string; sucursalId?: string }, pedida?: string): string | undefined {
  if (pedida) return pedida;
  return user.rol === RolUsuario.ADMIN_CORPORATIVO ? undefined : user.sucursalId;
}
