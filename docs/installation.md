# HANGAR 421 — Manual de instalación local

## 1. Requisitos previos

- **Node.js 20+** y **npm 10+**.
- **PostgreSQL 14+** — local (Postgres.app, Homebrew, instalador oficial) o vía Docker.
- **Git** (opcional, si clonas desde un repositorio).
- Para compilar el POS Windows: build tools nativas para `better-sqlite3`
  (Windows: "Desktop development with C++" de Visual Studio Build Tools; macOS: Xcode CLT;
  Linux: `build-essential` + `python3`).
- Para la app de meseros: `npx expo` (incluido al instalar dependencias) y, para builds `.apk`,
  una cuenta gratuita de [Expo/EAS](https://expo.dev) y `npx eas-cli`.

## 2. Clonar e instalar

```bash
git clone <tu-repositorio> hangar421
cd hangar421
npm install
```

Esto instala **todos** los workspaces (`backend`, `pos-desktop`, `kitchen-display`, `crm-web`,
`waiter-mobile`, `packages/shared`) en un solo `node_modules` raíz (npm workspaces).

> Si tu entorno bloquea scripts de instalación (por ejemplo, un wrapper de seguridad de npm),
> aprueba los paquetes con `install`/`postinstall` necesarios: `better-sqlite3`, `bcrypt`,
> `electron`, `@prisma/client`, `prisma`, `esbuild` — normalmente con
> `npm approve-scripts <paquete>` o el equivalente de tu entorno.

## 3. Base de datos

### Opción A — Docker (recomendada para probar rápido)

```bash
docker compose -f infra/docker/docker-compose.yml up -d postgres
```

Levanta Postgres en `localhost:5432` con usuario `hangar` / password `hangar_dev_pw` / base
`hangar421` (ver `infra/docker/docker-compose.yml`).

### Opción B — Postgres ya instalado localmente

```bash
createdb hangar421
```

Ajusta `DATABASE_URL` en tu `.env` con el usuario/password/host correctos.

## 4. Variables de entorno

```bash
cp .env.example .env
```

Edita al menos:
- `DATABASE_URL` — apunta a tu Postgres (Docker u opción B).
- `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` — cualquier cadena aleatoria ≥32 caracteres,
  **distinta** entre ambas (ej. `openssl rand -hex 32`).

Cada app cliente (`pos-desktop`, `kitchen-display`, `crm-web`, `waiter-mobile`) lee la URL del
backend de su propia variable (`VITE_API_URL`, `NEXT_PUBLIC_API_URL`, `EXPO_PUBLIC_API_URL` /
`app.json > extra`) — en desarrollo local los valores por defecto (`localhost:3000`) ya
funcionan sin configurar nada adicional.

## 5. Migraciones y datos demo

```bash
npm run db:migrate --workspace=apps/backend   # crea las tablas (prisma migrate dev)
npm run db:seed --workspace=apps/backend      # empresa "Café Hangar 421" + 2 sucursales +
                                                # catálogo + usuarios de cada rol + mesas
```

La salida del seed imprime los **IDs de empresa y sucursales**, y las credenciales demo
(correo/contraseña `Hangar421!`, y PIN de 4 dígitos por rol) — los necesitarás para las
pantallas de "Configuración inicial" del POS/cocina/app mesero.

## 6. Levantar el backend

```bash
npm run dev:backend
```

- API REST: `http://localhost:3000/api/v1`
- Documentación interactiva (Swagger): `http://localhost:3000/api/docs`
- WebSocket (tiempo real): `ws://localhost:3000/realtime`

## 7. Levantar los clientes

En terminales separadas (todas necesitan el backend corriendo):

```bash
npm run dev:crm       # CRM        → http://localhost:3001  (login con correo/contraseña)
npm run dev:kitchen   # Cocina     → http://localhost:5174  (configurar sucursalId/usuarioId/PIN)
npm run dev:pos       # POS        → ventana Electron        (login con correo/contraseña)
npm run dev:waiter    # App mesero → Expo — escanea el QR con la app Expo Go en tu celular/tablet
```

Para la **app de meseros**, si usas un dispositivo físico en la misma red Wi-Fi que tu
computadora, cambia `EXPO_PUBLIC_API_URL`/`extra.apiUrl` en `apps/waiter-mobile/app.json` de
`localhost` a la IP local de tu máquina (ej. `http://192.168.1.50:3000/api/v1`).

## 8. Generar el instalador Windows (`.exe`)

Desde Windows (o con cross-compilación configurada), coloca un ícono en
`apps/pos-desktop/build/icon.ico` (ver `apps/pos-desktop/build/README.md`) y corre:

```bash
npm run build:pos:win --workspace=apps/pos-desktop
```

Genera un instalador NSIS en `apps/pos-desktop/release/` con acceso directo de escritorio,
entrada en el menú inicio y desinstalador. `electron-updater` ya está integrado como dependencia
para habilitar auto-actualización apuntando a un feed de releases (configurar `publish` en
`package.json > build` cuando exista el bucket/servidor de releases — Fase 2).

## 9. Generar el APK Android

```bash
cd apps/waiter-mobile
npx eas-cli build --platform android --profile preview --local
```

- Requiere una cuenta Expo/EAS (`npx eas login`) o build local con Android SDK instalado.
- El perfil `preview` genera un `.apk` firmado con una keystore de desarrollo autogenerada,
  listo para distribución interna (instalación directa en tablets/celulares, sin pasar por
  Play Store). Para producción firmada con tu propia keystore, configura `eas.json`
  (`eas build:configure`) y usa `credentials.json` — documentado en la
  [guía oficial de EAS](https://docs.expo.dev/build/introduction/).

## 10. Recuperación ante fallas

- **Backend caído**: los clientes offline-first (POS, app mesero) siguen operando localmente
  (SQLite/AsyncStorage) y sincronizan automáticamente al reconectar — ver `docs/sync-flows.md`.
- **Base de datos corrupta/perdida**: restaura desde el último respaldo (`pg_dump` — ver
  `docs/deployment.md`) y vuelve a aplicar migraciones pendientes con
  `npx prisma migrate deploy`.
- **Conflicto de sincronización**: revisar `SyncQueueItem.estado = 'ERROR'` (tabla `sync_queue_items`)
  y `AuditLog` con `accion = 'SYNC_CONFLICT'` para diagnóstico — ver estrategia de resolución en
  `docs/sync-flows.md` §4.
