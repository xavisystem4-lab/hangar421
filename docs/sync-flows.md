# HANGAR 421 — Flujos de sincronización

## 1. Principios

1. **Escritura local primero**: toda acción de negocio se confirma contra SQLite/AsyncStorage
   local antes de intentar red. La UI nunca bloquea esperando al servidor.
2. **IDs generados en el cliente** (UUID v7): permite crear entidades offline sin colisión y
   sin esperar un ID autoincremental del servidor. El servidor hace *upsert por id*.
3. **Idempotencia**: cada operación en cola lleva `idempotencyKey = sha256(deviceId + entityId +
   operation + localSeq)`. El backend guarda las claves procesadas (`SyncQueueItem.idempotencyKey`
   único) — reenviar el mismo lote (por reintento de red) no duplica nada.
4. **Cola por dispositivo, no por usuario**: el POS Windows, cada tablet y cada celular tienen
   su propia cola de salida (outbox) y su propio cursor de entrada (última marca de tiempo
   sincronizada), porque son procesos independientes que pueden estar offline en momentos
   distintos.

## 2. Flujo local dentro de la sucursal (LAN)

```
Mesero (tablet)                POS Windows (hub local)              Cocina (pantalla)
      │  1. Toma pedido               │                                    │
      │  guarda en SQLite local       │                                    │
      │  estado local = PENDING       │                                    │
      │                                │                                    │
      │──2. Emite por WS LAN─────────▶│                                    │
      │   (si hay red LAN/Wi-Fi)      │  3. Recibe, valida, persiste       │
      │                                │     en su SQLite, marca CONFIRMED  │
      │                                │──4. Emite comanda a cocina────────▶│
      │                                │                                     │ 5. Muestra comanda,
      │                                │                                     │    alerta sonora
      │◀─────────6. ACK pedido creado─│                                     │
      │   (estado local = CONFIRMED)  │                                     │
      │                                │◀────7. Cambia estado (LISTO)───────│
      │◀─────8. Notif. "pedido listo"─│                                     │
```

- Si la tablet **no** alcanza al POS por Wi-Fi (LAN caída), el pedido queda `PENDING` local y
  se reintenta cada `N` segundos (backoff) hasta reconectar; el mesero puede seguir tomando
  pedidos, todos encolados en orden.
- El POS Windows es el único que además reenvía al backend cloud; los demás dispositivos de la
  sucursal sincronizan con la nube directamente **también** (no dependen solo del POS como
  puente) — el POS-como-hub-LAN es una optimización de latencia para cocina, no un requisito.

## 3. Flujo sucursal → nube

```
Dispositivo (POS / tablet / pantalla)          Backend API (cloud)              PostgreSQL
        │                                              │                              │
        │ 1. Detecta conectividad (heartbeat ok)        │                              │
        │ 2. POST /sync/push  { items: [...] }          │                              │
        │    lote de hasta SYNC_BATCH_MAX_ITEMS          │                              │
        │───────────────────────────────────────────────▶ 3. Por cada item:            │
        │                                              │    - valida idempotencyKey    │
        │                                              │      (ya procesado? -> skip)  │
        │                                              │    - upsert por id            │
        │                                              │    - resuelve conflicto       │
        │                                              │      (ver §4)                 │
        │                                              │────────────────────────────▶ │
        │                                              │◀──────────────────────────── │
        │◀─── 4. { resultados: [{id, estado, error?}] }│                              │
        │ 5. Marca items SYNCED (o ERROR con motivo)     │                              │
        │    reintenta ERROR con backoff exponencial     │                              │
        │                                              │                              │
        │ 6. GET /sync/pull?since=<cursor>&sucursalId=  │                              │
        │───────────────────────────────────────────────▶ 7. Devuelve cambios          │
        │                                              │    posteriores a `since`      │
        │◀─── 8. { cambios: [...], cursor: <nuevo> }    │                              │
        │ 9. Aplica cambios en SQLite local,             │                              │
        │    guarda nuevo cursor                         │                              │
        │                                              │──10. Emite WS a sala           │
        │                                              │    sucursal:{id} y             │
        │                                              │    empresa:{id} (CRM en vivo)  │
```

- **Push** (`POST /sync/push`): de dispositivo → nube. Body: `SyncEnvelope[]` (ver
  `packages/shared/src/types/sync.ts`). Responde por-item para que el cliente marque
  individualmente qué se sincronizó.
- **Pull** (`GET /sync/pull`): de nube → dispositivo, incremental por cursor
  (`updatedAtServer` + `id` como desempate). Usado al reconectar y también en polling ligero
  de respaldo (cada 30-60s) por si el WebSocket se cae silenciosamente.
- **Reintentos**: backoff exponencial (`SYNC_RETRY_BACKOFF_MS * 2^intento`, tope
  `SYNC_RETRY_MAX_ATTEMPTS`). Tras agotar intentos, el item queda `ERROR` visible en la barra de
  estado de sincronización para revisión manual (no se pierde, no bloquea el resto de la cola).

## 4. Resolución de conflictos

| Tipo de dato | Estrategia | Justificación |
|---|---|---|
| Catálogo, precios, modificadores | **Last-write-wins** por `updatedAtServer` | Se editan centralmente (CRM); el valor más reciente del servidor gana y se empuja a todas las sucursales. |
| Pedido / PedidoItem / Pago / MovimientoInventario | **Append-only por evento de estado** | Nunca se sobrescribe un pedido; cada cambio de estado es un evento nuevo con timestamp. Dos dispositivos no editan el mismo pedido a la vez en la práctica (un pedido pertenece a un mesero/mesa), pero si ocurre, se conservan ambos eventos y el estado final es el de mayor timestamp. |
| Inventario (existencia) | **Suma de movimientos, nunca edición directa del saldo** | El saldo (`InventarioSucursal.existencia`) se recalcula a partir de `MovimientoInventario`, evitando condiciones de carrera entre sucursal y ajustes centrales. |
| Mesa (estado) | **Last-write-wins con validación de transición** | Solo se acepta el cambio si la transición de estado es válida (p. ej. no pasar de `LIBRE` a `LISTO` sin pedido); si no, se descarta y se resincroniza el estado real desde el servidor. |
| Caja / Turno | **Un turno activo por caja** (constraint único) | El backend rechaza una segunda apertura concurrente; el cliente que pierde recibe el turno real vía `pull`. |

Todo conflicto detectado se registra en `AuditLog` con `accion = "SYNC_CONFLICT"` para
trazabilidad, incluso cuando se resuelve automáticamente.

## 5. Estados de sincronización visibles en UI

`PENDING` (gris) → `SYNCING` (azul, parpadeante) → `SYNCED` (verde) / `ERROR` (rojo, con detalle
al tocar). Visible en la barra superior del POS y en la app de meseros junto al reloj.
