import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { AmbientePlataforma } from "@hangar421/shared";

export class GuardarConfigPlataformaDto {
  /** No expuesto por la UI v1 del CRM (que solo administra la configuración a nivel empresa) —
   *  el backend sí lo soporta de punta a punta, igual que GuardarConfigProveedorDto de pagos. */
  @ApiPropertyOptional() @IsOptional() @IsString() sucursalId?: string;

  @ApiProperty({ enum: AmbientePlataforma }) @IsEnum(AmbientePlataforma) ambiente!: AmbientePlataforma;

  @ApiPropertyOptional() @IsOptional() @IsString() identificadorTienda?: string;

  @ApiProperty() @IsBoolean() activo!: boolean;

  /** Credenciales en claro — el backend las cifra antes de guardar; nunca se devuelven completas
   *  en ninguna respuesta (ver PlataformasService — solo últimos 4 caracteres + booleano). El
   *  admin debe volver a escribirlas completas en cada guardado (nunca se pre-llenan desde un
   *  valor enmascarado, para no arriesgar sobrescribir el secreto real con la máscara). */
  @ApiProperty() @IsObject() credenciales!: Record<string, string>;
}

/** Forma de la respuesta del servicio — no es un DTO de entrada, solo documenta el contrato.
 *  Nunca incluye `credencialesCifradas` ni las credenciales en claro. */
export interface PlataformaConfigDto {
  id: string | null;
  empresaId: string;
  sucursalId: string | null;
  plataforma: string;
  nombreVisible: string;
  ambiente: AmbientePlataforma;
  activo: boolean;
  estadoConexion: string;
  identificadorTienda: string | null;
  credencialesUltimos4: string | null;
  clientSecretConfigurado: boolean;
  webhookUrl: string | null;
  ultimaSincronizacion: Date | null;
  ultimoErrorMensaje: string | null;
  ultimoErrorEn: Date | null;
  pedidosRecibidos: number;
  pedidosSincronizados: number;
}

// -------------------------------------------------------------------------------------------
// Bandeja de pedidos entrantes (aceptación manual — ver PlataformasService.aceptarPedido)
// -------------------------------------------------------------------------------------------

export class ItemPedidoEntranteDto {
  /** Producto real del catálogo elegido a mano por el cajero — no viene de la plataforma. */
  @ApiProperty() @IsString() productoId!: string;
  @ApiProperty() @IsInt() @Min(1) cantidad!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notas?: string;
}

export class AceptarPedidoEntranteDto {
  /** La configuración puede aplicar a toda la empresa (sucursalId null) — el cajero elige aquí
   *  qué sucursal física va a preparar y cobrar este pedido en particular. */
  @ApiProperty() @IsString() sucursalId!: string;

  @ApiProperty({ type: [ItemPedidoEntranteDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoEntranteDto)
  items!: ItemPedidoEntranteDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() notasGenerales?: string;
}

export class RechazarPedidoEntranteDto {
  @ApiProperty() @IsString() motivo!: string;
}

/** Forma de la respuesta de listar/obtener pedidos entrantes — no es un DTO de entrada. */
export interface PedidoEntranteDto {
  id: string;
  plataforma: string;
  nombreVisible: string;
  ordenExternaId: string;
  estado: string;
  clienteNombre: string | null;
  totalExterno: number | null;
  items: { nombreExterno: string; cantidad: number; precioUnitario?: number; notas?: string }[];
  motivoError: string | null;
  pedidoId: string | null;
  createdAt: Date;
}
