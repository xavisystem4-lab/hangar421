import { RolUsuario } from "../enums";

export interface LoginCredencialesRequest {
  email: string;
  password: string;
  dispositivoId?: string;
  /** Requerida si el usuario tiene acceso a más de una sucursal; opcional si solo tiene una. */
  sucursalId?: string;
}

export interface SwitchSucursalRequest {
  sucursalId: string;
}

export interface LoginPinRequest {
  usuarioId: string;
  pin: string;
  sucursalId: string;
  dispositivoId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUserContext {
  id: string;
  nombre: string;
  empresaId: string;
  sucursales: { sucursalId: string; rol: RolUsuario }[];
}

export interface LoginResponse extends AuthTokens {
  usuario: AuthUserContext;
}

export interface JwtPayload {
  sub: string; // usuarioId
  empresaId: string;
  dispositivoId?: string;
  sucursalId?: string;
  rol?: RolUsuario;
  type: "access" | "refresh";
  /** Identificador único del token (evita colisiones si dos sesiones se emiten en el mismo
   *  segundo — el `tokenHash` de refresh_tokens es único y el JWT sin `jti` sería idéntico). */
  jti?: string;
}
