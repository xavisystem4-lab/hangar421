import { RolUsuario } from "@hangar421/shared";

/**
 * Funciones de la terminal que un administrador puede dar o quitar a cada persona, desde
 * Admin → Usuarios.
 *
 * Es un catálogo PROPIO del APK, no `PERMISOS` de shared: aquellos describen acciones del ERP
 * (traspasos, reportes globales…) que la tablet no tiene, y aquí hacen falta las pantallas y
 * botones concretos de la tablet. Se guardan solo en esta tablet (`usuarios_locales.permisos_json`)
 * y se evalúan sin red, igual que el PIN.
 *
 * No es la barrera de seguridad del ERP: lo que el ERP ya exige (el PIN de un supervisor para
 * cancelar o regalar) se sigue pidiendo aunque la persona tenga la casilla marcada.
 */
export const PERMISOS_TERMINAL = {
  VENTA_COBRAR: "venta:cobrar",
  VENTA_CORTESIA: "venta:cortesia",
  VENTA_CANCELAR: "venta:cancelar",
  CAJA_ABRIR: "caja:abrir",
  CAJA_MOVIMIENTOS: "caja:movimientos",
  CAJA_CERRAR: "caja:cerrar",
  VENTAS_CONSULTAR: "ventas:consultar",
  ERP_SUBIR: "erp:subir",
  ADMIN_CATALOGO: "admin:catalogo",
  ADMIN_INVENTARIO: "admin:inventario",
  ADMIN_REPORTES: "admin:reportes",
  ADMIN_SINCRONIZACION: "admin:sincronizacion",
  ADMIN_PAGOS: "admin:pagos",
  ADMIN_IMPRESORA: "admin:impresora",
  ADMIN_PLATAFORMAS: "admin:plataformas",
} as const;

export type PermisoTerminal = (typeof PERMISOS_TERMINAL)[keyof typeof PERMISOS_TERMINAL];

const P = PERMISOS_TERMINAL;

/** Cómo se muestran en Admin → Usuarios, en este orden. */
export const GRUPOS_PERMISOS: { titulo: string; permisos: { clave: PermisoTerminal; etiqueta: string; ayuda?: string }[] }[] = [
  {
    titulo: "Venta y cobro",
    permisos: [
      { clave: P.VENTA_COBRAR, etiqueta: "Cobrar ventas" },
      { clave: P.VENTA_CORTESIA, etiqueta: "Solicitar cortesía", ayuda: "Siempre pide el PIN de un supervisor" },
      { clave: P.VENTA_CANCELAR, etiqueta: "Solicitar cancelación de tickets", ayuda: "Siempre pide el PIN de un supervisor" },
    ],
  },
  {
    titulo: "Caja",
    permisos: [
      { clave: P.CAJA_ABRIR, etiqueta: "Abrir caja" },
      { clave: P.CAJA_MOVIMIENTOS, etiqueta: "Entradas y retiros de efectivo" },
      { clave: P.CAJA_CERRAR, etiqueta: "Corte / cerrar caja" },
    ],
  },
  {
    titulo: "Consultas",
    permisos: [
      { clave: P.VENTAS_CONSULTAR, etiqueta: "Ver tickets cobrados y reimprimirlos (pestaña Ventas)" },
      { clave: P.ERP_SUBIR, etiqueta: "Botón \"Subir a ERP\"" },
    ],
  },
  {
    titulo: "Secciones de Admin",
    permisos: [
      { clave: P.ADMIN_CATALOGO, etiqueta: "Catálogo" },
      { clave: P.ADMIN_INVENTARIO, etiqueta: "Inventario" },
      { clave: P.ADMIN_REPORTES, etiqueta: "Reportes" },
      { clave: P.ADMIN_SINCRONIZACION, etiqueta: "Sincronización" },
      { clave: P.ADMIN_PAGOS, etiqueta: "Pagos" },
      { clave: P.ADMIN_IMPRESORA, etiqueta: "Impresora" },
      { clave: P.ADMIN_PLATAFORMAS, etiqueta: "Delivery" },
    ],
  },
];

const TODOS = Object.values(PERMISOS_TERMINAL) as PermisoTerminal[];

/** Administradores: lo pueden todo, y además son los únicos que gestionan usuarios y permisos.
 *  Sus casillas no se editan, para que nadie pueda dejar la tablet sin quien la administre. */
const ROLES_ADMIN = new Set<string>([RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO]);

export function esRolAdmin(rol: string | null | undefined): boolean {
  return !!rol && ROLES_ADMIN.has(rol);
}

/** Lo que cada rol puede hacer mientras nadie le cambie las casillas. Reproduce lo que la
 *  tablet permitía antes de existir los permisos (todo menos Admin), para que actualizar el APK
 *  no le quite nada a nadie. La pestaña Ventas es nueva y arranca activa: ahí se reimprime el
 *  ticket del cliente que al final sí lo quiere, que es trabajo diario del cajero. */
const OPERACION_BASICA: PermisoTerminal[] = [
  P.VENTA_COBRAR, P.VENTA_CORTESIA, P.VENTA_CANCELAR,
  P.CAJA_ABRIR, P.CAJA_MOVIMIENTOS, P.CAJA_CERRAR,
  P.VENTAS_CONSULTAR, P.ERP_SUBIR,
];

export const PERMISOS_DEFECTO_POR_ROL: Record<string, PermisoTerminal[]> = {
  [RolUsuario.SUPERVISOR]: OPERACION_BASICA,
  [RolUsuario.CAJERO]: OPERACION_BASICA,
  [RolUsuario.MESERO]: OPERACION_BASICA,
  [RolUsuario.COCINA]: OPERACION_BASICA,
};

/** `guardados` null = la persona nunca fue personalizada: usa los del rol. Una lista (aunque
 *  esté vacía) manda sobre el rol. Claves desconocidas (de una versión futura) se ignoran. */
export function permisosEfectivos(rol: string, guardados: string[] | null | undefined): Set<PermisoTerminal> {
  if (esRolAdmin(rol)) return new Set(TODOS);
  if (!guardados) return new Set(PERMISOS_DEFECTO_POR_ROL[rol] ?? OPERACION_BASICA);
  return new Set(TODOS.filter((p) => guardados.includes(p)));
}

export function tienePermiso(usuario: { rol: string; permisos?: string[] | null } | null | undefined, permiso: PermisoTerminal): boolean {
  return !!usuario && permisosEfectivos(usuario.rol, usuario.permisos).has(permiso);
}

/** Lee `permisos_json` tolerando basura: un valor corrupto vuelve a los del rol en vez de
 *  dejar a la persona sin poder trabajar. */
export function leerPermisosGuardados(json: string | null | undefined): string[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}
