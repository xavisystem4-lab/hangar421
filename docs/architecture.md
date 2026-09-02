# HANGAR 421 — Arquitectura técnica

## 1. Visión general

HANGAR 421 es una plataforma POS multisucursal **offline-first**: cada sucursal opera de forma
autónoma con su propia copia de datos (SQLite local en cada terminal/tablet), y sincroniza de
forma incremental y bidireccional contra un backend central en la nube (PostgreSQL) cuando hay
conectividad. Ningún flujo crítico (tomar pedido, enviar a cocina, cobrar) depende de internet.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              NUBE (CLOUD)                                │
│  ┌───────────────┐   ┌────────────────────┐   ┌───────────────────────┐ │
│  │  CRM / Admin  │   │   Backend API       │   │   PostgreSQL           │ │
│  │  Next.js      │──▶│   NestJS + Socket.IO│──▶│   (empresa completa)   │ │
│  └───────────────┘   │   REST + WebSocket  │   └───────────────────────┘ │
│                       └─────────┬───────────┘                            │
└─────────────────────────────────┼────────────────────────────────────────┘
                     Internet (HTTPS + WSS) — intermitente
      ┌──────────────────────────┼──────────────────────────┐
      ▼                          ▼                          ▼
┌───────────────┐        ┌───────────────┐          ┌───────────────┐
│  SUCURSAL A    │        │  SUCURSAL B    │          │  SUCURSAL N    │
│ ┌───────────┐  │        │ ┌───────────┐  │          │      ...       │
│ │ POS        │  │  LAN  │ │ POS        │  │
│ │ Windows    │◀─┼───────┼▶│ Windows    │  │
│ │ (Electron) │  │ Wi-Fi │ │            │  │
│ │ SQLite     │  │       │ └───────────┘  │
│ └───────────┘  │        │                │
│ ┌───────────┐  │        │ ┌───────────┐  │
│ │ Tablets    │  │        │ │ Pantalla   │  │
│ │ Meseros    │  │        │ │ Cocina     │  │
│ │ (RN/Expo)  │  │        │ │ (React Web)│  │
│ └───────────┘  │        │ └───────────┘  │
└───────────────┘        └───────────────┘
```

Cada sucursal tiene un **hub local** implícito: el POS Windows actúa como nodo con SQLite que
las tablets y la pantalla de cocina consultan vía WebSocket LAN cuando hay red local, y cada
dispositivo mantiene además su propia cola de sincronización hacia la nube. Esto evita que la
pérdida de internet en la sucursal detenga la operación entre mesero → cocina → caja.

## 2. Componentes

| Componente | Stack | Descripción |
|---|---|---|
| **POS Windows** | Electron + React + TS + Vite, SQLite (`better-sqlite3`) | Terminal principal de venta y cobro, táctil, instalable vía `.exe` (NSIS, electron-builder) |
| **App meseros** | React Native (Expo) + TS, SQLite/AsyncStorage | Toma de pedidos en piso, celular o tablet, `.apk` firmado |
| **Pantalla de cocina** | React + Vite + Socket.IO client | Monitor/tablet en cocina, tiempo real, sin necesidad de login por comanda |
| **Backend API** | NestJS + TS, Prisma ORM, PostgreSQL, Socket.IO gateway | Fuente de verdad en la nube, REST + WebSocket, cola de sync, auth JWT |
| **CRM / Admin web** | Next.js (App Router) + TS | Panel corporativo: reportes, catálogo, inventario, usuarios, sucursales |
| **Paquete compartido** | `packages/shared` (TS) | Tipos, enums, DTOs y contratos de sync usados por todos los clientes |

## 3. Monorepo

Un solo repositorio TypeScript con **npm workspaces** (sin dependencia de herramientas externas
como pnpm/turbo para simplificar el arranque; migrar a Turborepo es directo si el equipo crece).

```
hangar421/
├── apps/
│   ├── backend/          # NestJS API central (cloud)
│   ├── pos-desktop/      # Electron + React (Windows)
│   ├── waiter-mobile/    # Expo/React Native (Android meseros)
│   ├── kitchen-display/  # React web (pantalla de cocina)
│   └── crm-web/          # Next.js (panel corporativo / CRM)
├── packages/
│   └── shared/           # Tipos, enums, DTOs, constantes de sync
├── infra/
│   └── docker/           # docker-compose para Postgres + backend
├── docs/                 # Arquitectura, modelo de datos, flujos, wireframes
└── package.json          # workspaces raíz
```

## 4. Decisiones técnicas clave

- **Offline-first por diseño, no como parche**: cada escritura de negocio (pedido, pago, corte
  de caja, movimiento de inventario) se guarda primero en SQLite local con `syncStatus: PENDING`
  y un `id` generado por el cliente (UUID v7 — ordenable por tiempo) + `idempotencyKey`. La UI
  nunca espera a la nube para confirmar una operación local.
- **Idempotencia real**: todo registro sincronizable lleva `id` generado en el cliente (no
  autoincremental en servidor) y `idempotencyKey = hash(dispositivoId + entidad + operación +
  secuenciaLocal)`. El backend usa `id` como upsert key — reenviar el mismo lote no duplica nada.
- **Cola de sincronización por dispositivo**: `packages/shared` define `SyncEnvelope<T>` con
  `entidad, operacion (CREATE/UPDATE/DELETE), payload, version, deviceId, createdAtLocal`. Cada
  cliente mantiene su outbox en SQLite/AsyncStorage y la vacía por lotes (`POST /sync/push`)
  con reintento exponencial cuando detecta conectividad (`navigator.onLine` + heartbeat activo).
- **Resolución de conflictos**: *last-write-wins por campo* usando `updatedAtServer` como árbitro
  para catálogo/precios (editados centralmente), y *append-only* para pedidos/pagos/movimientos
  de inventario (nunca se sobrescriben, se agregan eventos de estado) — ver `docs/sync-flows.md`.
- **Tiempo real intra-sucursal y hacia CRM**: Socket.IO con salas por `sucursalId` y por
  `estacionCocinaId`. El backend re-emite a la sala del CRM (`empresa:{id}`) para dashboards
  en vivo. Si la sucursal pierde internet, el POS Windows sigue emitiendo en su propia LAN.
- **Auth**: JWT de acceso (15 min) + refresh token (30 días, rotativo, revocable), más **login
  por PIN** de 4-6 dígitos para meseros/cajero en terminales compartidas (token de sesión corto
  ligado a `dispositivoId`). Passwords con `bcrypt` (cost 12). Roles y permisos evaluados en
  backend (guards) y reflejados en frontend (ocultar/deshabilitar, nunca como única barrera).
- **Multisucursal desde el modelo de datos**: toda entidad operativa referencia `empresaId` y
  `sucursalId`; el catálogo es central pero su precio/disponibilidad se resuelve por sucursal
  vía `ProductoSucursal` (override), permitiendo catálogo compartido con variación local.
- **Auditoría**: interceptor global (`AuditInterceptor`) registra en `AuditLog` cada mutación
  sensible (descuentos, cancelaciones, cambios de precio, apertura/corte de caja, traspasos)
  con usuario, dispositivo, sucursal, valores anteriores/nuevos y timestamp.
- **API documentada**: Swagger/OpenAPI autogenerado por NestJS (`/api/docs`).
- **Empaquetado**: `electron-builder` (NSIS, `.exe` con acceso directo + desinstalador +
  auto-actualización vía `electron-updater`); `eas build` / Gradle para `.apk` firmado.

## 5. Seguridad

- Contraseñas: `bcrypt`. PIN: hash `bcrypt` también (no se guarda en claro), scope por sucursal.
- Transporte: HTTPS/WSS obligatorio en producción; certificados gestionados por el proveedor cloud.
- Autorización: guard de roles (`RolesGuard`) + guard de pertenencia a sucursal
  (`SucursalAccessGuard`) en cada endpoint que toca datos de sucursal.
- Operaciones sensibles (descuento, cancelación, apertura/corte de caja, traspaso) requieren
  `autorizadoPor` con rol `SUPERVISOR` o superior — validado en backend, no solo en UI.
- Rate limiting (`@nestjs/throttler`) en endpoints de auth y sync.
- Logs estructurados + Sentry (configurable por `SENTRY_DSN`) para monitoreo de errores.

## 5.1 Backend embebido en el POS Windows (standalone)

Desde v0.2.0, el instalador de `pos-desktop` empaqueta un backend NestJS + PostgreSQL
completos (vía [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres), un
Postgres real que corre como proceso hijo, sin instalador aparte) para que la app funcione
"de una" — sin requerir un backend cloud desplegado, Docker, ni configuración manual. Piezas:

- `apps/pos-desktop/scripts/prepare-embedded-backend.js`: en tiempo de build, compila y copia
  `apps/backend/dist` + `prisma/` (schema y migraciones) + un `node_modules` de producción
  instalado desde cero (no el hoisteado del monorepo) + el binario de Node usado para
  compilar, dentro de `resources/backend/` del instalador (`extraResources` en
  `electron-builder`). Se quita el CLI de `prisma` tras generar el cliente (no se usa en
  runtime, ahorra ~70 MB).
- `apps/pos-desktop/electron/backend-manager.ts`: al arrancar la app empaquetada, levanta
  Postgres embebido (puerto libre dinámico, datos persistentes en
  `app.getPath('userData')/local-data`), genera y guarda secretos (password de la BD, JWT)
  únicos por instalación, y lanza el backend compilado como proceso hijo usando el Node
  bundleado (no el propio binario de Electron — evita problemas de compatibilidad ABI de
  módulos nativos entre el Node de Electron y el Node estándar).
- `apps/backend/src/bootstrap/auto-bootstrap.ts` (activado solo con `AUTO_BOOTSTRAP=true`):
  si la base está vacía, aplica el `migration.sql` directamente (sin CLI de Prisma) y carga los
  datos demo (`src/bootstrap/seed-demo-data.ts`, misma lógica que usa `npm run db:seed`).
- El renderer espera a que el backend esté listo (`window.hangar.backend.obtenerUrl()`,
  pantalla de arranque) antes de mostrar el login — la primera vez tarda unos segundos
  (crear la base), después es casi instantáneo.

Esto es exclusivo del POS Windows. Cocina, la app de meseros y el CRM siguen siendo clientes
de un backend HTTP/WebSocket — el que se embebe en el POS, u otro desplegado en la nube (con
`HANGAR_CLOUD_API_URL` configurada en el POS para apuntar a ese backend en vez de crear uno
local, habilitando el escenario multisucursal real con una sola base central).

## 6. Despliegue cloud (resumen — detalle en `docs/deployment.md` dentro de cada app)

- **Backend + Postgres**: contenedor Docker (`infra/docker/docker-compose.yml` para local;
  en producción: Railway/Render/Fly.io/AWS ECS + RDS Postgres, gestionado por variables de
  entorno, con respaldos automáticos diarios de la base y `pg_dump` bajo demanda).
- **CRM web**: Vercel/Netlify (Next.js) o el mismo contenedor detrás de reverse proxy.
- **POS Windows**: instalador `.exe` distribuido internamente (no store); actualizaciones
  vía `electron-updater` apuntando a un bucket/objeto de releases.
- **App meseros**: `.apk` firmada, distribución interna (MDM / enlace directo), no Play Store
  en el MVP (documentado en `docs/installation.md` cómo generar el `.aab` si se requiere).

Ver también: [`data-model.md`](./data-model.md), [`sync-flows.md`](./sync-flows.md),
[`wireframes.md`](./wireframes.md), [`roadmap.md`](./roadmap.md).
