# Vinculación del POS de Windows con el ERP en la nube — diseño

> Estado: **diseño aprobado en lo general, pendiente de resolver §8 antes de implementar**.
> Complementa `architecture.md`, `sync-flows.md` y `multisucursal-pos-terminal.md`.

## 1. Objetivo

El POS de Windows (`apps/pos-desktop`) corre en modo **standalone**: embebe su propio backend
NestJS + PostgreSQL y es el hub LAN de meseros y cocina. Hoy **nada** de lo que vende llega a la
nube, así que el Dashboard (`apps/crm-web`) no lo ve.

Decisión tomada: el POS **sigue standalone** (offline-first, hub LAN) y, tras enlazarse con un
**código de vinculación** —el mismo esquema que ya usa `pos-terminal`
(`apps/backend/src/auth/vinculacion.service.ts`)—, **sube** a la nube sus ventas, cortes de caja e
inventario. Se descartó pasar el POS a modo Nube (pierde la operación sin internet y la LAN de
meseros) y solo registrar la PC sin datos.

## 2. El problema de fondo: los ids locales no existen en la nube

El backend embebido arranca con `AUTO_BOOTSTRAP=true` y, con la base vacía, ejecuta
`seedDemoData` (`seed-demo-data.ts`): crea empresa, **dos** sucursales, cajas, mesas, usuarios y
el catálogo. Todos los modelos usan `@default(uuid())`, así que **los nombres coinciden con la
nube pero ningún id**: empresa, sucursal, producto, opción de modificador, caja, mesa, usuario e
insumo.

Los ids transaccionales (pedido y sus items con `uuid7`, pagos, turnos, movimientos) sí son
globalmente únicos y pueden viajar tal cual.

`POST /sync/push` tal como está hoy **no sirve** para las ventas del hub:

| Qué hace hoy | Consecuencia para el hub |
|---|---|
| `resolverItem` exige que el `productoId` exista en la nube (`pedidos.service.ts`) | Todas las ventas fallan con 400 |
| Re-precia con el `precioBase` de la nube | Montos distintos a lo cobrado; `cobrar` puede rechazar el pago |
| Genera folio nuevo y `createdAt = now()` | El histórico cae entero en "hoy" en los reportes |
| `cobrar` descuenta inventario por receta | Doble descuento cuando además se suban los movimientos locales |
| `abrirTurno` ignora el id del cliente | Un cierre posterior por `turnoId` da 404 |

## 3. Estrategia de ids: tabla de mapeo local → nube

- **Catálogo y referencias** se mapean en una tabla `mapeo_ids_nube (entidad, idLocal, idNube)`,
  resuelta al vincular por clave natural dentro de la empresa/sucursal de la nube:
  producto por nombre normalizado, opción por modificador + opción, mesa y caja por nombre,
  usuario por email o username.
- **Transaccionales** conservan su propio uuid.

Descartado:

- **Re-keyear la base local a los ids de la nube**: reescritura irreversible del histórico real,
  invalida tokens y cachés de meseros y cocina, y la segunda sucursal local no tiene equivalente.
  Puede plantearse después como migración única opcional para retirar el mapeo.
- **Subir el catálogo local**: duplica el catálogo que la nube ya tiene y rompe "el catálogo se
  edita centralmente".

El mapeo converge solo: cuando el catálogo baje de la nube (fase 4), los productos nuevos se
insertan localmente **con el id de la nube** y ya no necesitan mapeo.

## 4. Canal de subida

- **Dónde:** un módulo nuevo `enlace-nube/` dentro del backend embebido, registrado solo con
  `AUTO_BOOTSTRAP=true`. Ya tiene Prisma sobre todos los datos locales y corre mientras el POS
  está abierto.
- **Cómo:** por barrido, sin enganches en los servicios de dominio. Una tabla local
  `envios_nube` (entidad, entidadId, versión = `updatedAt`, estado, intentos, próximo intento,
  error, idempotencyKey). El worker toma los pedidos en estado final sin envío o con versión más
  vieja, los serializa con ids mapeados y los empuja por lotes con backoff.
- `idempotencyKey = hash(dispositivo + entidad + id + versión)`: una cancelación local posterior
  viaja como evento nuevo.
- **Sin dependencias nuevas:** el backoff de `apps/pos-terminal/src/sync/backoff.ts` (puro) pasa a
  `packages/shared`; `fetch` nativo de Node 20.
- **No** se reutiliza `Pedido.syncStatus`: en la nube significa "sincronizado desde el dispositivo".
- **Contrato:** `/sync/push` con dos `SyncEntidad` nuevas, `VENTA_CERRADA` y `CORTE_CAJA`, que llevan
  el snapshot completo. En la nube las atiende un `ImportacionHubService` que, en una transacción,
  hace upsert por id **respetando los totales locales**, folio `<prefijo>-<folioLocal>` (evita
  chocar con el único `(sucursalId, folio)`), `createdAt` original, sin descontar inventario por
  receta, sin comanda a cocina, y emite solo a la sala de empresa para que el Dashboard se
  actualice en vivo. `SyncQueueItem.entidad` es `String`, así que no hace falta cambiar un enum.

## 5. Sesión con la nube

- El propio backend embebido canjea el código: `POST /enlace-nube/vincular {urlErp, codigo,
  sucursalIdLocal, sincronizarDesde}` → llama a `/auth/vincular-dispositivo` de la nube.
- El refresh token se guarda en la fila `enlace_nube`, cifrado con `CifradoService` y una llave
  nueva `NUBE_CIFRADO_KEY` que `backend-manager.ts` agrega a `secrets.json` igual que las llaves de
  pagos. El access token vive solo en memoria.
- Al renovar, el refresh token rotado se guarda **de inmediato**: la nube revoca el anterior.
- Electron pasa su device id al backend como `HANGAR_DEVICE_ID`, para que coincida con
  `Dispositivo.identificador`.

## 6. Interfaz

- **POS (`AdminConexion.tsx`):** sección "Vincular con el ERP", solo en modo standalone: URL del
  ERP, código, sucursal local que es esta PC, fecha "sincronizar desde". Tras vincular: panel de
  estado (vinculado a X, pendientes, errores, último envío, "Sincronizar ahora", "Desvincular").
  Clave de config **distinta** de `backend_cloud_url`, que convierte el POS a modo Nube.
- **Backend:** `VincularDispositivoDto` acepta `tipo` opcional (`POS_TERMINAL` | `POS_WINDOWS`,
  por defecto `POS_TERMINAL`) en vez del valor fijo de `vinculacion.service.ts`. `POS_WINDOWS` ya
  existe en el enum.
- **crm-web (`sucursales/page.tsx`):** el texto pasa de "APK Punto de Venta" a "Punto de Venta
  (APK o PC)" y la lista de dispositivos distingue `POS_WINDOWS`.

## 7. Fases

| Fase | Qué | Resultado |
|---|---|---|
| 0 | **Seguridad de `/sync/push`** (ver abajo) y `abrirTurno` que respete el id del cliente, con tests | Cierra huecos que ya existen hoy, también para pos-terminal |
| 1 | Vinculación + ventas cerradas visibles en el Dashboard | Lo mínimo que aporta valor |
| 2 | Cortes de caja (turnos con su id, movimientos de caja); los pedidos se enlazan a su turno | Cortes en el Dashboard |
| 3 | Movimientos de inventario con `insumoId` mapeado | Inventario en el Dashboard |
| 4 | Catálogo nube → hub (last-write-wins por campo); se desactiva `sincronizarCatalogo` mientras haya enlace | La nube pasa a ser la fuente del catálogo |

**Fase 0 — huecos confirmados en el código actual:**

- `SyncController.push` no pasa `req.user`; `sync.service.ts` toma `empresaId` del payload y
  `sucursalId` del sobre. Cualquier usuario autenticado puede escribir en otra empresa o sucursal.
  `SucursalAccessGuard` solo mira `body.sucursalId`, y en el push va anidado en `items[]`.
- `pedidos.crear` devuelve el pedido existente si el id coincide, **aunque sea de otra sucursal**.

Arreglo: empresa, sucursal y dispositivo salen del token; se rechaza cualquier item que no
coincida; el importador verifica que productos y opciones sean de la empresa del token.

**Migración (fase 1, un solo esquema para nube y local):** tablas `enlace_nube` (fila única),
`mapeo_ids_nube` (PK `(entidad, idLocal)`) y `envios_nube`. En la nube quedan vacías. SQL plano
sin bloques `$$`: el runner embebido parte las sentencias por `;` + salto de línea.

## 8. Preguntas abiertas

1. **Productos sin equivalente en la nube:** ¿se detiene la vinculación y el admin los mapea en una
   pantalla, o se crean inactivos en la nube bajo una categoría "Importado del POS"?
2. **Insumos sin equivalente (fase 3):** misma elección.
3. **Histórico:** ¿se sube todo lo vendido en producción o solo desde una fecha?
4. **Sucursal local:** el seed local crea dos; solo se sube la que se elija al vincular.
5. **¿Un APK `pos-terminal` venderá en la misma sucursal de la nube?** Por eso el prefijo de folio
   y cajas separadas.
6. **Totales del hub:** la nube los acepta sin recalcular (auditables por `dispositivoId`).
7. **Revinculación:** si la PC pasa sin internet más que la vigencia del refresh token, o cae justo
   al rotarlo, hará falta un código nuevo. El estado de envíos sobrevive a la revinculación.
8. **Reloj:** `createdAt` viene del reloj de la PC; un desfase se verá en los reportes.

## 9. Requisitos de trazabilidad (2026-09-21) y plan general

Requisitos del negocio que amplían este diseño, con las decisiones ya tomadas:

1. **Producto no registrado:** nunca se crea solo. La venta **se detiene** y se genera una
   `SolicitudProducto` para el admin con el texto capturado, usuario, sucursal, dispositivo y
   fecha/hora. Resuelve la pregunta 1 de §8 (sin alta automática ni "artículo pendiente").
2. **Todas las ventas sincronizadas**, de cualquier dispositivo. Si al abrir la caja el turno
   activo es de un día anterior, se **avisa** (sucursal, fecha, responsable, turno) sin bloquear.
3. **APK en cualquier sucursal:** el código vincula el dispositivo **a la empresa**; al entrar con
   PIN el usuario elige entre sus sucursales asignadas y esa elección fija la sucursal de la
   sesión. Cada venta guarda la sucursal de ese momento (ya ocurre: `Pedido.sucursalId` no se
   modifica nunca).
4. **Trazabilidad:** cada venta conserva usuario, sucursal, canal (`CanalOrigen`), dispositivo,
   fecha y turno. Los usuarios dados de alta en el APK sin conexión **se suben al ERP** al
   sincronizar, conservando su id, para que la venta nunca quede atribuida al usuario-terminal.
   El Dashboard filtra por sucursal, usuario, plataforma, dispositivo, fecha, turno y estado de
   cierre. Resuelve la pregunta 5 de §8: sí, en una misma sucursal conviven POS Windows y APK.

| Fase | Qué |
|---|---|
| A | ✅ **Hecho** — Seguridad de `/sync/push` (empresa/sucursal del token) + usuario real en cada venta (alta de usuarios del APK en el ERP) + `turnoId` en las ventas del POS Windows |
| B | ✅ **Hecho** — Filtros del Dashboard y pantalla de turnos y cortes |
| C | Aviso de turno abierto de un día anterior (POS Windows, APK y Dashboard) |
| D | Solicitudes de alta de productos no registrados |
| E | APK vinculado a la empresa, sucursal elegida por sesión |
| F | Ventas del POS Windows a la nube (fases 1–4 de §7) |

**Fase A, cómo quedó:**

- `sync/alcance-sync.ts`: cada item de `/sync/push` se valida contra la sesión antes de tocar
  nada. La empresa sale siempre del token; la sucursal tiene que ser una a la que el usuario tiene
  acceso (`UsuarioSucursal`, o cualquiera de su empresa si es `ADMIN_CORPORATIVO`) — no
  necesariamente la activa, porque la cola offline puede drenar ventas de una sucursal anterior;
  pedidos, mesas, turnos y cajas referenciados tienen que ser de esa sucursal, e insumos,
  productos y usuarios de esa empresa. `pedidos.crear` ya no devuelve un pedido de otra sucursal.
- `SyncEntidad.USUARIO`: el APK encola el alta de cada usuario local con el **mismo id**; el ERP
  lo crea sin credenciales (`registrarUsuarioDesdeTerminal`). Nunca crea administradores: un
  "Admin" local llega como `SUPERVISOR`. Los usuarios viejos que nunca llegaron se encolan solos
  al arrancar el motor de sync. **El PIN no viaja**: para que ese usuario entre en otro
  dispositivo, un admin le asigna PIN desde el ERP.
- `PedidosService.cobrar` enlaza al turno del cajero abierto **a la hora del cobro** (la local de
  la terminal si llega por la cola) cualquier pedido que no traiga turno: POS Windows y pedidos de
  meseros ya quedan con `turnoId`.
- Límite conocido: ventas de usuarios viejos que ya estaban en la cola **antes** de su alta salen
  primero y quedan sin atribución; las nuevas no.

**Fase B, cómo quedó:**

- `GET /pedidos/ventas` acepta `usuarioId` (mesero o cajero), `canalOrigen`, `dispositivoId`,
  `turnoId` y `estadoTurno` (`ABIERTO` | `CERRADO` | `SIN_TURNO`), y devuelve por venta su
  dispositivo y su turno, más un `desglose` de lo cobrado en el rango por plataforma, usuario y
  dispositivo (`armarDesglose`). `GET /pedidos/ventas/opciones` da los usuarios y dispositivos que
  aparecen en ventas, para los selectores.
- `GET /caja/turnos` lista turnos con responsable, caja, lo vendido y el resultado del corte, y
  aparte `pendientes`: los abiertos desde un día anterior (en la zona de la sucursal), sin
  importar los filtros — base del aviso de la fase C.
- Sin `sucursalId`, ventas y turnos solo dan el consolidado a `ADMIN_CORPORATIVO`; cualquier otro
  rol queda en su sucursal activa (`sucursalDeLaConsulta`). Antes el guard dejaba pasar la
  consulta sin sucursal y cualquier rol veía todas.
- Reportes: el de productos acepta `sucursalId`, y el de métodos de pago ya no suma pedidos
  cancelados.
- Migración `20260921120000_indices_trazabilidad`: índices para los filtros nuevos.
- crm-web: filtros de origen y columnas de dispositivo y turno en Ventas (tocar una fila del
  desglose filtra por ella), y pantalla nueva **Turnos y cortes** con la alerta de pendientes.
