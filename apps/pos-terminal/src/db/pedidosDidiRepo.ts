import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7 } from "@hangar421/shared";
import type { ItemPedidoDidi } from "../plataformas/productosDidi";

/**
 * Pedidos de DiDi confirmados en la tablet que se están preparando: la lista que se ve hasta que
 * llega el repartidor y se cobran. Local a propósito: el ERP recibe la VENTA al cobrarse, como
 * cualquier otra; esta lista es solo la mesa de trabajo de la cocina y la caja.
 */
export interface PedidoDidiLocal {
  id: string;
  numero: string | null;
  cliente: string | null;
  totalLeido: number | null;
  textoOriginal: string;
  items: ItemPedidoDidi[];
  estado: "PREPARANDO" | "COBRADO" | "CANCELADO";
  ventaId: string | null;
  createdAt: string;
}

function aPedido(f: any): PedidoDidiLocal {
  let items: ItemPedidoDidi[] = [];
  try {
    items = JSON.parse(f.items);
  } catch {
    items = [];
  }
  return {
    id: f.id,
    numero: f.numero ?? null,
    cliente: f.cliente ?? null,
    totalLeido: f.total_leido ?? null,
    textoOriginal: f.texto_original ?? "",
    items,
    estado: f.estado,
    ventaId: f.venta_id ?? null,
    createdAt: f.created_at,
  };
}

export async function crearPedidoDidi(
  db: SQLiteDatabase,
  datos: { numero: string | null; cliente: string | null; totalLeido: number | null; textoOriginal: string; items: ItemPedidoDidi[] },
): Promise<string> {
  const id = uuid7();
  const ahora = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO pedidos_didi (id, numero, cliente, total_leido, texto_original, items, estado, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'PREPARANDO', ?, ?)`,
    id, datos.numero, datos.cliente, datos.totalLeido, datos.textoOriginal, JSON.stringify(datos.items), ahora, ahora,
  );
  return id;
}

/** Los que están en preparación, el más antiguo primero (es el que primero recoge el repartidor). */
export async function listarPedidosDidiEnPreparacion(db: SQLiteDatabase): Promise<PedidoDidiLocal[]> {
  const filas = await db.getAllAsync<any>("SELECT * FROM pedidos_didi WHERE estado = 'PREPARANDO' ORDER BY created_at ASC");
  return filas.map(aPedido);
}

export async function obtenerPedidoDidi(db: SQLiteDatabase, id: string): Promise<PedidoDidiLocal | null> {
  const f = await db.getFirstAsync<any>("SELECT * FROM pedidos_didi WHERE id = ?", id);
  return f ? aPedido(f) : null;
}

export async function marcarPedidoDidiCobrado(db: SQLiteDatabase, id: string, ventaId: string): Promise<void> {
  await db.runAsync(
    "UPDATE pedidos_didi SET estado = 'COBRADO', venta_id = ?, updated_at = ? WHERE id = ? AND estado = 'PREPARANDO'",
    ventaId, new Date().toISOString(), id,
  );
}

export async function cancelarPedidoDidi(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync("UPDATE pedidos_didi SET estado = 'CANCELADO', updated_at = ? WHERE id = ? AND estado = 'PREPARANDO'", new Date().toISOString(), id);
}

/** DiDi canceló el pedido: sale de la lista de preparación. Devuelve cuántos se cancelaron
 *  (0 si ese número no estaba en preparación). El número se compara sin "#" ni mayúsculas. */
export async function cancelarPedidoDidiPorNumero(db: SQLiteDatabase, numero: string): Promise<number> {
  const limpio = numero.replace(/^#/, "").trim().toUpperCase();
  if (!limpio) return 0;
  const r: any = await db.runAsync(
    "UPDATE pedidos_didi SET estado = 'CANCELADO', updated_at = ? WHERE estado = 'PREPARANDO' AND UPPER(REPLACE(COALESCE(numero, ''), '#', '')) = ?",
    new Date().toISOString(), limpio,
  );
  return Number(r?.changes ?? 0);
}
