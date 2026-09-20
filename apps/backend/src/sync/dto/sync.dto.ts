import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsISO8601, IsObject, IsOptional, IsString, ValidateNested } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SyncEntidad, SyncOperacion } from "@hangar421/shared";

export class SyncEnvelopeDto {
  @ApiProperty() @IsString() id!: string;
  @ApiProperty({ enum: SyncEntidad }) @IsEnum(SyncEntidad) entidad!: SyncEntidad;
  @ApiProperty({ enum: SyncOperacion }) @IsEnum(SyncOperacion) operacion!: SyncOperacion;
  @ApiProperty() @IsString() idempotencyKey!: string;
  @ApiProperty() @IsString() dispositivoId!: string;
  @ApiProperty() @IsString() sucursalId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() usuarioId?: string;
  @ApiProperty() @IsISO8601() createdAtLocal!: string;
  @ApiProperty() @IsObject() payload!: Record<string, unknown>;
}

export class SyncPushDto {
  @ApiProperty({ type: [SyncEnvelopeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SyncEnvelopeDto)
  items!: SyncEnvelopeDto[];
}

export class SyncHeartbeatDto {
  /** Huella de instalación de la terminal (Dispositivo.identificador, no el id). */
  @ApiProperty() @IsString() dispositivoId!: string;
  /** Necesaria solo la primera vez, para poder autorregistrar el dispositivo. */
  @ApiPropertyOptional() @IsOptional() @IsString() sucursalId?: string;
}
