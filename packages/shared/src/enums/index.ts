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
  /** Billetes en dólares. `monto` es lo que cubre de la venta en PESOS; los dólares recibidos y
   *  el tipo de cambio van en `montoUsd` / `tipoCambio`, y el cambio se da en pesos. */
  EFECTIVO_USD = "EFECTIVO_USD",
  /** El cliente ya pagó en línea, en la app de la plataforma (DiDi Food…). No entra al cajón:
   *  el corte lo muestra aparte y no lo suma al efectivo esperado. En el APK solo se ofrece al
   *  cobrar una venta del grupo DIDI. */
  EN_LINEA = "EN_LINEA",
  /** Crédito de empleado: la venta se carga al monedero electrónico de una empleada (ver
   *  monedero.ts). No entra al cajón y el corte lo muestra aparte. Si la cuenta supera el saldo,
   *  el resto va en otro pago (efectivo, tarjeta…) de la misma venta. */
  MONEDERO_EMPLEADO = "MONEDERO_EMPLEADO",
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
  /** La plataforma canceló la orden (cliente, repartidor o expiración) antes de aceptarla. */
  CANCELADA = "CANCELADA",
}

/** Cómo quedó confirmada en la plataforma una aceptación/rechazo hecho desde el POS. */
export enum ConfirmacionPlataforma {
  /** La API de la plataforma respondió OK. */
  CONFIRMADA = "CONFIRMADA",
  /** La integración no tiene (o no tiene configurada) la acción en la API: el cajero confirmó
   *  a mano que ya lo hizo en la tablet/portal de la plataforma. */
  MANUAL = "MANUAL",
  /** Pedido de prueba creado en modo simulación: nunca toca la plataforma. */
  SIMULADA = "SIMULADA",
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
  /** Solicitud de alta de un producto que no existe en el catálogo, hecha desde un punto de
   *  venta (posiblemente sin conexión). Nunca crea el producto: lo registra un administrador. */
  SOLICITUD_PRODUCTO = "SOLICITUD_PRODUCTO",
  /** Venta cerrada de un POS de Windows standalone, subida a la nube (ver VentaHub). */
  VENTA_HUB = "VENTA_HUB",
  /** Alta de un producto hecha en una terminal (Admin → Catálogo del APK), con los modificadores
   *  que debe preguntar. Viaja con el MISMO id que tiene en la terminal (uuid7): el ERP lo crea
   *  con ese id, lo pone en venta en la sucursal que lo dio de alta y en standby en las demás.
   *  UPDATE solo cambia qué modificadores pregunta. Usado por apps/pos-terminal. */
  PRODUCTO = "PRODUCTO",
  /** Alta de un grupo de modificadores (Tamaño, Tipo de leche, Extras…) hecha en una terminal
   *  desde el alta de producto del APK. Viaja con el MISMO id (grupo y opciones, uuid7) que tiene
   *  en la terminal, para que el producto que lo referencia y las ventas con esas opciones
   *  resuelvan igual en el ERP. Solo CREATE, idempotente por id. Usado por apps/pos-terminal. */
  MODIFICADOR = "MODIFICADOR",
  /** Promoción de catálogo (precio especial o % en productos, con días, horario y fechas) creada o
   *  editada en una terminal. Viaja con el MISMO id (uuid7) y la definición COMPLETA, así que
   *  CREATE y UPDATE son un upsert idempotente; apagarla es UPDATE con activo = false. */
  PROMOCION = "PROMOCION",
}

export enum EstadoSolicitudProducto {
  PENDIENTE = "PENDIENTE",
  ATENDIDA = "ATENDIDA",
  DESCARTADA = "DESCARTADA",
}
