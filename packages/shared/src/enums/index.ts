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
  /** Terminal Punto de Venta standalone (apps/pos-terminal) — offline-first, base de datos
   *  local propia, distinto de POS_WINDOWS (ese es el Electron con Postgres embebido). */
  POS_TERMINAL = "POS_TERMINAL",
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
  PLATAFORMA_DELIVERY = "PLATAFORMA_DELIVERY",
  APP_POS_MOVIL = "APP_POS_MOVIL",
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

export enum EstadoConexionTerminal {
  CONECTADA = "CONECTADA",
  DESCONECTADA = "DESCONECTADA",
  OCUPADA = "OCUPADA",
  ERROR = "ERROR",
}

export enum AmbienteProveedorPago {
  PRUEBAS = "PRUEBAS",
  PRODUCCION = "PRODUCCION",
}

/** Estados del ciclo de vida de una solicitud de pago con tarjeta. El backend es la única
 *  fuente de verdad — ni el POS ni la APK marcan APROBADO por su cuenta (ver PagosService). */
export enum EstadoSolicitudPago {
  PENDIENTE = "PENDIENTE",
  ENVIADO_A_TERMINAL = "ENVIADO_A_TERMINAL",
  EN_PROCESO = "EN_PROCESO",
  APROBADO = "APROBADO",
  RECHAZADO = "RECHAZADO",
  CANCELADO = "CANCELADO",
  EXPIRADO = "EXPIRADO",
  ERROR = "ERROR",
}

export enum OrigenEventoPago {
  POS = "POS",
  APK = "APK",
  PROVEEDOR = "PROVEEDOR",
  WEBHOOK = "WEBHOOK",
  SISTEMA = "SISTEMA",
}

export enum TurnoTrabajo {
  MATUTINO = "MATUTINO",
  VESPERTINO = "VESPERTINO",
  NOCTURNO = "NOCTURNO",
  MIXTO = "MIXTO",
}

/** Código de adaptador registrado en PlataformaDeliveryRegistry (backend) — usado para validar
 *  el body de las rutas /plataformas/configuraciones/:plataforma. */
export enum PlataformaDelivery {
  DIDI = "didi",
  UBER = "uber",
  RAPPI = "rappi",
}

export enum AmbientePlataforma {
  SANDBOX = "SANDBOX",
  PRODUCCION = "PRODUCCION",
}

export enum EstadoConexionPlataforma {
  CONECTADA = "CONECTADA",
  DESCONECTADA = "DESCONECTADA",
  PENDIENTE_CONFIGURACION = "PENDIENTE_CONFIGURACION",
  ERROR = "ERROR",
}

export enum EstadoSincronizacionOrdenPlataforma {
  RECIBIDA = "RECIBIDA",
  SINCRONIZADA = "SINCRONIZADA",
  ERROR = "ERROR",
  IGNORADA = "IGNORADA",
}

/** Entidades sincronizables reconocidas por el endpoint /sync. */
export enum SyncEntidad {
  PEDIDO = "PEDIDO",
  PEDIDO_ITEM = "PEDIDO_ITEM",
  PAGO = "PAGO",
  DESCUENTO = "DESCUENTO",
  MESA = "MESA",
  TURNO = "TURNO",
  /** Ingreso/egreso individual dentro de un turno ya abierto — distinto de TURNO (que es
   *  abrir/cerrar el turno completo). Usado por apps/pos-terminal. */
  MOVIMIENTO_CAJA = "MOVIMIENTO_CAJA",
  MOVIMIENTO_INVENTARIO = "MOVIMIENTO_INVENTARIO",
  PRODUCTO_SUCURSAL = "PRODUCTO_SUCURSAL",
  INVENTARIO_SUCURSAL = "INVENTARIO_SUCURSAL",
  /** Alta de un usuario hecha en una terminal (posiblemente sin conexión). Viaja con el MISMO id
   *  que tiene en la terminal, para que las ventas y turnos que ya lo nombran queden atribuidos
   *  a él y no al usuario-terminal genérico. Usado por apps/pos-terminal. */
  USUARIO = "USUARIO",
}
