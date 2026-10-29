import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7, SyncEntidad, SyncOperacion, lechePorOmision, type GrupoParaOmision } from "@hangar421/shared";
import { encolarSync } from "./outboxRepo";
import { insumosConCambiosPendientes } from "./insumosLocalesRepo";
import { obtenerOCrearDispositivoId, obtenerOCrearSucursalIdLocal } from "./dispositivoLocal";
import type { ExistenciaInsumo } from "../inventario/niveles";
import { aplicarPendientes, tipoDeMovimiento, type AjustePendiente } from "../inventario/existenciaLocal";

export type TipoMovimientoInv = "ENTRADA" | "SALIDA" | "AJUSTE" | "MERMA" | "CONTEO";

export interface MovimientoInventarioLocal {
  id: string;
  insumoId: string;
  nombreInsumo: string;
  tipo: TipoMovimientoInv;
  cantidad: number;
  motivo: string | null;
  createdAt: string;
}

/** Existencias de la sucursal activa, con los datos del insumo ya unidos — es lo que pinta la
 *  pantalla y lo que alimenta la lista de compras, así que se resuelve en una sola consulta. */
export async function listarExistencias(db: SQLiteDatabase): Promise<ExistenciaInsumo[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    `SELECT i.id, i.nombre, i.unidad_medida, i.costo_unitario, i.proveedor_nombre,
            i.presentacion_nombre, i.presentacion_cantidad,
            COALESCE(inv.existencia, 0) AS existencia,
            COALESCE(inv.minimo, 0) AS minimo,
            inv.maximo
     FROM insumos i
     LEFT JOIN inventario_local inv ON inv.insumo_id = i.id AND inv.sucursal_id = ?
     WHERE i.activo = 1 AND i.es_preparacion = 0
     ORDER BY i.nombre`,
    sucursalId,
  );
  return filas.map((f) => ({
    insumoId: f.id,
    nombre: f.nombre,
    unidadMedida: f.unidad_medida,
    existencia: f.existencia,
    minimo: f.minimo,
    maximo: f.maximo,
    costoUnitario: f.costo_unitario,
    proveedorNombre: f.proveedor_nombre,
    presentacionNombre: f.presentacion_nombre ?? null,
    presentacionCantidad: f.presentacion_cantidad ?? null,
  }));
}

export interface InsumoLocal {
  id: string;
  nombre: string;
  unidadMedida: string;
  costoUnitario: number;
  proveedorId: string | null;
  proveedorNombre: string | null;
  activo: boolean;
  minimo: number;
  maximo: number | null;
  presentacionNombre: string | null;
  presentacionCantidad: number | null;
}

/** Catálogo de insumos tal como bajó del ERP, INCLUIDOS los dados de baja: la pestaña de
 *  Insumos los necesita para reactivarlos y para no dar de alta un duplicado de uno inactivo. */
export async function listarInsumosLocales(db: SQLiteDatabase): Promise<InsumoLocal[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    `SELECT i.id, i.nombre, i.unidad_medida, i.costo_unitario, i.proveedor_id, i.proveedor_nombre, i.activo,
            i.presentacion_nombre, i.presentacion_cantidad,
            COALESCE(inv.minimo, 0) AS minimo, inv.maximo
     FROM insumos i
     LEFT JOIN inventario_local inv ON inv.insumo_id = i.id AND inv.sucursal_id = ?
     ORDER BY i.activo DESC, i.nombre`,
    sucursalId,
  );
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    unidadMedida: f.unidad_medida,
    costoUnitario: Number(f.costo_unitario) || 0,
    proveedorId: f.proveedor_id ?? null,
    proveedorNombre: f.proveedor_nombre ?? null,
    activo: f.activo === 1,
    minimo: Number(f.minimo) || 0,
    maximo: f.maximo != null ? Number(f.maximo) : null,
    presentacionNombre: f.presentacion_nombre ?? null,
    presentacionCantidad: f.presentacion_cantidad != null ? Number(f.presentacion_cantidad) : null,
  }));
}

/**
 * Registra un movimiento: actualiza el saldo local y lo encola hacia el ERP, todo en una
 * transacción. El saldo autoritativo lo lleva el ERP —que aplica el mismo movimiento cuando le
 * llega— pero el local tiene que moverse ya o el cajero no vería el efecto de lo que acaba de
 * hacer hasta la próxima sincronización.
 *
 * CONTEO es distinto de los demás: no suma ni resta, FIJA la existencia al valor contado. Es la
 * misma semántica que `InventarioService.registrarMovimiento` en el backend, y tratarlo como un
 * ajuste relativo descuadraría el almacén en cada conteo físico.
 */
export async function registrarMovimiento(
  db: SQLiteDatabase,
  datos: { insumoId: string; tipo: TipoMovimientoInv; cantidad: number; motivo?: string; usuarioId: string },
): Promise<void> {
  const id = uuid7();
  const ahora = new Date().toISOString();
  const idempotencyKey = uuid7();
  const [sucursalId, dispositivoId] = await Promise.all([
    obtenerOCrearSucursalIdLocal(db),
    obtenerOCrearDispositivoId(db),
  ]);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO movimientos_inventario (id, sucursal_id, insumo_id, tipo, cantidad, motivo, usuario_id, created_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, sucursalId, datos.insumoId, datos.tipo, datos.cantidad, datos.motivo ?? null, datos.usuarioId, ahora, idempotencyKey,
    );

    // La fila de inventario puede no existir todavía (insumo que nunca se movió en esta
    // sucursal), de ahí el upsert en vez de un UPDATE.
    if (datos.tipo === "CONTEO") {
      await db.runAsync(
        `INSERT INTO inventario_local (sucursal_id, insumo_id, existencia, minimo, updated_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(sucursal_id, insumo_id) DO UPDATE SET existencia = excluded.existencia, updated_at = excluded.updated_at`,
        sucursalId, datos.insumoId, datos.cantidad, ahora,
      );
    } else {
      const signo = datos.tipo === "ENTRADA" || datos.tipo === "AJUSTE" ? 1 : -1;
      await db.runAsync(
        `INSERT INTO inventario_local (sucursal_id, insumo_id, existencia, minimo, updated_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(sucursal_id, insumo_id) DO UPDATE SET existencia = existencia + ?, updated_at = ?`,
        sucursalId, datos.insumoId, signo * datos.cantidad, ahora, signo * datos.cantidad, ahora,
      );
    }

    await encolarSync(db, {
      entidad: SyncEntidad.MOVIMIENTO_INVENTARIO,
      operacion: SyncOperacion.CREATE,
      entidadId: id,
      sucursalId,
      dispositivoId,
      usuarioId: datos.usuarioId,
      payload: { insumoId: datos.insumoId, tipo: datos.tipo, cantidad: datos.cantidad, motivo: datos.motivo },
    });
  });
}

export async function listarMovimientosRecientes(db: SQLiteDatabase, limite = 30): Promise<MovimientoInventarioLocal[]> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const filas = await db.getAllAsync<any>(
    `SELECT m.id, m.insumo_id, COALESCE(i.nombre, '—') AS nombre, m.tipo, m.cantidad, m.motivo, m.created_at
     FROM movimientos_inventario m LEFT JOIN insumos i ON i.id = m.insumo_id
     WHERE m.sucursal_id = ? ORDER BY m.created_at DESC LIMIT ?`,
    sucursalId, limite,
  );
  return filas.map((f) => ({
    id: f.id,
    insumoId: f.insumo_id,
    nombreInsumo: f.nombre,
    tipo: f.tipo,
    cantidad: f.cantidad,
    motivo: f.motivo,
    createdAt: f.created_at,
  }));
}

interface InsumoRemoto {
  id: string; nombre: string; unidadMedida: string; costoUnitario: number;
  proveedorId?: string | null; proveedor?: { nombre: string } | null; activo: boolean;
  /** Empaque de compra: "Cartón" de 1000 ml (ver presentacion.ts en shared). */
  presentacionNombre?: string | null; presentacionCantidad?: number | string | null;
  /** Preparación de la casa: no tiene existencia, se descuentan sus ingredientes. */
  esPreparacion?: boolean;
}
interface ExistenciaRemota {
  insumoId: string; existencia: number | string; minimo: number | string; maximo?: number | string | null;
}

/**
 * Vuelca el inventario del ERP en la base local.
 *
 * El saldo del ERP GANA sobre el local: él ya aplicó las ventas de todas las terminales y los
 * movimientos de todas ellas, así que es la única foto completa. Lo que esta terminal tenga
 * pendiente en el outbox se volverá a aplicar server-side y bajará en el siguiente refresco —
 * por eso no se intenta reconciliar aquí, que es donde estos sistemas se llenan de bugs.
 */
export async function upsertInventario(db: SQLiteDatabase, insumos: InsumoRemoto[], existencias: ExistenciaRemota[]): Promise<void> {
  const sucursalId = await obtenerOCrearSucursalIdLocal(db);
  const ahora = new Date().toISOString();

  // Un insumo editado en esta tablet y todavía sin subir no se pisa con la versión vieja del ERP:
  // ganaría la copia anterior y el cambio se vería "deshacerse" hasta la siguiente descarga.
  const pendientes = await insumosConCambiosPendientes(db);
  await db.withTransactionAsync(async () => {
    for (const i of insumos) {
      if (pendientes.has(i.id)) continue;
      await db.runAsync(
        `INSERT INTO insumos (id, nombre, unidad_medida, costo_unitario, proveedor_id, proveedor_nombre, activo, synced_at, presentacion_nombre, presentacion_cantidad, es_preparacion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, unidad_medida = excluded.unidad_medida,
           costo_unitario = excluded.costo_unitario, proveedor_id = excluded.proveedor_id,
           proveedor_nombre = excluded.proveedor_nombre, activo = excluded.activo, synced_at = excluded.synced_at,
           presentacion_nombre = excluded.presentacion_nombre, presentacion_cantidad = excluded.presentacion_cantidad,
           es_preparacion = excluded.es_preparacion`,
        i.id, i.nombre, i.unidadMedida ?? "pz", Number(i.costoUnitario) || 0,
        i.proveedorId ?? null, i.proveedor?.nombre ?? null, i.activo ? 1 : 0, ahora,
        i.presentacionNombre ?? null, i.presentacionCantidad != null ? Number(i.presentacionCantidad) : null,
        i.esPreparacion ? 1 : 0,
      );
    }

    // Igual que con los productos (catalogoSyncRepo.upsertCatalogo): el ERP solo manda los
    // insumos activos, así que uno dado de baja —incluso desde esta misma tablet— dejaba de
    // llegar y aquí se quedaba activo para siempre. Lo que no vino en esta descarga se apaga.
    // Con lista vacía no se toca nada: puede ser una respuesta rara y dejaría la pantalla vacía.
    if (insumos.length > 0) {
      await db.runAsync(
        "UPDATE insumos SET activo = 0 WHERE synced_at IS NOT NULL AND synced_at <> ? AND activo = 1",
        ahora,
      );
    }

    // Solo existencias de insumos que esta tablet conoce. El ERP también manda las de insumos
    // dados de baja (que ya no vienen en la lista de insumos): con la llave foránea de
    // inventario_local eso hacía fallar TODA la descarga ("FOREIGN KEY constraint failed") y la
    // tablet se quedaba para siempre con el inventario viejo.
    for (const e of existencias) {
      await db.runAsync(
        `INSERT INTO inventario_local (sucursal_id, insumo_id, existencia, minimo, maximo, updated_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM insumos WHERE id = ?)
         ON CONFLICT(sucursal_id, insumo_id) DO UPDATE SET existencia = excluded.existencia,
           minimo = excluded.minimo, maximo = excluded.maximo, updated_at = excluded.updated_at`,
        sucursalId, e.insumoId, Number(e.existencia) || 0, Number(e.minimo) || 0,
        e.maximo != null ? Number(e.maximo) : null, ahora, e.insumoId,
      );
    }

    // Encima de la cifra oficial, lo que esta tablet hizo y aún no sube (ventas, conteos,
    // entradas, mermas). Sin esto la existencia "brincaba" hacia arriba hasta que la venta
    // llegaba al ERP.
    await aplicarPendientesLocales(db, sucursalId, existencias);
  });
}

/**
 * Vuelve a aplicar sobre la existencia oficial recién bajada lo que sigue en la cola de esta
 * tablet: movimientos de inventario sin sincronizar y el consumo de ventas sin sincronizar. El
 * consumo de ventas que el ERP ya recibió se borra (la cifra oficial ya lo trae).
 */
export async function aplicarPendientesLocales(
  db: SQLiteDatabase,
  sucursalId: string,
  existencias: { insumoId: string; existencia: number | string }[],
): Promise<void> {
  await db.runAsync(
    `DELETE FROM consumo_local_pendiente WHERE venta_id NOT IN (
       SELECT entidad_id FROM sync_outbox WHERE entidad = ? AND operacion = 'CREATE' AND estado <> 'SYNCED')`,
    SyncEntidad.PEDIDO,
  );
  const consumos = await db.getAllAsync<{ insumo_id: string; cantidad: number; created_at: string }>(
    "SELECT insumo_id, cantidad, created_at FROM consumo_local_pendiente WHERE sucursal_id = ?",
    sucursalId,
  );
  const movimientos = await db.getAllAsync<{ payload: string; created_at: string }>(
    "SELECT payload, created_at FROM sync_outbox WHERE entidad = ? AND estado <> 'SYNCED' AND sucursal_id = ?",
    SyncEntidad.MOVIMIENTO_INVENTARIO, sucursalId,
  );
  const ajustes: AjustePendiente[] = consumos.map((c) => ({ insumoId: c.insumo_id, tipo: "RESTAR" as const, cantidad: c.cantidad, fecha: c.created_at }));
  for (const m of movimientos) {
    try {
      const p = JSON.parse(m.payload);
      if (p?.insumoId) ajustes.push({ insumoId: p.insumoId, tipo: tipoDeMovimiento(String(p.tipo)), cantidad: Number(p.cantidad), fecha: m.created_at });
    } catch {
      /* un payload ilegible no debe tumbar la descarga */
    }
  }
  if (ajustes.length === 0) return;
  const oficial = new Map(existencias.map((e) => [e.insumoId, Number(e.existencia) || 0]));
  const finales = aplicarPendientes(oficial, ajustes);
  for (const [insumoId, existencia] of finales) {
    await db.runAsync(
      "UPDATE inventario_local SET existencia = ? WHERE sucursal_id = ? AND insumo_id = ?",
      existencia, sucursalId, insumoId,
    );
  }
}

/** Movimientos de inventario de ESTA terminal que todavía no han llegado al ERP. Sale del
 *  outbox, que es la única fuente fiable de "qué falta por subir" — la tabla local de
 *  movimientos guarda el histórico, no el estado de sincronización. */
export async function contarMovimientosInventarioPendientes(db: SQLiteDatabase): Promise<number> {
  const fila = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM sync_outbox
     WHERE entidad = ? AND estado IN ('PENDING','ERROR')`,
    SyncEntidad.MOVIMIENTO_INVENTARIO,
  );
  return fila?.total ?? 0;
}

// ---------------------------------------------------------------------------- recetas locales

export interface RecetasRemotas {
  porProducto: { productoId: string; insumoId: string; cantidad: number }[];
  porOpcion: { opcionModificadorId: string; insumoId: string; cantidad: number }[];
  /** Preparaciones de la casa (cold foam), por UNA unidad de la preparación. */
  porPreparacion?: { preparacionId: string; insumoId: string; cantidad: number }[];
}

/** Reemplaza las recetas guardadas con las del ERP (copia de solo lectura, como el catálogo). */
export async function upsertRecetas(db: SQLiteDatabase, recetas: RecetasRemotas): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM recetas");
    await db.runAsync("DELETE FROM recetas_opcion");
    for (const r of recetas.porProducto) {
      await db.runAsync(
        "INSERT OR REPLACE INTO recetas (producto_id, insumo_id, cantidad) VALUES (?, ?, ?)",
        r.productoId, r.insumoId, Number(r.cantidad) || 0,
      );
    }
    for (const r of recetas.porOpcion) {
      await db.runAsync(
        "INSERT OR REPLACE INTO recetas_opcion (opcion_modificador_id, insumo_id, cantidad) VALUES (?, ?, ?)",
        r.opcionModificadorId, r.insumoId, Number(r.cantidad) || 0,
      );
    }
    // Un ERP anterior no manda preparaciones: entonces no se tocan las que ya hubiera.
    if (recetas.porPreparacion) {
      await db.runAsync("DELETE FROM recetas_preparacion");
      for (const r of recetas.porPreparacion) {
        await db.runAsync(
          "INSERT OR REPLACE INTO recetas_preparacion (preparacion_id, insumo_id, cantidad) VALUES (?, ?, ?)",
          r.preparacionId, r.insumoId, Number(r.cantidad) || 0,
        );
      }
    }
  });
}

/** Recetas que hacen falta para calcular lo que consume una venta (ver consumoDeVenta en shared). */
/**
 * Datos para ajustar la leche de cada bebida (ver @hangar421/shared lechePorBebida): los gramos
 * que define cada producto y el grupo/nombre de las opciones elegidas. Sin columnas o sin filas
 * (catálogo aún sin bajar) regresa vacío y se usa la receta de la opción, como antes.
 */
export async function lecheParaConsumo(
  db: SQLiteDatabase,
  productoIds: string[],
  opcionIds: string[],
): Promise<{
  porProducto: Record<string, { base: number | null; conColdFoam: number | null; conShot: number | null; conAmbos: number | null }>;
  opciones: Record<string, { grupo: string; opcion: string }>;
  /** Leche entera que se descuenta si la bebida lleva leche y no eligieron una (ver lechePorOmision). */
  porOmision?: string | null;
}> {
  const vacio = { porProducto: {}, opciones: {}, porOmision: null };
  // Antes salía si no había opciones: una bebida con leche vendida sin elegir leche (pedido de
  // DiDi) no descontaba leche. Ahora se carga igual para aplicar la leche por omisión.
  if (productoIds.length === 0) return vacio;
  const marcas = (n: number) => Array.from({ length: n }, () => "?").join(",");
  try {
    const productos = await db.getAllAsync<{ id: string; leche_base: number | null; leche_con_cold_foam: number | null; leche_con_shot: number | null; leche_con_ambos: number | null }>(
      `SELECT id, leche_base, leche_con_cold_foam, leche_con_shot, leche_con_ambos FROM productos WHERE leche_base IS NOT NULL AND id IN (${marcas(productoIds.length)})`,
      ...productoIds,
    );
    if (productos.length === 0) return vacio;
    const opciones = opcionIds.length
      ? await db.getAllAsync<{ id: string; opcion: string; grupo: string }>(
          `SELECT o.id AS id, o.nombre AS opcion, m.nombre AS grupo FROM opciones_modificador o JOIN modificadores m ON m.id = o.modificador_id WHERE o.id IN (${marcas(opcionIds.length)})`,
          ...opcionIds,
        )
      : [];
    const enteras = await db.getAllAsync<{ id: string; opcion: string; grupo: string; insumo_id: string | null; cantidad: number | null }>(
      `SELECT o.id AS id, o.nombre AS opcion, m.nombre AS grupo, r.insumo_id AS insumo_id, r.cantidad AS cantidad
         FROM opciones_modificador o JOIN modificadores m ON m.id = o.modificador_id
         LEFT JOIN recetas_opcion r ON r.opcion_modificador_id = o.id
        WHERE LOWER(o.nombre) LIKE '%entera%' AND LOWER(m.nombre) LIKE '%leche%'`,
    );
    const porOpcionEntera = new Map<string, { grupo: string; opcion: string; receta: { insumoId: string; cantidad: number }[] }>();
    for (const e of enteras) {
      const g = porOpcionEntera.get(e.id) ?? { grupo: e.grupo, opcion: e.opcion, receta: [] };
      if (e.insumo_id) g.receta.push({ insumoId: e.insumo_id, cantidad: Number(e.cantidad) || 0 });
      porOpcionEntera.set(e.id, g);
    }
    const porOmision = lechePorOmision([...porOpcionEntera.values()]);
    const porProducto: Record<string, { base: number | null; conColdFoam: number | null; conShot: number | null; conAmbos: number | null }> = {};
    for (const p of productos) {
      porProducto[p.id] = { base: p.leche_base, conColdFoam: p.leche_con_cold_foam, conShot: p.leche_con_shot, conAmbos: p.leche_con_ambos };
    }
    const porOpcion: Record<string, { grupo: string; opcion: string }> = {};
    for (const o of opciones) porOpcion[o.id] = { grupo: o.grupo, opcion: o.opcion };
    return { porProducto, opciones: porOpcion, porOmision };
  } catch {
    return vacio;
  }
}

/** Grupos obligatorios de cada producto (con sus opciones), para la opción por omisión del
 *  inventario (ver opcionesObligatoriasPorOmision en shared). Vacío si algo falla. */
export async function gruposObligatoriosLocales(db: SQLiteDatabase, productoIds: string[]): Promise<Record<string, GrupoParaOmision[]>> {
  if (productoIds.length === 0) return {};
  const marcas = productoIds.map(() => "?").join(",");
  try {
    const filas = await db.getAllAsync<{ producto_id: string; modificador_id: string; nombre: string; tipo: string; opcion_id: string | null; orden: number | null }>(
      `SELECT pm.producto_id, m.id AS modificador_id, m.nombre, m.tipo, o.id AS opcion_id, o.orden
         FROM producto_modificadores pm JOIN modificadores m ON m.id = pm.modificador_id
         LEFT JOIN opciones_modificador o ON o.modificador_id = m.id
        WHERE m.obligatorio = 1 AND pm.producto_id IN (${marcas})`,
      ...productoIds,
    );
    const salida: Record<string, GrupoParaOmision[]> = {};
    const indice = new Map<string, GrupoParaOmision>();
    for (const f of filas) {
      const clave = `${f.producto_id}|${f.modificador_id}`;
      let g = indice.get(clave);
      if (!g) {
        g = { nombre: f.nombre, obligatorio: true, tipo: f.tipo, opciones: [] };
        indice.set(clave, g);
        (salida[f.producto_id] ??= []).push(g);
      }
      if (f.opcion_id) g.opciones.push({ id: f.opcion_id, orden: Number(f.orden) || 0 });
    }
    return salida;
  } catch {
    return {};
  }
}

export async function recetasParaConsumo(
  db: SQLiteDatabase,
  productoIds: string[],
  opcionIds: string[],
): Promise<RecetasRemotas> {
  const marcas = (n: number) => Array.from({ length: n }, () => "?").join(",");
  const porProducto = productoIds.length
    ? await db.getAllAsync<{ producto_id: string; insumo_id: string; cantidad: number }>(
        `SELECT producto_id, insumo_id, cantidad FROM recetas WHERE producto_id IN (${marcas(productoIds.length)})`,
        ...productoIds,
      )
    : [];
  const porOpcion = opcionIds.length
    ? await db.getAllAsync<{ opcion_modificador_id: string; insumo_id: string; cantidad: number }>(
        `SELECT opcion_modificador_id, insumo_id, cantidad FROM recetas_opcion WHERE opcion_modificador_id IN (${marcas(opcionIds.length)})`,
        ...opcionIds,
      )
    : [];
  // Todas las preparaciones (son pocas): la expansión en cascada necesita las anidadas también.
  const porPreparacion = porProducto.length || porOpcion.length
    ? await db.getAllAsync<{ preparacion_id: string; insumo_id: string; cantidad: number }>(
        "SELECT preparacion_id, insumo_id, cantidad FROM recetas_preparacion",
      )
    : [];
  return {
    porProducto: porProducto.map((r) => ({ productoId: r.producto_id, insumoId: r.insumo_id, cantidad: r.cantidad })),
    porOpcion: porOpcion.map((r) => ({ opcionModificadorId: r.opcion_modificador_id, insumoId: r.insumo_id, cantidad: r.cantidad })),
    porPreparacion: porPreparacion.map((r) => ({ preparacionId: r.preparacion_id, insumoId: r.insumo_id, cantidad: r.cantidad })),
  };
}

/**
 * Baja del almacén local lo que consumió una venta.
 *
 * NO encola nada al ERP: el servidor descuenta por su cuenta al recibir la venta (ver
 * PedidosService.descontarInventarioPorReceta), así que mandar también un movimiento desde aquí
 * descontaría dos veces. Esto es para que la tablet muestre la existencia real en el momento —
 * aunque esté sin conexión — hasta que el siguiente pull traiga la cifra oficial del ERP.
 */
export async function descontarConsumoLocal(
  db: SQLiteDatabase,
  consumo: { insumoId: string; cantidad: number }[],
  sucursalId: string,
  ventaId?: string,
): Promise<void> {
  const ahora = new Date().toISOString();
  for (const c of consumo) {
    if (!(c.cantidad > 0)) continue;
    // Solo si el insumo existe en esta tablet: una receta puede usar uno que esta sucursal no
    // maneja, y con la llave foránea la resta tronaba a medias (las demás ya no se aplicaban).
    await db.runAsync(
      `INSERT INTO inventario_local (sucursal_id, insumo_id, existencia, minimo)
       SELECT ?, ?, ?, 0 WHERE EXISTS (SELECT 1 FROM insumos WHERE id = ?)
       ON CONFLICT(sucursal_id, insumo_id) DO UPDATE SET existencia = existencia - ?`,
      sucursalId, c.insumoId, -c.cantidad, c.insumoId, c.cantidad,
    );
    // Se recuerda hasta que la venta llegue al ERP, para volver a restarlo encima de la cifra
    // oficial que baje mientras tanto (ver aplicarPendientesLocales).
    if (ventaId) {
      await db.runAsync(
        "INSERT INTO consumo_local_pendiente (venta_id, sucursal_id, insumo_id, cantidad, created_at) VALUES (?, ?, ?, ?, ?)",
        ventaId, sucursalId, c.insumoId, c.cantidad, ahora,
      );
    }
  }
}
