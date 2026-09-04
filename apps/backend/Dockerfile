# Se construye con el MONOREPO COMPLETO como build context (no solo apps/backend) — el backend
# depende de @hangar421/shared vía workspaces de npm, así que necesita ver el repo entero para
# resolverlo. En Railway/Render: Root Directory = raíz del repo, Dockerfile Path = apps/backend/Dockerfile.
FROM node:20-alpine AS build
WORKDIR /app

# Prisma detecta el binary target (incluyendo si hay libssl) en el momento de `prisma generate`.
# Sin openssl aquí, genera el motor para "linux-musl" (sin ssl); el stage final SÍ tiene openssl,
# así que en runtime busca "linux-musl-openssl-3.0.x" y no lo encuentra. Deben coincidir.
RUN apk add --no-cache openssl

# Todo el código fuente de los dos workspaces que hacen falta para el backend (nada de
# crm-web/pos-desktop/kitchen-display/waiter-mobile) — el `postinstall` de la raíz compila
# @hangar421/shared automáticamente en cuanto corre `npm install`, así que su código fuente
# (no solo el package.json) tiene que estar presente desde antes.
COPY package*.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend

RUN npm install --workspace=packages/shared --workspace=apps/backend

RUN npx prisma generate --schema=apps/backend/prisma/schema.prisma
RUN npm run build --workspace=apps/backend

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# El motor de Prisma (query engine / schema engine) necesita libssl en tiempo de ejecución —
# node:20-alpine no lo trae por defecto. Sin esto, tanto `prisma migrate deploy` (pre-deploy
# command) como el propio backend al arrancar fallan con "Could not parse schema engine response".
RUN apk add --no-cache openssl

# node_modules completo de la raíz (ahí quedan los symlinks de los workspaces y el cliente de
# Prisma generado) + los `dist` compilados + el schema/migraciones de Prisma.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json

EXPOSE 3000
CMD ["node", "apps/backend/dist/main.js"]
