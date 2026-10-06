import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";
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

  /** Id que la terminal ya generó (uuid7) para la venta local que va a registrar este pedido.
   *  El Pedido del ERP nace con ese mismo id, así que cuando la venta de la terminal sube después
   *  por /sync/push, `PedidosService.crear` la reconoce como el mismo pedido (es idempotente por
   *  id) y solo se le aplica el cobro: el pedido nunca se cuenta dos veces. Sin él (POS Windows,
   *  CRM) se genera uno nuevo, como siempre. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) pedidoId?: string;
  /** Turno de caja de la terminal que lo acepta — enlaza la venta a ese corte. */
  @ApiPropertyOptional() @IsOptional() @IsString() turnoId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() meseroId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dispositivoId?: string;

  /** El cajero declara que YA aceptó el pedido en la tablet/portal de la plataforma. Solo se usa
   *  cuando la integración no puede confirmarlo por API (ver PlataformasService.confirmarEnPlataforma). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmarManual?: boolean;
}

export class RechazarPedidoEntranteDto {
  @ApiProperty() @IsString() @MaxLength(300) motivo!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmarManual?: boolean;
}

export class SimularPedidoDto {
  @ApiProperty() @IsString() plataforma!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sucursalId?: string;
}

export interface FiltrosPedidosEntrantes {
  /** Un EstadoSincronizacionOrdenPlataforma o "TODOS". Default RECIBIDA (pendientes). */
  estado?: string;
  plataforma?: string;
  sucursalId?: string;
  desde?: Date;
  limite?: number;
}

export interface EventoPlataformaDto {
  id: string;
  plataforma: string;
  motivo: string;
  createdAt: Date;
}

/** Forma de la respuesta de listar/obtener pedidos entrantes — no es un DTO de entrada. */
export interface PedidoEntranteDto {
  id: string;
  plataforma: string;
  nombreVisible: string;
  ordenExternaId: string;
  folioCorto: string | null;
  estado: string;
  estadoExterno: string | null;
  clienteNombre: string | null;
  totalExterno: number | null;
  items: { nombreExterno: string; cantidad: number; precioUnitario?: number; notas?: string; modificadores?: string[] }[];
  notas: string | null;
  entrega: { tipo?: string | null; repartidor?: string | null; horaEstimada?: string | null; codigoEntrega?: string | null } | null;
  montos: { subtotal?: number | null; envio?: number | null; propina?: number | null; descuento?: number | null } | null;
  motivoError: string | null;
  ultimoIntentoError: string | null;
  /** CONFIRMADA | MANUAL | SIMULADA | null */
  confirmacion: string | null;
  simulado: boolean;
  /** true = aceptar se confirma por la API de la plataforma; false = requiere confirmación manual. */
  puedeConfirmarEnPlataforma: boolean;
  pedidoId: string | null;
  aceptadaEn: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
