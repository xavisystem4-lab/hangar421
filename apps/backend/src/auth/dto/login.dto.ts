import { IsArray, IsEnum, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { RolUsuario, TipoDispositivo } from "@hangar421/shared";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class LoginCredencialesDto {
  /** Acepta correo o nombre de usuario (Usuario.username) indistintamente. */
  @ApiProperty({ description: "Correo o nombre de usuario" }) @IsString() email!: string;
  @ApiProperty() @IsString() @MinLength(6) password!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dispositivoId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sucursalId?: string;
}

export class LoginPinDto {
  @ApiProperty() @IsString() usuarioId!: string;
  @ApiProperty() @IsString() @MinLength(4) pin!: string;
  @ApiProperty() @IsString() sucursalId!: string;
  @ApiProperty() @IsString() dispositivoId!: string;
}

export class RefreshTokenDto {
  @ApiProperty() @IsString() refreshToken!: string;
}

export class SwitchSucursalDto {
  @ApiProperty() @IsString() sucursalId!: string;
}

export class CrearCodigoVinculacionDto {
  /** Código de UNA sucursal. Omitido = código de empresa (ver `sucursalesIds`). */
  @ApiPropertyOptional() @IsOptional() @IsString() sucursalId?: string;
  /** Código de empresa: sucursales a las que tendrá acceso la terminal. Vacío = todas. */
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) sucursalesIds?: string[];
  /** Rol con el que operará la terminal. Se omite normalmente: CAJERO es el default. */
  @ApiPropertyOptional({ enum: RolUsuario }) @IsOptional() @IsEnum(RolUsuario) rol?: RolUsuario;
}

export class VincularDispositivoDto {
  @ApiProperty() @IsString() codigo!: string;
  /** Huella de instalación del APK (ver dispositivoLocal.obtenerOCrearDispositivoId). */
  @ApiProperty() @IsString() dispositivoId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nombreDispositivo?: string;
  /** Tipo con que se registra el equipo: POS_TERMINAL (APK, por defecto) o POS_WINDOWS (la PC
   *  que sube sus ventas a la nube, ver enlace-nube). */
  @ApiPropertyOptional({ enum: [TipoDispositivo.POS_TERMINAL, TipoDispositivo.POS_WINDOWS] })
  @IsOptional()
  @IsIn([TipoDispositivo.POS_TERMINAL, TipoDispositivo.POS_WINDOWS])
  tipo?: TipoDispositivo;
}
