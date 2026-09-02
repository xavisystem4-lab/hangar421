import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Cola de sincronización local basada en AsyncStorage (JSON). Para el volumen de operaciones
 * de un mesero (decenas por turno) es suficiente; si el volumen creciera, migrar a expo-sqlite
 * manteniendo la misma interfaz (documentado en docs/roadmap.md, Fase 2).
 */
const CLAVE = "hangar421_outbox";

export interface ItemOutbox {
  localId: string;
  entidad: string;
  operacion: "CREATE" | "UPDATE" | "DELETE";
  entidadId: string;
  idempotencyKey: string;
  sucursalId: string;
  dispositivoId: string;
  usuarioId?: string;
  payload: unknown;
  estado: "PENDING" | "SYNCED" | "ERROR";
  intentos: number;
  ultimoError?: string;
  createdAt: string;
}

async function leerTodo(): Promise<ItemOutbox[]> {
  const raw = await AsyncStorage.getItem(CLAVE);
  return raw ? JSON.parse(raw) : [];
}

async function guardarTodo(items: ItemOutbox[]) {
  await AsyncStorage.setItem(CLAVE, JSON.stringify(items));
}

export async function encolar(item: Omit<ItemOutbox, "estado" | "intentos" | "createdAt">) {
  const items = await leerTodo();
  if (items.some((i) => i.idempotencyKey === item.idempotencyKey)) return; // ya encolado
  items.push({ ...item, estado: "PENDING", intentos: 0, createdAt: new Date().toISOString() });
  await guardarTodo(items);
}

export async function pendientes(): Promise<ItemOutbox[]> {
  const items = await leerTodo();
  return items.filter((i) => i.estado === "PENDING" || i.estado === "ERROR");
}

export async function marcarSincronizado(localId: string) {
  const items = await leerTodo();
  await guardarTodo(items.map((i) => (i.localId === localId ? { ...i, estado: "SYNCED" as const } : i)));
}

export async function marcarError(localId: string, error: string) {
  const items = await leerTodo();
  await guardarTodo(items.map((i) => (i.localId === localId ? { ...i, estado: "ERROR" as const, ultimoError: error, intentos: i.intentos + 1 } : i)));
}

export async function contarPendientes(): Promise<number> {
  return (await pendientes()).length;
}

export async function obtenerOCrearDeviceId(): Promise<string> {
  const existente = await AsyncStorage.getItem("hangar421_device_id");
  if (existente) return existente;
  const id = `waiter-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem("hangar421_device_id", id);
  return id;
}

export async function guardarEnCache(coleccion: string, datos: unknown[]) {
  await AsyncStorage.setItem(`hangar421_cache_${coleccion}`, JSON.stringify(datos));
}

export async function leerCache<T>(coleccion: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(`hangar421_cache_${coleccion}`);
  return raw ? JSON.parse(raw) : [];
}
