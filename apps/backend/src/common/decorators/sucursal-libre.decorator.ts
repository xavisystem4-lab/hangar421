import { SetMetadata } from "@nestjs/common";

/**
 * Exime un endpoint de SucursalAccessGuard: la sucursal que nombra la petición NO tiene que
 * coincidir con la activa de la sesión.
 *
 * Solo tiene un uso legítimo hoy — `POST /auth/switch-sucursal`, cuyo cuerpo lleva por
 * definición una sucursal DISTINTA de la actual (es lo que se pide cambiar). Sin esta marca el
 * guard se bloquearía a sí mismo y el cambio de sucursal sería imposible.
 *
 * No es un agujero: el endpoint revalida el acceso contra `UsuarioSucursal` antes de emitir la
 * nueva sesión (AuthService.cambiarSucursalActiva), que es una comprobación más estricta que la
 * del guard. Cualquier endpoint nuevo que lleve esta marca debe hacer lo mismo.
 */
export const SUCURSAL_LIBRE_KEY = "sucursalLibre";
export const SucursalLibre = () => SetMetadata(SUCURSAL_LIBRE_KEY, true);
