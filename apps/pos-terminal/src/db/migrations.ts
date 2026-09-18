import type { SQLiteDatabase } from "expo-sqlite";

export interface Migracion {
  version: number;
  /** Nombre corto para logs/diagnóstico — no afecta la ejecución. */
  nombre: string;
  up: (db: SQLiteDatabase) => Promise<void>;
}

/** Migraciones en orden estricto por `version` — nunca se edita una ya publicada, solo se
 *  agregan nuevas al final. Cada `up()` corre dentro de una única transacción (ver
 *  `ejecutarMigraciones` abajo), así que un fallo a mitad de una migración no dejan el esquema a
 *  medias. Mismo criterio de "sin librería externa" que sigue el resto del proyecto (el motor de
 *  sync, el outbox, etc. tampoco usan una librería de migraciones). */
export const MIGRACIONES: Migracion[] = [
  {
    version: 1,
    nombre: "esquema_inicial",
    up: async (db) => {
      // Catálogo — poblado por /sync/pull (Fase 2a), de solo lectura offline entre sincronizaciones.
      await db.execAsync(`
        CREATE TABLE categorias_producto (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          orden INTEGER NOT NULL DEFAULT 0,
          activo INTEGER NOT NULL DEFAULT 1,
          updated_at_server TEXT,
          synced_at TEXT
        );

        CREATE TABLE productos (
          id TEXT PRIMARY KEY,
          categoria_id TEXT REFERENCES categorias_producto(id),
          nombre TEXT NOT NULL,
          precio_base REAL NOT NULL DEFAULT 0,
          tasa_impuesto REAL NOT NULL DEFAULT 0,
          sku TEXT,
          activo INTEGER NOT NULL DEFAULT 1,
          imagen_url TEXT,
          updated_at_server TEXT,
          synced_at TEXT
        );
        CREATE INDEX idx_productos_categoria ON productos(categoria_id);

        -- Configurable localmente (no viene del ERP) — efectivo/tarjeta/transferencia/otro.
        CREATE TABLE metodos_pago_config (
          id TEXT PRIMARY KEY,
          tipo TEXT NOT NULL CHECK(tipo IN ('EFECTIVO','TARJETA','TRANSFERENCIA','QR','OTRO')),
          habilitado INTEGER NOT NULL DEFAULT 1,
          orden INTEGER NOT NULL DEFAULT 0
        );

        -- Mesas: función opcional, desactivada salvo que se active en configuración inicial
        -- (Fase 2b) — Punto de Venta es mostrador/contador por defecto.
        CREATE TABLE mesas (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          estado TEXT NOT NULL DEFAULT 'LIBRE',
          orden INTEGER NOT NULL DEFAULT 0
        );

        -- Venta: una sola transacción por venta completada cubre esta tabla + venta_items +
        -- pagos + descuentos + las filas de sync_outbox correspondientes, todo o nada.
        CREATE TABLE ventas (
          id TEXT PRIMARY KEY,
          folio_local INTEGER NOT NULL,
          mesa_id TEXT REFERENCES mesas(id),
          cliente_id TEXT,
          estado TEXT NOT NULL CHECK(estado IN ('ABIERTA','COBRADA','CANCELADA')) DEFAULT 'ABIERTA',
          subtotal REAL NOT NULL DEFAULT 0,
          descuento_monto REAL NOT NULL DEFAULT 0,
          impuestos REAL NOT NULL DEFAULT 0,
          total REAL NOT NULL DEFAULT 0,
          canal_origen TEXT NOT NULL DEFAULT 'APP_POS_MOVIL',
          turno_id TEXT,
          usuario_id TEXT,
          notas TEXT,
          ticket_pendiente_impresion INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE
        );
        CREATE INDEX idx_ventas_estado ON ventas(estado);
        CREATE INDEX idx_ventas_turno ON ventas(turno_id);

        CREATE TABLE venta_items (
          id TEXT PRIMARY KEY,
          venta_id TEXT NOT NULL REFERENCES ventas(id),
          producto_id TEXT NOT NULL,
          nombre_snapshot TEXT NOT NULL,
          precio_unit_snapshot REAL NOT NULL,
          cantidad REAL NOT NULL,
          descuento_item REAL NOT NULL DEFAULT 0,
          notas TEXT
        );
        CREATE INDEX idx_venta_items_venta ON venta_items(venta_id);

        CREATE TABLE pagos (
          id TEXT PRIMARY KEY,
          venta_id TEXT NOT NULL REFERENCES ventas(id),
          metodo TEXT NOT NULL,
          monto REAL NOT NULL,
          referencia TEXT,
          created_at TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE
        );
        CREATE INDEX idx_pagos_venta ON pagos(venta_id);

        CREATE TABLE descuentos (
          id TEXT PRIMARY KEY,
          venta_id TEXT NOT NULL REFERENCES ventas(id),
          tipo TEXT NOT NULL,
          valor REAL NOT NULL,
          motivo TEXT,
          autorizado_por_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_descuentos_venta ON descuentos(venta_id);

        -- Caja / turnos.
        CREATE TABLE turnos (
          id TEXT PRIMARY KEY,
          caja_id TEXT,
          usuario_id TEXT NOT NULL,
          monto_inicial REAL NOT NULL DEFAULT 0,
          monto_final_declarado REAL,
          estado TEXT NOT NULL CHECK(estado IN ('ABIERTO','CERRADO')) DEFAULT 'ABIERTO',
          abierto_at TEXT NOT NULL,
          cerrado_at TEXT,
          idempotency_key TEXT NOT NULL UNIQUE
        );
        CREATE INDEX idx_turnos_estado ON turnos(estado);

        CREATE TABLE movimientos_caja (
          id TEXT PRIMARY KEY,
          turno_id TEXT NOT NULL REFERENCES turnos(id),
          tipo TEXT NOT NULL,
          monto REAL NOT NULL,
          motivo TEXT,
          created_at TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE
        );
        CREATE INDEX idx_movimientos_caja_turno ON movimientos_caja(turno_id);

        -- Cola de sincronización — evoluciona el outbox JSON/AsyncStorage de waiter-mobile a SQL
        -- real, mismo contrato de idempotencyKey ya probado contra POST /sync/push.
        CREATE TABLE sync_outbox (
          local_id TEXT PRIMARY KEY,
          entidad TEXT NOT NULL,
          operacion TEXT NOT NULL CHECK(operacion IN ('CREATE','UPDATE','DELETE')),
          entidad_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          sucursal_id TEXT NOT NULL,
          dispositivo_id TEXT NOT NULL,
          usuario_id TEXT,
          payload TEXT NOT NULL,
          estado TEXT NOT NULL CHECK(estado IN ('PENDING','SYNCING','SYNCED','ERROR')) DEFAULT 'PENDING',
          intentos INTEGER NOT NULL DEFAULT 0,
          ultimo_error TEXT,
          orden_secuencia INTEGER NOT NULL,
          next_retry_at TEXT,
          created_at TEXT NOT NULL,
          synced_at TEXT
        );
        CREATE INDEX idx_sync_outbox_estado ON sync_outbox(estado, orden_secuencia);

        CREATE TABLE sync_error_log (
          id TEXT PRIMARY KEY,
          outbox_local_id TEXT,
          entidad TEXT NOT NULL,
          mensaje TEXT NOT NULL,
          payload_snapshot TEXT,
          created_at TEXT NOT NULL
        );

        -- Config local (clave-valor, igual criterio que configJson en Sucursal/Empresa del
        -- backend): identidad de sucursal, datos fiscales/ticket, impresora, conexión ERP,
        -- cursor de pull, cadencia de revalidación offline.
        CREATE TABLE config_local (
          clave TEXT PRIMARY KEY,
          valor TEXT NOT NULL
        );

        -- Auth local — ver src/auth/offlineAuth.ts (Fase 1): nunca se guarda el hash bcrypt real
        -- ni el PIN en texto plano, solo un hash local salado derivado de un login exitoso.
        CREATE TABLE usuarios_locales (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          rol TEXT NOT NULL,
          erp_usuario_id TEXT,
          activo INTEGER NOT NULL DEFAULT 1,
          ultima_verificacion_online TEXT
        );

        CREATE TABLE pin_cache (
          usuario_local_id TEXT PRIMARY KEY REFERENCES usuarios_locales(id),
          hash_local TEXT NOT NULL,
          salt TEXT NOT NULL,
          algoritmo TEXT NOT NULL DEFAULT 'sha256-v1',
          creado_at TEXT NOT NULL,
          expira_at TEXT
        );
      `);
    },
  },
];

/** Corre, en orden, toda migración con `version` mayor a la ya aplicada — cada una dentro de su
 *  propia transacción, así que un fallo a mitad de una no dejan el esquema a medias ni se
 *  reintenta desde cero la migración anterior que sí completó. */
export async function ejecutarMigraciones(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);`);
  const fila = await db.getFirstAsync<{ version: number }>("SELECT version FROM schema_version LIMIT 1");
  if (!fila) await db.runAsync("INSERT INTO schema_version (version) VALUES (0)");
  const actual = fila?.version ?? 0;

  const pendientes = MIGRACIONES.filter((m) => m.version > actual).sort((a, b) => a.version - b.version);
  for (const migracion of pendientes) {
    await db.withTransactionAsync(async () => {
      await migracion.up(db);
      await db.runAsync("UPDATE schema_version SET version = ?", migracion.version);
    });
  }
}
