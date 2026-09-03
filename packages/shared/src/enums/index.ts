// Enums espejo del esquema Prisma (apps/backend/prisma/schema.prisma).
// Se mantienen sincronizados manualmente; si el backend cambia un enum,
// actualizar aquí también (fuente única para los 4 frontends).

export enum RolUsuario {
  ADMIN_CORPORATIVO = "ADMIN_CORPORATIVO",
  ADMIN_SUCURSAL = "ADMIN_SUCURSAL",
  CAJERO = "CAJERO",
  MESERO = "MESERO",
  COCINA = "COCINA",
  SUPERVISOR = "SUPERVISOR",
}

export enum TipoArea {
  SALON = "SALON",
  BARRA = "BARRA",
  COCINA = "COCINA",
  CAJA = "CAJA",
  ESTACION_COCINA = "ESTACION_COCINA",
  ALMACEN = "ALMACEN",
}

export enum TipoDispositivo {
  POS_WINDOWS = "POS_WINDOWS",
  TABLET_MESERO = "TABLET_MESERO",
  CELULAR_MESERO = "CELULAR_MESERO",
  PANTALLA_COCINA = "PANTALLA_COCINA",
  OTRO = "OTRO",
}

export enum EstadoMesa {
  LIBRE = "LIBRE",
  OCUPADA = "OCUPADA",
  RESERVADA = "RESERVADA",
  POR_COBRAR = "POR_COBRAR",
  PEDIDO_LISTO = "PEDIDO_LISTO",
}

export enum TipoPedido {
  MESA = "MESA",
  MOSTRADOR = "MOSTRADOR",
  DOMICILIO = "DOMICILIO",
}

export enum EstadoPedido {
  ABIERTO = "ABIERTO",
  ENVIADO = "ENVIADO",
  EN_PREPARACION = "EN_PREPARACION",
  LISTO = "LISTO",
  ENTREGADO = "ENTREGADO",
  POR_COBRAR = "POR_COBRAR",
  COBRADO = "COBRADO",
  CANCELADO = "CANCELADO",
}

export enum EstadoPedidoItem {
  NUEVO = "NUEVO",
  EN_PREPARACION = "EN_PREPARACION",
  LISTO = "LISTO",
  ENTREGADO = "ENTREGADO",
  CANCELADO = "CANCELADO",
}

export enum CanalOrigen {
  POS_WINDOWS = "POS_WINDOWS",
  APP_MESERO = "APP_MESERO",
  CRM = "CRM",
}

export enum MetodoPago {
  EFECTIVO = "EFECTIVO",
  TARJETA = "TARJETA",
  TRANSFERENCIA = "TRANSFERENCIA",
  QR = "QR",
  OTRO = "OTRO",
}

export enum TipoMovimientoInventario {
  ENTRADA = "ENTRADA",
  SALIDA = "SALIDA",
  AJUSTE = "AJUSTE",
  MERMA = "MERMA",
  CONTEO = "CONTEO",
  TRASPASO_SALIDA = "TRASPASO_SALIDA",
  TRASPASO_ENTRADA = "TRASPASO_ENTRADA",
}

export enum EstadoTraspaso {
  SOLICITADO = "SOLICITADO",
  AUTORIZADO = "AUTORIZADO",
  ENVIADO = "ENVIADO",
  RECIBIDO = "RECIBIDO",
  VALIDADO = "VALIDADO",
  CANCELADO = "CANCELADO",
}

export enum EstadoTurno {
  ABIERTO = "ABIERTO",
  CERRADO = "CERRADO",
}

export enum TipoMovimientoCaja {
  INGRESO = "INGRESO",
  EGRESO = "EGRESO",
}

export enum SyncStatus {
  PENDING = "PENDING",
  SYNCING = "SYNCING",
  SYNCED = "SYNCED",
  CONFLICT = "CONFLICT",
  ERROR = "ERROR",
}

export enum SyncOperacion {
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
}

export enum TipoDescuento {
  MONTO = "MONTO",
  PORCENTAJE = "PORCENTAJE",
}

/** Entidades sincronizables reconocidas por el endpoint /sync. */
export enum SyncEntidad {
  PEDIDO = "PEDIDO",
  PEDIDO_ITEM = "PEDIDO_ITEM",
  PAGO = "PAGO",
  DESCUENTO = "DESCUENTO",
  MESA = "MESA",
  TURNO = "TURNO",
  MOVIMIENTO_INVENTARIO = "MOVIMIENTO_INVENTARIO",
  PRODUCTO_SUCURSAL = "PRODUCTO_SUCURSAL",
  INVENTARIO_SUCURSAL = "INVENTARIO_SUCURSAL",
}
