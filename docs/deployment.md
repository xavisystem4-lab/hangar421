# HANGAR 421 — Despliegue en la nube

## 1. Backend + PostgreSQL

Cualquier proveedor con contenedores + Postgres gestionado sirve. Sugerencias por tamaño de
equipo:

- **Rápido de arrancar**: Railway / Render — conecta el repo, define el `Dockerfile` de
  `apps/backend`, agrega un addon de Postgres gestionado y copia las variables de `.env.example`.
- **Control total**: AWS ECS/Fargate (o similar) + RDS PostgreSQL, detrás de un ALB con TLS.
- **Local/on-prem**: `infra/docker/docker-compose.yml` como base para un servidor dedicado.

Pasos generales:

1. Construir la imagen: `docker build -t hangar421-backend apps/backend` (usa el `Dockerfile`
   incluido — build multi-stage, genera Prisma Client y compila TypeScript).
2. Definir variables de entorno de producción (`DATABASE_URL` apuntando al Postgres gestionado,
   `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` únicos y secretos, `CORS_ORIGINS` con los dominios
   reales del CRM/POS, `NODE_ENV=production`).
3. Ejecutar migraciones en el despliegue: `npx prisma migrate deploy` (no usa `migrate dev`,
   que es solo para desarrollo local — `deploy` no genera migraciones nuevas, solo aplica las
   ya versionadas en `prisma/migrations/`).
4. Exponer el puerto (`PORT`, 3000 por defecto) detrás de un reverse proxy con TLS.
5. Habilitar WebSocket en el balanceador/proxy (sticky sessions si hay más de una instancia del
   backend, o mover Socket.IO a un adaptador Redis para multi-instancia — Fase 2 si se escala
   horizontalmente).

### Respaldos

- Respaldo automático diario gestionado por el proveedor de Postgres (RDS/Railway/Render lo
  ofrecen de forma nativa) — configurar retención mínima de 7-14 días.
- Respaldo manual bajo demanda: `pg_dump "$DATABASE_URL" -Fc -f respaldo-$(date +%F).dump`.
- Restauración: `pg_restore -d "$DATABASE_URL" --clean respaldo-YYYY-MM-DD.dump`.

### Monitoreo y logs

- Logs estructurados vía el `Logger` de NestJS (stdout — el proveedor cloud los captura).
- Errores no controlados: configurar `SENTRY_DSN` (variable ya prevista en `.env.example`) e
  integrar `@sentry/node` en `main.ts` (Fase 2 — el hook está listo, falta la dependencia).
- Salud del servicio: agregar un endpoint `/health` (Fase 2) o monitorear `/api/docs` (200 OK)
  como healthcheck mínimo mientras tanto.
- Estado de sincronización por sucursal: visible en vivo en el dashboard del CRM
  (`GET /reportes/dashboard` → `estadoSucursales[].dispositivos[].enLinea`).

## 2. CRM web (`apps/crm-web`)

- **Recomendado**: Vercel (Next.js nativo) — conecta el repo, root directory `apps/crm-web`,
  variables `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL` apuntando al backend de producción.
- **Alternativa**: build estático/SSR en el mismo contenedor Docker que el backend, detrás de
  un reverse proxy (`npm run build && npm run start --workspace=apps/crm-web`).

## 3. POS Windows (`apps/pos-desktop`)

No se despliega en la nube — se distribuye como instalador `.exe` (ver `docs/installation.md`
§8). Para actualizaciones automáticas en producción:

1. Firmar el instalador con un certificado de firma de código (evita advertencias de Windows
   SmartScreen).
2. Configurar `build.publish` en `apps/pos-desktop/package.json` apuntando a un bucket S3/GitHub
   Releases con los artefactos de cada versión.
3. `electron-updater` (ya integrado) revisa ese feed y aplica actualizaciones en segundo plano.

## 4. App de meseros (`apps/waiter-mobile`)

Distribución interna del `.apk` (sin Play Store) vía:
- Enlace directo de descarga (bucket privado, MDM corporativo).
- Play Store interna/cerrada si se requiere en el futuro (requiere generar `.aab` con
  `eas build --platform android` sin `--local` y sin perfil `preview`).

## 5. Pantalla de cocina (`apps/kitchen-display`)

Es una app web estática tras el build (`npm run build --workspace=apps/kitchen-display`) — se
sirve desde cualquier hosting estático (Nginx local en la sucursal, o el mismo Vercel/Netlify si
se prefiere centralizado). En la práctica, para resiliencia ante caídas de internet en la
sucursal, se recomienda servirla **localmente** (Nginx en el POS Windows o un Raspberry Pi en la
misma LAN) en vez de depender de un hosting externo.

## 6. Checklist de salida a producción

- [ ] Secretos JWT únicos y rotativos, nunca los valores de ejemplo de `.env.example`.
- [ ] `CORS_ORIGINS` restringido a los dominios reales (no `*`).
- [ ] TLS habilitado en backend, CRM y WebSocket.
- [ ] Migraciones aplicadas con `prisma migrate deploy` (no `migrate dev`).
- [ ] Respaldo automático de Postgres configurado y probado (restaurar al menos una vez).
- [ ] Certificado de firma de código para el instalador Windows.
- [ ] Keystore de producción propia para el `.apk` (no la autogenerada de `eas build preview`).
- [ ] Monitoreo de errores (Sentry u equivalente) conectado.
