import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { RolUsuario } from "@hangar421/shared";
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
  @ApiProperty() @IsString() sucursalId!: string;
  /** Rol con el que operará la terminal. Se omite normalmente: CAJERO es el default. */
  @ApiPropertyOptional({ enum: RolUsuario }) @IsOptional() @IsEnum(RolUsuario) rol?: RolUsuario;
}

export class VincularDispositivoDto {
  @ApiProperty() @IsString() codigo!: string;
  /** Huella de instalación del APK (ver dispositivoLocal.obtenerOCrearDispositivoId). */
  @ApiProperty() @IsString() dispositivoId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nombreDispositivo?: string;
}
