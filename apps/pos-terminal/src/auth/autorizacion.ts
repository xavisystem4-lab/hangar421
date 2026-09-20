import type { SQLiteDatabase } from "expo-sqlite";
import { RolUsuario } from "@hangar421/shared";
import { obtenerOCrearSucursalIdLocal } from "../db/dispositivoLocal";
import { derivarHashPin } from "./offlineAuth";

/** Roles que pueden autorizar una acción sensible. Coincide con ROLES_AUTORIZAN_SUPERVISOR del
 *  backend (pedidos.service.ts): si divergieran, una cancelación autorizada en la tablet podría
 *  ser rechazada al llegar al ERP, y el cajero ya habría dado el dinero al cliente. */
export const ROLES_AUTORIZAN: string[] = [
  RolUsuario.SUPERVISOR,
  RolUsuario.ADMIN_SUCURSAL,
  RolUsuario.ADMIN_CORPORATIVO,
];

export interface Autorizador {
  id: string;
  nombre: string;
  rol: string;
}

export interface ResultadoAutorizacion {
  autorizado: boolean;
  /** Quién autorizó, para el registro de auditoría. */
  autorizador?: Autorizador;
  error?: string;
}

/**
 * Quién puede autorizar en ESTA terminal, ahora mismo y sin red.
 *
 * Se resuelve contra `usuarios_locales` de la sucursal activa, no contra el ERP: una cancelación
 * tiene que poder hacerse con la tienda sin internet — es justo cuando más falta hace. Es el
 * mismo nivel de confianza con el que ya se abre caja o se inicia sesión offline en esta app.
 */
export async function listarAutorizadores(db: SQLiteDatabase): Promise<Autorizador[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    `SELECT u.id, u.nombre, u.rol
     FROM usuarios_locales u JOIN pin_cache p ON p.usuario_local_id = u.id
     WHERE u.sucursal_id = ? AND u.activo = 1 AND u.rol IN (${ROLES_AUTORIZAN.map(() => "?").join(",")})
     ORDER BY u.nombre`,
    sucursalId, ...ROLES_AUTORIZAN,
  );
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, rol: f.rol }));
}

/**
 * Valida el PIN de quien autoriza.
 *
 * `solicitanteId` es quien pide la acción. Si coincide con el autorizador solo se permite cuando
 * esa persona YA tiene rol de autorización: un cajero nunca se autoriza a sí mismo, pero exigirle
 * a un gerente que trabaja solo que busque a otra persona bloquearía la tienda.
 *
 * El PIN se compara contra el hash salado de `pin_cache` — nunca se guarda ni se transmite en
 * claro, ni siquiera dentro del propio dispositivo.
 */
export async function autorizarConPin(
  db: SQLiteDatabase,
  datos: { autorizadorId: string; pin: string; solicitanteId: string },
): Promise<ResultadoAutorizacion> {
  const autorizadores = await listarAutorizadores(db);
  const autorizador = autorizadores.find((a) => a.id === datos.autorizadorId);
  if (!autorizador) {
    return { autorizado: false, error: "Ese usuario no puede autorizar esta acción." };
  }

  const fila = await db.getFirstAsync<{ hash_local: string; salt: string }>(
    "SELECT hash_local, salt FROM pin_cache WHERE usuario_local_id = ?",
    datos.autorizadorId,
  );
  if (!fila) {
    return { autorizado: false, error: "Ese usuario no tiene PIN configurado en esta terminal." };
  }

  const intento = await derivarHashPin(datos.pin, fila.salt);
  if (intento !== fila.hash_local) {
    // Mensaje único a propósito: no se distingue "PIN incorrecto" de "usuario sin permiso" más
    // allá de lo ya comprobado, para no dar pistas a quien pruebe PINes.
    return { autorizado: false, error: "PIN incorrecto." };
  }

  return { autorizado: true, autorizador };
}
