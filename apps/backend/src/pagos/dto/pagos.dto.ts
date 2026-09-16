import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsIn, IsNumber, IsObject, IsOptional, IsString, Min } from "class-validator";
import { AmbienteProveedorPago, EstadoConexionTerminal } from "@hangar421/shared";

export class CrearTerminalDto {
  @ApiProperty() @IsString() sucursalId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cajaId?: string;
  @ApiProperty() @IsString() proveedorConfigId!: string;
  @ApiProperty() @IsString() nombre!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() zona?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() meseroAsignadoId?: string;
  @ApiProperty() @IsString() identificadorExterno!: string;
}

export class ActualizarTerminalDto {
  @ApiPropertyOptional() @IsOptional() @IsString() nombre?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() zona?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cajaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() meseroAsignadoId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() identificadorExterno?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() activo?: boolean;
  @ApiPropertyOptional({ enum: EstadoConexionTerminal }) @IsOptional() @IsEnum(EstadoConexionTerminal) estadoConexion?: EstadoConexionTerminal;
}

export class GuardarConfigProveedorDto {
  @ApiProperty() @IsString() empresaId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sucursalId?: string;
  @ApiProperty() @IsString() proveedor!: string;
  @ApiProperty({ enum: AmbienteProveedorPago }) @IsEnum(AmbienteProveedorPago) ambiente!: AmbienteProveedorPago;
  @ApiPropertyOptional() @IsOptional() @IsString() identificadorComercio?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() webhookUrl?: string;
  /** Credenciales en claro — el backend las cifra antes de guardar; nunca se devuelven en
   *  ninguna respuesta (ver PagosService.sanearConfig()). */
  @ApiProperty() @IsObject() credenciales!: Record<string, string>;
}

export class CrearSolicitudPagoDto {
  @ApiProperty() @IsString() pedidoId!: string;
  @ApiProperty() @IsString() terminalId!: string;
  @ApiProperty() @IsNumber() @Min(0.01) importe!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() moneda?: string;
  /** Generado en el cliente (POS) — evita crear dos solicitudes si el cajero toca "Tarjeta" dos
   *  veces por un doble tap o un reintento de red. */
  @ApiProperty() @IsString() idempotencyKey!: string;
}
