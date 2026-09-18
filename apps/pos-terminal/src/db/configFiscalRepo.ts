import type { SQLiteDatabase } from "expo-sqlite";
import { obtenerConfig, guardarConfig } from "./configLocalRepo";

export interface DatosFiscales {
  nombreSucursalLocal: string;
  razonSocial: string;
  rfc: string;
  direccion: string;
  pieTicket: string;
  tasaImpuesto: number;
  anchoImpresoraMM: 58 | 80;
}

const CLAVE = "datos_fiscales";
const CLAVE_PRIMER_ARRANQUE = "primer_arranque_completado";

const DEFAULT: DatosFiscales = {
  nombreSucursalLocal: "",
  razonSocial: "",
  rfc: "",
  direccion: "",
  pieTicket: "¡Gracias por su compra!",
  tasaImpuesto: 0.16,
  anchoImpresoraMM: 58,
};

export async function obtenerDatosFiscales(db: SQLiteDatabase): Promise<DatosFiscales> {
  const raw = await obtenerConfig(db, CLAVE);
  if (!raw) return DEFAULT;
  return { ...DEFAULT, ...JSON.parse(raw) };
}

export async function guardarDatosFiscales(db: SQLiteDatabase, datos: DatosFiscales): Promise<void> {
  await guardarConfig(db, CLAVE, JSON.stringify(datos));
}

export async function primerArranqueCompletado(db: SQLiteDatabase): Promise<boolean> {
  return (await obtenerConfig(db, CLAVE_PRIMER_ARRANQUE)) === "true";
}

export async function marcarPrimerArranqueCompletado(db: SQLiteDatabase): Promise<void> {
  await guardarConfig(db, CLAVE_PRIMER_ARRANQUE, "true");
}
