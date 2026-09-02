import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CanalOrigen, MetodoPago, TipoDescuento, TipoPedido } from "@hangar421/shared";

export class ModificadorSeleccionadoDto {
  @ApiProperty() @IsString() opcionModificadorId!: string;
}

export class ItemPedidoDto {
  @ApiProperty() @IsString() productoId!: string;
  @ApiProperty() @IsInt() @Min(1) cantidad!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notas?: string;
  @ApiPropertyOptional({ type: [ModificadorSeleccionadoDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModificadorSeleccionadoDto)
  modificadores?: ModificadorSeleccionadoDto[];
}

export class CrearPedidoDto {
  /** id generado en el cliente (UUID v7) — permite offline-first e idempotencia. */
  @ApiProperty() @IsString() id!: string;
  @ApiProperty() @IsString() empresaId!: string;
  @ApiProperty() @IsString() sucursalId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mesaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() clienteId?: string;
  @ApiProperty({ enum: TipoPedido }) @IsEnum(TipoPedido) tipo!: TipoPedido;
  @ApiPropertyOptional() @IsOptional() @IsInt() numComensales?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() meseroId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dispositivoId?: string;
  @ApiProperty({ enum: CanalOrigen }) @IsEnum(CanalOrigen) canalOrigen!: CanalOrigen;
  @ApiPropertyOptional() @IsOptional() @IsString() notasGenerales?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() idempotencyKey?: string;
  /** true si se crea y se envía a cocina en un solo paso (p.ej. al llegar de la cola offline). */
  @ApiPropertyOptional() @IsOptional() enviarInmediato?: boolean;
  @ApiProperty({ type: [ItemPedidoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoDto)
  items!: ItemPedidoDto[];
}

export class AgregarItemsDto {
  @ApiProperty({ type: [ItemPedidoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoDto)
  items!: ItemPedidoDto[];
}

export class CambiarEstadoItemDto {
  @ApiProperty() @IsString() estado!: string;
}

export class AplicarDescuentoDto {
  @ApiProperty({ enum: TipoDescuento }) @IsEnum(TipoDescuento) tipo!: TipoDescuento;
  @ApiProperty() @IsNumber() valor!: number;
  @ApiProperty() @IsString() motivo!: string;
  @ApiProperty() @IsString() autorizadoPorId!: string;
}

export class PagoDto {
  @ApiProperty({ enum: MetodoPago }) @IsEnum(MetodoPago) metodo!: MetodoPago;
  @ApiProperty() @IsNumber() @Min(0.01) monto!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() referencia?: string;
}

export class CobrarPedidoDto {
  @ApiProperty({ type: [PagoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PagoDto)
  pagos!: PagoDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() cajeroId?: string;
}

export class CancelarPedidoDto {
  @ApiProperty() @IsString() motivo!: string;
  @ApiProperty() @IsString() autorizadoPorId!: string;
}
