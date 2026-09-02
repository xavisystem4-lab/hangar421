import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class LoginCredencialesDto {
  @ApiProperty() @IsEmail() email!: string;
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
