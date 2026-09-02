/** Permisos granulares evaluados en backend (guards) y usados en frontend para
 *  ocultar/deshabilitar controles. La fuente de verdad de autorización es siempre el backend. */
export const PERMISOS = {
  VENTA_CREAR: "venta:crear",
  VENTA_COBRAR: "venta:cobrar",
  VENTA_DESCUENTO: "venta:descuento",
  VENTA_CANCELAR: "venta:cancelar",
  VENTA_DEVOLUCION: "venta:devolucion",
  CAJA_APERTURA: "caja:apertura",
  CAJA_CORTE: "caja:corte",
  MESA_TRANSFERIR: "mesa:transferir",
  PEDIDO_REABRIR: "pedido:reabrir",
  CATALOGO_EDITAR: "catalogo:editar",
  INVENTARIO_AJUSTAR: "inventario:ajustar",
  TRASPASO_AUTORIZAR: "traspaso:autorizar",
  USUARIOS_ADMINISTRAR: "usuarios:administrar",
  REPORTES_GLOBALES: "reportes:globales",
} as const;

export type Permiso = (typeof PERMISOS)[keyof typeof PERMISOS];

/** Mapa de permisos por defecto por rol — el backend puede sobreescribir por UsuarioSucursal.permisosJson. */
export const PERMISOS_POR_ROL: Record<string, Permiso[]> = {
  ADMIN_CORPORATIVO: Object.values(PERMISOS),
  ADMIN_SUCURSAL: [
    PERMISOS.VENTA_CREAR, PERMISOS.VENTA_COBRAR, PERMISOS.VENTA_DESCUENTO, PERMISOS.VENTA_CANCELAR,
    PERMISOS.VENTA_DEVOLUCION, PERMISOS.CAJA_APERTURA, PERMISOS.CAJA_CORTE, PERMISOS.MESA_TRANSFERIR,
    PERMISOS.PEDIDO_REABRIR, PERMISOS.CATALOGO_EDITAR, PERMISOS.INVENTARIO_AJUSTAR,
    PERMISOS.TRASPASO_AUTORIZAR,
  ],
  SUPERVISOR: [
    PERMISOS.VENTA_DESCUENTO, PERMISOS.VENTA_CANCELAR, PERMISOS.VENTA_DEVOLUCION,
    PERMISOS.PEDIDO_REABRIR, PERMISOS.TRASPASO_AUTORIZAR, PERMISOS.CAJA_CORTE,
  ],
  CAJERO: [PERMISOS.VENTA_CREAR, PERMISOS.VENTA_COBRAR, PERMISOS.CAJA_APERTURA, PERMISOS.CAJA_CORTE],
  MESERO: [PERMISOS.VENTA_CREAR, PERMISOS.MESA_TRANSFERIR],
  COCINA: [],
};

export const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SYNC_DEFAULTS = {
  BATCH_MAX_ITEMS: 200,
  RETRY_MAX_ATTEMPTS: 5,
  RETRY_BACKOFF_MS: 2000,
  PULL_POLL_INTERVAL_MS: 45_000,
};
