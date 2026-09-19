# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Todo el proyecto (código, comentarios, documentación, mensajes de commit) está en **español**.
> Mantén ese idioma en el código nuevo y en los commits.

## Comandos

Monorepo con **npm workspaces** (no pnpm/turbo). Node 20+. Todo se corre desde la raíz con
`--workspace=`.

```bash
npm install                  # el postinstall compila packages/shared automáticamente
npm run build:shared         # recompílalo a mano tras tocar packages/shared (ver nota abajo)
```

| Tarea | Comando |
|---|---|
| Typecheck de un workspace | `npm run typecheck --workspace=<ws>` |
| Pruebas | `npm test --workspace=packages/shared` · `apps/backend` · `apps/pos-terminal` |
| Una sola prueba | `npm test --workspace=apps/backend -- sync.service.spec.ts` |
| Un solo caso | `npm test --workspace=packages/shared -- -t "descuento"` |
| Lint (solo backend) | `npm run lint --workspace=apps/backend` |
| Migraciones / seed | `npm run db:migrate --workspace=apps/backend` · `db:seed` |
| Dev | `npm run dev:backend` · `dev:crm` · `dev:kitchen` · `dev:pos` · `dev:pos-terminal` · `dev:waiter` |

Instalación completa, credenciales demo y generación de `.exe`/`.apk`: `README.md` y
`docs/installation.md` — no los repitas aquí.

### Qué valida CI (`.github/workflows/ci.yml`)

Un job por workspace. `packages/shared`, `apps/backend` y `apps/pos-terminal` corren
**typecheck + tests**; `kitchen-display`, `crm-web` y `pos-desktop` corren **typecheck + build**;
`waiter-mobile` solo **typecheck**. Antes de dar algo por terminado, corre al menos el typecheck
del workspace tocado más los tests que existan en él.

### Dos resoluciones distintas de `@hangar421/shared`

- Los **tests** (Jest) lo mapean a `packages/shared/src/index.ts` vía `moduleNameMapper` — no hace
  falta compilarlo para testear.
- **Typechecks y builds** lo consumen desde `dist/` + `dist-esm/`. Si editas `packages/shared` y un
  build de otra app falla con tipos viejos, es que falta `npm run build:shared`.

## Arquitectura

Lectura obligatoria antes de tocar flujos de negocio: `docs/architecture.md`,
`docs/data-model.md`, `docs/sync-flows.md`. Resumen de lo que no se ve leyendo un archivo suelto:

### `packages/shared` es la única fuente de verdad del negocio

`calculos.ts` contiene funciones **puras** (subtotal, descuentos, impuestos, totales, inventario)
sin dependencias de Prisma ni Nest. El backend (`PedidosService`, `InventarioService`) y los
clientes las importan en vez de reimplementarlas. Si cambias una regla de dinero, cámbiala ahí y
ajusta `calculos.spec.ts` — no parchees el cálculo en una app. `types/sync.ts` define el contrato
de sincronización que consumen todos los clientes.

### Offline-first: cada escritura nace local

Ningún flujo crítico (pedido, envío a cocina, cobro, corte de caja) espera a la nube. Toda
escritura sincronizable:

1. Genera su `id` en el **cliente** con `uuid7()` (ordenable por tiempo) — ese id es también el id
   final en el servidor, nunca hay autoincremental.
2. Se guarda en SQLite local con `syncStatus: PENDING` y entra en el **outbox**.
3. Se drena por lotes contra `POST /sync/push` con backoff exponencial; el servidor hace upsert
   por `id` e ignora duplicados por `idempotencyKey = hash(dispositivoId + entidad + operación +
   secuenciaLocal)`. Reenviar el mismo lote es seguro por diseño.
4. El catálogo viaja en sentido inverso (`/sync/pull` con cursor `since`) y es de solo lectura
   offline entre sincronizaciones.

Conflictos: **last-write-wins por campo** (árbitro `updatedAtServer`) para catálogo y precios, que
se editan centralmente; **append-only** para pedidos, pagos y movimientos de inventario — nunca se
sobrescriben, se agregan eventos de estado.

### Hay DOS aplicaciones de punto de venta — no las confundas

| | `apps/pos-desktop` | `apps/pos-terminal` |
|---|---|---|
| Plataforma | Windows (Electron + React + Vite) | Android (Expo / React Native) |
| Base local | `better-sqlite3` | `expo-sqlite` |
| Backend | **Embebe** su propio NestJS + PostgreSQL; es el hub de la sucursal | Ninguno: habla directo con el ERP en la nube |
| Estado | Maduro, con autoactualización | Frente de trabajo activo |

`apps/waiter-mobile` (meseros) y `apps/kitchen-display` (cocina) son clientes del hub de sucursal
vía Socket.IO en LAN; `apps/crm-web` es el panel corporativo contra el backend cloud.

### Convenciones que el repo ya sigue — respétalas

- **Sin librerías externas para infraestructura propia**: el motor de sync, el outbox, el backoff,
  el generador de UUID v7 y el runner de migraciones están escritos a mano. No introduzcas una
  dependencia para algo que ya está resuelto así.
- **Migraciones SQLite inmutables**: `apps/pos-terminal/src/db/migrations.ts` es una lista ordenada
  por `version`. Una migración publicada **no se edita jamás**; solo se añade otra al final. Cada
  `up()` corre en una sola transacción.
- **Tests en las apps RN**: solo lógica pura (SQL, cola de sync, hash de auth offline, migraciones).
  No hay runner de componentes React Native — no intentes montar uno.
- **Roles y permisos**: se validan en el backend (`RolesGuard`, `SucursalAccessGuard`). Ocultar algo
  en la UI nunca es la barrera de seguridad.
- **Secretos**: `.env` a partir de `.env.example`. `PAGOS_CIFRADO_KEY` cifra en reposo las
  credenciales de proveedores de pago (`docs/pagos-tarjeta.md`).

### Backend

NestJS + Prisma + PostgreSQL + Socket.IO, un módulo por dominio en `apps/backend/src/`
(`sync/` es el corazón de la sincronización; `realtime/` el gateway de salas por `sucursalId` y
`estacionCocinaId`). Swagger en `/api/docs`, API en `/api/v1`. Tras tocar
`prisma/schema.prisma` hace falta `npx prisma generate`.

## Releases

Cuatro workflows independientes: `ci.yml` más `release-pos.yml` (tags `vX.Y.Z`),
`release-waiter-apk.yml` (`waiter-vX.Y.Z`) y `release-pos-terminal.yml`. Los instaladores se
compilan **en GitHub Actions**, no en local.
