import { RolUsuario } from "../enums";

export interface LoginCredencialesRequest {
  /** Acepta el correo o el nombre de usuario (`Usuario.username`) indistintamente. */
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

/** Una sucursal a la que el usuario tiene acceso, con el rol que tiene EN ELLA (viene de
 *  `UsuarioSucursal`, no del usuario: el mismo empleado puede ser cajero en una y supervisor en
 *  otra). Incluye el nombre porque es lo que se pinta en el selector de sucursal — un desplegable
 *  de UUIDs no le sirve a nadie. */
export interface AccesoSucursal {
  sucursalId: string;
  nombre: string;
  rol: RolUsuario;
}

export interface AuthUserContext {
  id: string;
  nombre: string;
  empresaId: string;
  sucursales: AccesoSucursal[];
}

/** Cuerpo del 400 que devuelve el login cuando la cuenta tiene varias sucursales y no se indicó
 *  cuál. Lleva la lista para que el cliente pueda mostrar el selector y reintentar con
 *  `sucursalId` — sin esto no hay forma de elegir: no se emite ningún token, así que tampoco se
 *  puede consultar la lista por otra vía. */
export interface SucursalRequeridaError {
  message: string;
  codigo: "SUCURSAL_REQUERIDA";
  sucursales: AccesoSucursal[];
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
