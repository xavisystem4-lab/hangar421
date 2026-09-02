import {
  CanalOrigen,
  EstadoMesa,
  EstadoPedido,
  EstadoPedidoItem,
  EstadoTraspaso,
  EstadoTurno,
  MetodoPago,
  RolUsuario,
  SyncStatus,
  TipoArea,
  TipoDescuento,
  TipoDispositivo,
  TipoMovimientoInventario,
  TipoPedido,
} from "../enums";

/** Tipos de transporte (DTO) compartidos entre backend y clientes.
 *  Los montos viajan como `number` en JSON (el backend serializa Decimal -> number). */

export interface Empresa {
  id: string;
  nombre: string;
  rfc?: string | null;
  logoUrl?: string | null;
  activo: boolean;
}

export interface Sucursal {
  id: string;
  empresaId: string;
  nombre: string;
  direccion?: string | null;
  horarioApertura?: string | null;
  horarioCierre?: string | null;
  timezone: string;
  moneda: string;
  tasaImpuesto: number;
  activo: boolean;
}

export interface Area {
  id: string;
  sucursalId: string;
  nombre: string;
  tipo: TipoArea;
  activo: boolean;
}

export interface Dispositivo {
  id: string;
  sucursalId: string;
  areaId?: string | null;
  nombre: string;
  tipo: TipoDispositivo;
  identificador: string;
  activo: boolean;
}

export interface Usuario {
  id: string;
  empresaId: string;
  nombre: string;
  email?: string | null;
  activo: boolean;
}

export interface UsuarioSucursal {
  usuarioId: string;
  sucursalId: string;
  rol: RolUsuario;
}

export interface CategoriaProducto {
  id: string;
  empresaId: string;
  nombre: string;
  orden: number;
  icono?: string | null;
  color?: string | null;
  activo: boolean;
}

export interface OpcionModificador {
  id: string;
  modificadorId: string;
  nombre: string;
  precioExtra: number;
  orden: number;
}

export interface Modificador {
  id: string;
  empresaId: string;
  nombre: string;
  tipo: "SELECCION_UNICA" | "MULTIPLE";
  obligatorio: boolean;
  opciones: OpcionModificador[];
}

export type EstacionPreparacion = "BARRA" | "COCINA" | "POSTRES";

export interface Producto {
  id: string;
  empresaId: string;
  categoriaId: string;
  nombre: string;
  descripcion?: string | null;
  subcategoria?: string | null;
  imagenUrl?: string | null;
  precioBase: number;
  orden: number;
  activo: boolean;
  requierePersonalizacion: boolean;
  estacionPreparacion?: EstacionPreparacion | null;
  impuestoOverride?: number | null;
  modificadores?: Modificador[];
  // resuelto por sucursal en tiempo de consulta:
  precioSucursal?: number;
  disponibleSucursal?: boolean;
}

export interface Mesa {
  id: string;
  sucursalId: string;
  areaId?: string | null;
  nombre: string;
  capacidad: number;
  estado: EstadoMesa;
}

export interface PedidoItemModificador {
  id?: string;
  opcionModificadorId: string;
  nombreOpcion?: string;
  precioExtra: number;
}

export interface PedidoItem {
  id: string;
  pedidoId: string;
  productoId: string;
  nombreProducto?: string;
  cantidad: number;
  precioUnitario: number;
  notas?: string | null;
  estado: EstadoPedidoItem;
  estacionCocinaId?: string | null;
  modificadores: PedidoItemModificador[];
}

export interface Descuento {
  id?: string;
  tipo: TipoDescuento;
  valor: number;
  montoAplicado: number;
  motivo: string;
  autorizadoPorId?: string | null;
}

export interface Pago {
  id?: string;
  metodo: MetodoPago;
  monto: number;
  referencia?: string | null;
}

export interface Pedido {
  id: string;
  empresaId: string;
  sucursalId: string;
  mesaId?: string | null;
  clienteId?: string | null;
  folio: string;
  tipo: TipoPedido;
  numComensales?: number | null;
  meseroId?: string | null;
  cajeroId?: string | null;
  dispositivoId?: string | null;
  canalOrigen: CanalOrigen;
  estado: EstadoPedido;
  notasGenerales?: string | null;
  subtotal: number;
  impuesto: number;
  descuentoTotal: number;
  total: number;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
  items: PedidoItem[];
  pagos: Pago[];
  descuentos: Descuento[];
}

export interface Turno {
  id: string;
  sucursalId: string;
  cajaId: string;
  usuarioId: string;
  montoInicial: number;
  montoFinalDeclarado?: number | null;
  montoFinalSistema?: number | null;
  diferencia?: number | null;
  estado: EstadoTurno;
  fechaApertura: string;
  fechaCierre?: string | null;
}

export interface Insumo {
  id: string;
  empresaId: string;
  nombre: string;
  unidadMedida: string;
  costoUnitario: number;
}

export interface InventarioSucursal {
  sucursalId: string;
  insumoId: string;
  existencia: number;
  minimo: number;
  maximo?: number | null;
}

export interface MovimientoInventario {
  id: string;
  sucursalId: string;
  insumoId: string;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  motivo?: string | null;
  referenciaId?: string | null;
  usuarioId?: string | null;
  createdAt: string;
}

export interface TraspasoItem {
  id?: string;
  insumoId: string;
  cantidadSolicitada: number;
  cantidadEnviada?: number | null;
  cantidadRecibida?: number | null;
  diferencia?: number | null;
}

export interface Traspaso {
  id: string;
  sucursalOrigenId: string;
  sucursalDestinoId: string;
  estado: EstadoTraspaso;
  items: TraspasoItem[];
}

export interface Cliente {
  id: string;
  empresaId: string;
  nombre: string;
  telefono?: string | null;
  email?: string | null;
  puntosLealtad: number;
}
