import type { SQLiteDatabase } from "expo-sqlite";
import { uuid7 } from "@hangar421/shared";

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
  {
    version: 2,
    nombre: "catalogo_subcategoria_orden_origen",
    up: async (db) => {
      // `subcategoria` no es cosmética: el catálogo real tiene homónimos que solo se distinguen
      // por ella ("Pistache" galleta 80 vs. rol 155), y sin mostrarla el cajero no sabe cuál
      // está tocando. `orden` replica el del ERP para que la cuadrícula salga en el mismo orden
      // que el POS de Windows en vez de alfabético.
      //
      // `origen` separa lo que se sembró en este dispositivo (catalogoHangar.ts) de lo que baja
      // del ERP: son ids distintos para el mismo café, así que sin esta marca un enlace
      // posterior al ERP dejaría el catálogo duplicado. Las filas que ya existían vienen todas
      // de /catalogo/productos, de ahí el DEFAULT 'ERP'.
      await db.execAsync(`
        ALTER TABLE productos ADD COLUMN subcategoria TEXT;
        ALTER TABLE productos ADD COLUMN orden INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE productos ADD COLUMN origen TEXT NOT NULL DEFAULT 'ERP';
        ALTER TABLE categorias_producto ADD COLUMN origen TEXT NOT NULL DEFAULT 'ERP';
      `);
    },
  },
  {
    version: 3,
    nombre: "separacion_por_sucursal",
    up: async (db) => {
      // Hasta aquí TODA la base local asumía una sola sucursal: solo `sync_outbox` llevaba
      // `sucursal_id`. Sin esta columna, en cuanto el dispositivo pueda cambiar de sucursal las
      // ventas, turnos y cortes de caja de ambas quedarían mezclados en las mismas tablas y sin
      // forma de separarlos después — por eso la migración va ANTES que el selector.
      await db.execAsync(`
        ALTER TABLE ventas ADD COLUMN sucursal_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE turnos ADD COLUMN sucursal_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE movimientos_caja ADD COLUMN sucursal_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE usuarios_locales ADD COLUMN sucursal_id TEXT NOT NULL DEFAULT '';
      `);

      // Las filas que ya existen son todas de la sucursal en la que el dispositivo ha estado
      // operando. Se resuelve igual que dispositivoLocal.obtenerOCrearSucursalIdLocal(): el id
      // real del ERP si ya se enlazó, y si no el placeholder local.
      //
      // Si no hay ninguno de los dos (posible: crearUsuarioLocal() nunca pidió una sucursal, así
      // que un dispositivo puede tener usuarios locales sin haber registrado jamás una venta) se
      // crea el placeholder aquí mismo. Dejar filas con '' las volvería invisibles para las
      // consultas acotadas, que es justo el fallo que esta migración viene a evitar.
      const fila = await db.getFirstAsync<{ valor: string }>(
        `SELECT valor FROM config_local WHERE clave IN ('sucursal_id_erp', 'sucursal_id_local')
         ORDER BY CASE clave WHEN 'sucursal_id_erp' THEN 0 ELSE 1 END LIMIT 1`,
      );
      let sucursalId = fila?.valor;
      if (!sucursalId) {
        sucursalId = uuid7();
        await db.runAsync("INSERT INTO config_local (clave, valor) VALUES ('sucursal_id_local', ?)", sucursalId);
      }

      for (const tabla of ["ventas", "turnos", "movimientos_caja", "usuarios_locales"]) {
        await db.runAsync(`UPDATE ${tabla} SET sucursal_id = ? WHERE sucursal_id = ''`, sucursalId);
      }

      // El folio pasa a ser consecutivo POR SUCURSAL: compartir numeración entre sucursales no
      // solo confunde, es un problema fiscal. El índice único lo garantiza a nivel de esquema,
      // no solo en el SELECT MAX(...)+1 de ventasRepo.
      await db.execAsync(`
        CREATE UNIQUE INDEX idx_ventas_folio_sucursal ON ventas(sucursal_id, folio_local);
        CREATE INDEX idx_turnos_sucursal_estado ON turnos(sucursal_id, estado);
        CREATE INDEX idx_movimientos_caja_sucursal ON movimientos_caja(sucursal_id);
        CREATE INDEX idx_usuarios_locales_sucursal ON usuarios_locales(sucursal_id);
      `);
    },
  },
  {
    version: 4,
    nombre: "modificadores_de_producto",
    up: async (db) => {
      // Productos compuestos: un café pregunta tamaño, tipo de leche, jarabes… Mismo modelo que
      // el backend (Modificador / OpcionModificador / ProductoModificador) y que ya consume el
      // POS Windows, replicado en local para que el modal funcione sin conexión.
      //
      // `origen` igual que en el catálogo (migración 2): distingue lo sembrado en el dispositivo
      // de lo que baja del ERP, que describe lo mismo con otros ids.
      await db.execAsync(`
        CREATE TABLE modificadores (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          tipo TEXT NOT NULL CHECK(tipo IN ('SELECCION_UNICA','MULTIPLE')),
          obligatorio INTEGER NOT NULL DEFAULT 0,
          activo INTEGER NOT NULL DEFAULT 1,
          origen TEXT NOT NULL DEFAULT 'ERP',
          synced_at TEXT
        );

        CREATE TABLE opciones_modificador (
          id TEXT PRIMARY KEY,
          modificador_id TEXT NOT NULL REFERENCES modificadores(id),
          nombre TEXT NOT NULL,
          precio_extra REAL NOT NULL DEFAULT 0,
          orden INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_opciones_modificador ON opciones_modificador(modificador_id);

        -- Tabla puente: qué modificadores pregunta cada producto, y en qué orden.
        CREATE TABLE producto_modificadores (
          producto_id TEXT NOT NULL REFERENCES productos(id),
          modificador_id TEXT NOT NULL REFERENCES modificadores(id),
          orden INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (producto_id, modificador_id)
        );

        -- Si es 0, tocar la tarjeta agrega el producto directo al carrito, sin abrir el modal.
        ALTER TABLE productos ADD COLUMN requiere_personalizacion INTEGER NOT NULL DEFAULT 0;

        -- Lo elegido en cada línea de venta. Se guarda el NOMBRE y el precio además del id de la
        -- opción: el ticket y el historial deben seguir leyéndose años después aunque el
        -- modificador se renombre o se borre del catálogo — mismo criterio que
        -- venta_items.nombre_snapshot.
        CREATE TABLE venta_item_modificadores (
          id TEXT PRIMARY KEY,
          venta_item_id TEXT NOT NULL REFERENCES venta_items(id),
          opcion_modificador_id TEXT NOT NULL,
          nombre_snapshot TEXT NOT NULL,
          precio_extra_snapshot REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_venta_item_modificadores_item ON venta_item_modificadores(venta_item_id);
      `);
    },
  },
  {
    version: 5,
    nombre: "desglose_efectivo_en_turnos",
    up: async (db) => {
      // Conteo físico de billetes y monedas del corte, en JSON y con el mismo formato que manda
      // el POS Windows (ver CajaService.cerrarTurno, que lo guarda tal cual para auditarlo).
      // Se guarda también en local para poder revisar o reimprimir un corte sin conexión.
      await db.execAsync(`ALTER TABLE turnos ADD COLUMN desglose_efectivo TEXT;`);
    },
  },
  {
    version: 6,
    nombre: "inventario_local",
    up: async (db) => {
      // Inventario offline-first, igual que las ventas: se consulta y se ajusta sin red, y los
      // movimientos salen por sync_outbox (SyncEntidad.MOVIMIENTO_INVENTARIO, que el backend ya
      // enruta). Las existencias bajan del ERP por /inventario/existencias.
      //
      // `existencia` se guarda como REAL porque hay insumos en gramos y mililitros: un INTEGER
      // convertiría 0.4 kg en 0 sin avisar.
      await db.execAsync(`
        CREATE TABLE insumos (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          unidad_medida TEXT NOT NULL DEFAULT 'pz',
          costo_unitario REAL NOT NULL DEFAULT 0,
          proveedor_id TEXT,
          -- Desnormalizado a propósito: la lista de compras se agrupa por proveedor y tiene que
          -- poder imprimirse sin conexión, cuando no hay forma de resolver el nombre.
          proveedor_nombre TEXT,
          activo INTEGER NOT NULL DEFAULT 1,
          synced_at TEXT
        );
        CREATE INDEX idx_insumos_nombre ON insumos(nombre);

        -- Existencias POR SUCURSAL, misma llave compuesta que InventarioSucursal en el backend:
        -- una terminal que cambia de sucursal no debe mezclar el almacén de las dos.
        CREATE TABLE inventario_local (
          sucursal_id TEXT NOT NULL,
          insumo_id TEXT NOT NULL REFERENCES insumos(id),
          existencia REAL NOT NULL DEFAULT 0,
          minimo REAL NOT NULL DEFAULT 0,
          maximo REAL,
          updated_at TEXT,
          PRIMARY KEY (sucursal_id, insumo_id)
        );

        -- Historial local de lo que hizo ESTA terminal. El saldo autoritativo lo lleva el ERP;
        -- esto permite revisar y deshacer un conteo sin conexión, y ver qué queda por subir.
        CREATE TABLE movimientos_inventario (
          id TEXT PRIMARY KEY,
          sucursal_id TEXT NOT NULL,
          insumo_id TEXT NOT NULL,
          tipo TEXT NOT NULL CHECK(tipo IN ('ENTRADA','SALIDA','AJUSTE','MERMA','CONTEO')),
          cantidad REAL NOT NULL,
          motivo TEXT,
          usuario_id TEXT,
          created_at TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE
        );
        CREATE INDEX idx_movimientos_inv_sucursal ON movimientos_inventario(sucursal_id, created_at);
      `);
    },
  },
  {
    version: 7,
    nombre: "cancelacion_de_ventas",
    up: async (db) => {
      // Cancelación LÓGICA y auditable: una venta nunca se borra. El estado 'CANCELADA' ya
      // existía en el CHECK de la tabla desde la migración 1, pero no había forma de llegar a él
      // ni de saber quién lo hizo, cuándo ni por qué — que es justo lo que exige poder cancelar
      // un ticket cobrado.
      //
      // Se guardan DOS usuarios: quien pide la cancelación (el cajero) y quien la autoriza (el
      // gerente que puso su PIN). Con uno solo no se puede auditar nada: la pregunta que se hace
      // siempre es "¿quién dio permiso?".
      await db.execAsync(`
        ALTER TABLE ventas ADD COLUMN cancelada_at TEXT;
        ALTER TABLE ventas ADD COLUMN cancelada_motivo TEXT;
        ALTER TABLE ventas ADD COLUMN cancelada_solicitada_por TEXT;
        ALTER TABLE ventas ADD COLUMN cancelada_autorizada_por TEXT;
        ALTER TABLE ventas ADD COLUMN cancelada_autorizada_por_nombre TEXT;
      `);
    },
  },
  {
    version: 8,
    nombre: "terminal_multisucursal",
    up: async (db) => {
      // Terminal vinculada a la EMPRESA (código de varias sucursales): cada persona elige al
      // entrar entre las sucursales que tiene asignadas en el ERP. Todo se guarda local para que
      // el login, el cambio de sucursal y los precios funcionen sin conexión.
      //
      //  - sucursales_terminal: en qué sucursales puede operar esta terminal (vacía = terminal de
      //    una sola sucursal, el esquema de siempre).
      //  - usuarios_erp: personas asignadas a esas sucursales en el ERP, para ofrecerlas en el
      //    login aunque nunca hayan entrado en esta tablet (su primera entrada es en línea).
      //  - usuarios_sucursales: qué sucursales y con qué rol tiene cada persona.
      //  - precios_sucursal: precio y disponibilidad de cada producto EN CADA sucursal. La tabla
      //    `productos` guarda un solo precio (el de la sucursal activa); al cambiar de sucursal se
      //    reescribe desde aquí, sin red.
      await db.execAsync(`
        CREATE TABLE sucursales_terminal (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL
        );

        CREATE TABLE usuarios_erp (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          tiene_pin INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE usuarios_sucursales (
          usuario_id TEXT NOT NULL,
          sucursal_id TEXT NOT NULL,
          rol TEXT NOT NULL,
          PRIMARY KEY (usuario_id, sucursal_id)
        );

        CREATE TABLE precios_sucursal (
          producto_id TEXT NOT NULL,
          sucursal_id TEXT NOT NULL,
          precio REAL NOT NULL,
          disponible INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (producto_id, sucursal_id)
        );
      `);
    },
  },
  {
    version: 9,
    nombre: "permisos_por_usuario",
    up: async (db) => {
      // Funciones que un administrador le da o quita a cada persona en esta tablet (ver
      // auth/permisosTerminal.ts). NULL = nunca personalizado: usa los del rol, así que los
      // usuarios que ya existían siguen pudiendo hacer exactamente lo mismo que antes.
      await db.execAsync(`ALTER TABLE usuarios_locales ADD COLUMN permisos_json TEXT;`);
    },
  },
  {
    version: 10,
    nombre: "tarjeta_manual_habilitada",
    up: async (db) => {
      // Las tablets sembradas antes de que Tarjeta viniera encendida (ver
      // sembrarMetodosPagoPorDefecto) la tenían apagada, y la siembra no vuelve a correr si ya
      // hay métodos. El negocio cobra con tarjeta en la terminal del banco y la registra a mano,
      // así que se enciende una vez; sigue pudiéndose apagar en Admin → Pagos.
      await db.execAsync(`UPDATE metodos_pago_config SET habilitado = 1 WHERE tipo = 'TARJETA';`);
    },
  },
  {
    version: 11,
    nombre: "turnos_trabajo",
    up: async (db) => {
      // Turnos de TRABAJO (ej. "Mañana 07:00–15:00") que el administrador crea en esta tablet y
      // asigna a cada persona. Son informativos: no tienen que ver con el turno de CAJA (tabla
      // `turnos`, apertura y corte) ni bloquean el acceso fuera de horario. Por sucursal, igual
      // que los usuarios. Borrar uno lo desactiva, para no dejar asignaciones colgando.
      await db.execAsync(`
        CREATE TABLE turnos_trabajo (
          id TEXT PRIMARY KEY,
          sucursal_id TEXT NOT NULL,
          nombre TEXT NOT NULL,
          hora_inicio TEXT NOT NULL,
          hora_fin TEXT NOT NULL,
          activo INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_turnos_trabajo_sucursal ON turnos_trabajo(sucursal_id);

        ALTER TABLE usuarios_locales ADD COLUMN turno_trabajo_id TEXT;
      `);
    },
  },
  {
    version: 12,
    nombre: "cobro_en_dolares",
    up: async (db) => {
      // Cobro con billetes en dólares, cambio en pesos (ver cobroEnDolares en shared).
      //  - metodos_pago_config: su CHECK no admite EFECTIVO_USD y SQLite no deja cambiar un CHECK,
      //    así que se reconstruye la tabla. El método se agrega solo si la tabla ya estaba
      //    sembrada: en una instalación nueva la siembra (sembrarMetodosPagoPorDefecto) lo trae.
      //  - turnos.tipo_cambio_usd: pesos por dólar, se pregunta al abrir caja.
      //  - pagos.monto_usd / tipo_cambio: los dólares recibidos y a cuánto se tomaron.
      //  - pagos.monto_recibido: lo que entregó el cliente, solo para el ticket ("paga con" y
      //    cambio). `monto` pasa a ser siempre lo que el pago CUBRIÓ de la venta: antes, en
      //    efectivo, guardaba lo entregado y el corte esperaba de más el cambio ya devuelto.
      await db.execAsync(`
        CREATE TABLE metodos_pago_config_nueva (
          id TEXT PRIMARY KEY,
          tipo TEXT NOT NULL CHECK(tipo IN ('EFECTIVO','EFECTIVO_USD','TARJETA','TRANSFERENCIA','QR','OTRO')),
          habilitado INTEGER NOT NULL DEFAULT 1,
          orden INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO metodos_pago_config_nueva (id, tipo, habilitado, orden)
          SELECT id, tipo, habilitado, CASE WHEN orden >= 2 THEN orden + 1 ELSE orden END FROM metodos_pago_config;
        INSERT INTO metodos_pago_config_nueva (id, tipo, habilitado, orden)
          SELECT 'metodo-efectivo-usd', 'EFECTIVO_USD', 1, 2 WHERE EXISTS (SELECT 1 FROM metodos_pago_config);
        DROP TABLE metodos_pago_config;
        ALTER TABLE metodos_pago_config_nueva RENAME TO metodos_pago_config;

        ALTER TABLE turnos ADD COLUMN tipo_cambio_usd REAL;
        ALTER TABLE pagos ADD COLUMN monto_usd REAL;
        ALTER TABLE pagos ADD COLUMN tipo_cambio REAL;
        ALTER TABLE pagos ADD COLUMN monto_recibido REAL;

        -- Pagos en efectivo ya guardados con lo entregado: se pasa eso a monto_recibido y monto
        -- queda en lo que cubrió. Solo ventas de un único pago (las de esta app), que es donde
        -- lo cubierto es exactamente el total. Así el corte del turno abierto deja de esperar
        -- de más; lo que ya subió al ERP no se toca desde aquí.
        UPDATE pagos SET
          monto_recibido = monto,
          monto = (SELECT v.total FROM ventas v WHERE v.id = pagos.venta_id)
        WHERE metodo = 'EFECTIVO'
          AND monto > (SELECT v.total FROM ventas v WHERE v.id = pagos.venta_id)
          AND (SELECT COUNT(*) FROM pagos p2 WHERE p2.venta_id = pagos.venta_id) = 1;
      `);
    },
  },
  {
    version: 13,
    nombre: "nombre_cliente_en_ventas",
    up: async (db) => {
      // Nombre que se le pone al pedido para identificar a quién se le entrega: sale en el
      // ticket y en la comanda de preparación (también al reimprimir). Opcional.
      await db.execAsync(`ALTER TABLE ventas ADD COLUMN nombre_cliente TEXT;`);
    },
  },
  {
    version: 14,
    nombre: "origen_plataforma_en_ventas",
    up: async (db) => {
      // De qué plataforma de delivery viene la venta ('DIDI' | 'UBER' | 'RAPPI'); NULL = mostrador.
      // Es lo que separa las ventas de DiDi en el corte y en los reportes.
      await db.execAsync(`ALTER TABLE ventas ADD COLUMN plataforma TEXT;`);
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
