# HANGAR 421 — Plataforma POS multisucursal

[![Repo en GitHub](https://img.shields.io/badge/GitHub-hangar421-0B1E33?logo=github&logoColor=white)](https://github.com/xavisystem4-lab/hangar421)

Plataforma de punto de venta para cafeterías, **offline-first** y **multisucursal**, con POS
Windows táctil, app Android para meseros, pantalla de cocina en tiempo real y CRM/panel
administrativo en la nube.

> 📖 Antes de tocar código, lee **[`docs/architecture.md`](docs/architecture.md)** (arquitectura),
> **[`docs/data-model.md`](docs/data-model.md)** (modelo de datos y ERD), **[`docs/sync-flows.md`](docs/sync-flows.md)**
> (sincronización offline/multisucursal/cloud), **[`docs/wireframes.md`](docs/wireframes.md)** y
> **[`docs/roadmap.md`](docs/roadmap.md)** (plan por fases). Este README es la guía operativa.

## Estado de este entregable (MVP — Fase 1)

Implementado y **validado end-to-end contra una base de datos real** (login → catálogo →
pedido → cocina → cobro → descuento automático de inventario → dashboard):

| Componente | Estado |
|---|---|
| Backend (NestJS + Prisma + PostgreSQL + Socket.IO) | ✅ Completo, compila sin errores, 27 pruebas unitarias pasando |
| Modelo de datos (Prisma) | ✅ Completo, migración `init` generada y probada |
| Seed demo (empresa + 2 sucursales) | ✅ Completo y probado |
| POS Windows (Electron + React + SQLite local) | ✅ Completo, compila y compila su build de producción |
| Pantalla de cocina (React web) | ✅ Completo, compila y buildea |
| CRM web (Next.js) | ✅ Completo, `next build` exitoso |
| App meseros (Expo/React Native) | ✅ Completo, type-checks sin errores (no se generó APK en este entorno — ver `docs/installation.md`) |
| Traspasos, lealtad, reportes avanzados | 🚧 Modelo de datos listo, endpoints básicos; UI completa es Fase 2 (ver `docs/roadmap.md`) |

## Estructura del monorepo

```
hangar421/
├── apps/
│   ├── backend/          # NestJS API central (cloud) — REST + WebSocket + Prisma
│   ├── pos-desktop/      # Electron + React — POS Windows táctil, SQLite offline
│   ├── waiter-mobile/    # Expo/React Native — app Android de meseros
│   ├── kitchen-display/  # React web — pantalla de cocina en tiempo real
│   └── crm-web/          # Next.js — panel administrativo / CRM
├── packages/
│   └── shared/           # Tipos, enums, DTOs, contratos de sync y cálculos de negocio
│                          #   compartidos por los 4 clientes y el backend (una sola fuente
│                          #   de verdad para totales, impuestos, descuentos, inventario)
├── infra/docker/          # docker-compose para Postgres + backend en local
└── docs/                  # Arquitectura, modelo de datos, flujos, wireframes, roadmap
```

## Requisitos

- Node.js 20+ y npm 10+ (usa `npm workspaces`, no requiere pnpm/yarn).
- PostgreSQL 14+ (local, Docker, o gestionado en la nube).
- Para el POS Windows: herramientas de build nativas (better-sqlite3 compila con `node-gyp`;
  en Windows instala "Desktop development with C++" de Visual Studio Build Tools).
- Para la app de meseros: Expo CLI (`npx expo`) y, para generar el `.apk`, una cuenta de
  Expo/EAS (`eas-cli`).

## Puesta en marcha local (resumen — detalle en `docs/installation.md`)

```bash
# 1. Instalar todo el monorepo
npm install

# 2. Base de datos (elige una opción)
#    a) Docker:
docker compose -f infra/docker/docker-compose.yml up -d postgres
#    b) Postgres local ya instalado: crea una base `hangar421` y usa su URL

# 3. Variables de entorno
cp .env.example .env
# edita DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (mínimo 32 caracteres)

# 4. Migraciones + datos demo
npm run db:migrate --workspace=apps/backend
npm run db:seed --workspace=apps/backend

# 5. Backend
npm run dev:backend      # http://localhost:3000/api/v1 — Swagger en /api/docs

# 6. Clientes (en terminales separadas)
npm run dev:crm          # CRM        → http://localhost:3001
npm run dev:kitchen      # Cocina     → http://localhost:5174
npm run dev:pos          # POS Windows (ventana Electron)
npm run dev:waiter       # App meseros (Expo, escanea el QR con Expo Go)
```

Credenciales demo (todas con password `Hangar421!`; el PIN es para login rápido en POS/app
mesero/cocina): ver la salida de `npm run db:seed` o `apps/backend/prisma/seed.ts`. Incluye un
usuario de cada rol (`ADMIN_CORPORATIVO`, `ADMIN_SUCURSAL`, `CAJERO`, `MESERO`, `COCINA`,
`SUPERVISOR`) para las dos sucursales demo (Roma Norte y Condesa).

## Variables de entorno

Ver [`.env.example`](.env.example) para la lista completa y comentada. Las más importantes:

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL del backend cloud |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Secretos de firma JWT (≥32 caracteres, distintos entre sí) |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Vigencia de tokens (`15m` / `30d` por defecto) |
| `CORS_ORIGINS` | Orígenes permitidos (CRM, POS en dev, etc.) |
| `VITE_API_URL` / `VITE_WS_URL` | URL del backend para POS y cocina (Vite) |
| `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` | URL del backend para el CRM (Next.js) |
| `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_WS_URL` | URL del backend para la app de meseros (o `extra.apiUrl/wsUrl` en `app.json`) |

## Comandos principales (raíz del monorepo)

| Comando | Qué hace |
|---|---|
| `npm run dev:backend` | Backend en modo watch |
| `npm run dev:pos` | POS Windows (Electron + Vite) |
| `npm run dev:kitchen` | Pantalla de cocina |
| `npm run dev:crm` | CRM (Next.js) |
| `npm run dev:waiter` | App de meseros (Expo) |
| `npm run db:migrate --workspace=apps/backend` | Aplica migraciones Prisma |
| `npm run db:seed --workspace=apps/backend` | Carga datos demo |
| `npm run build:pos:win --workspace=apps/pos-desktop` | Genera el instalador `.exe` (Windows) |
| `npm run build:waiter:apk --workspace=apps/waiter-mobile` | Genera el `.apk` (Android) |
| `npm test --workspace=packages/shared` | Pruebas unitarias de cálculos de negocio |
| `npm test --workspace=apps/backend` | Pruebas unitarias del backend (sync, idempotencia) |

Ver **[`docs/installation.md`](docs/installation.md)** para el manual paso a paso completo,
incluyendo generación del `.exe` y `.apk`, y **[`docs/deployment.md`](docs/deployment.md)** para
el despliegue en la nube (backend, Postgres, CRM), respaldos y monitoreo.

## Documentación de API

El backend expone **Swagger/OpenAPI** en `/api/docs` (interactivo, con "Authorize" para probar
endpoints protegidos). Resumen de recursos en **[`docs/api.md`](docs/api.md)**.

## Pruebas

```bash
npm test --workspace=packages/shared   # 23 pruebas: totales, impuestos, descuentos, pagos
                                        # mixtos, inventario, traspasos
npm test --workspace=apps/backend      # 4 pruebas: idempotencia y reintentos de /sync/push
```

## Seguridad y auditoría

- Contraseñas y PIN con `bcrypt`; JWT de acceso corto + refresh rotativo revocable.
- Permisos por rol validados en backend (`RolesGuard`, `SucursalAccessGuard`), nunca solo en UI.
- `AuditLog` registra descuentos, cancelaciones, cambios de precio, apertura/corte de caja y
  traspasos, con usuario, dispositivo, sucursal e IP.
- Ver `docs/architecture.md` §5 para el detalle completo.

## Licencia y autoría

Proyecto entregado como base de implementación para HANGAR 421. Ajusta la licencia según las
necesidades del negocio antes de distribuir.
