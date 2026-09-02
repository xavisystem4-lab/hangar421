# HANGAR 421 — API

La documentación interactiva completa (con esquemas de request/response y prueba en vivo) vive
en **Swagger**, generado automáticamente por NestJS a partir de los DTOs y decoradores:

```
http://localhost:3000/api/docs
```

Este documento es un mapa de navegación rápido; el detalle de cada campo está en Swagger y en
`packages/shared/src/types/` (los mismos tipos que usan los 4 clientes).

## Convenciones

- Base URL: `{API_URL}` (`http://localhost:3000/api/v1` en desarrollo).
- Autenticación: `Authorization: Bearer <accessToken>` (ver `POST /auth/login` o `/auth/login-pin`).
- Todos los endpoints (salvo `/auth/*` marcados públicos) requieren JWT válido; muchos además
  requieren un rol específico (`RolesGuard`) y pertenencia a la sucursal (`SucursalAccessGuard`).
- Fechas en ISO 8601. Montos como `number` (el backend serializa `Decimal` de Prisma a número).

## Recursos principales

| Recurso | Endpoints clave |
|---|---|
| **Auth** | `POST /auth/login`, `POST /auth/login-pin`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/switch-sucursal` |
| **Empresas** | `GET /empresas/:id`, `PUT /empresas/:id` |
| **Sucursales** | `GET /sucursales`, `POST /sucursales`, `GET/POST /sucursales/:id/{areas,dispositivos,cajas}` |
| **Usuarios** | `GET /usuarios?sucursalId=`, `POST /usuarios`, `PATCH /usuarios/:id/{pin,password,desactivar}` |
| **Catálogo** | `GET /catalogo/categorias`, `GET /catalogo/productos?empresaId=&sucursalId=` (resuelve precio/disponibilidad por sucursal), `POST /catalogo/productos`, `PATCH /catalogo/productos/:id/{precio-sucursal,disponibilidad}`, `POST /catalogo/modificadores` |
| **Mesas** | `GET /mesas?sucursalId=`, `POST /mesas`, `PATCH /mesas/:id/estado` |
| **Pedidos** | `POST /pedidos` (idempotente por `id`), `POST /pedidos/:id/{items,enviar-cocina,descuentos,cobrar,cancelar}`, `PATCH /pedidos/:id/items/:itemId/estado`, `GET /pedidos?sucursalId=&estado=` |
| **Cocina** | `GET /cocina/comandas?sucursalId=&estacionCocinaId=` |
| **Caja** | `POST /caja/turnos/abrir`, `POST /caja/turnos/:id/cerrar`, `GET /caja/cajas/:id/turno-activo`, `GET /caja/turnos/:id/resumen` |
| **Inventario** | `GET /inventario/{insumos,existencias,alertas,movimientos}`, `POST /inventario/{insumos,movimientos,minimos}`, `POST /inventario/productos/:id/receta` |
| **Traspasos** | `GET/POST /traspasos`, `POST /traspasos/:id/{autorizar,enviar,recibir,validar,cancelar}` |
| **Clientes** | `GET /clientes?empresaId=&q=`, `POST /clientes`, `GET /clientes/:id/historial` |
| **Reportes** | `GET /reportes/dashboard?empresaId=&sucursalId=`, `GET /reportes/ventas-por-hora`, `GET /reportes/ventas-por-producto`, `GET /reportes/ventas-por-metodo-pago` |
| **Sync** | `POST /sync/push` (lote de operaciones offline, idempotente), `GET /sync/pull?sucursalId=&since=` (incremental) |

## WebSocket (tiempo real)

Namespace por defecto, `path: /realtime`. Al conectar, el cliente emite `join` con las salas
que le interesan:

```ts
socket.emit("join", { sucursalId, empresaId, estacionId, usuarioId });
```

Eventos emitidos por el servidor (ver `packages/shared/src/types/sync.ts` → `WS_EVENTS`):

| Evento | Sala(s) | Cuándo |
|---|---|---|
| `pedido:creado` | `sucursal:{id}`, `empresa:{id}` | Se crea un pedido |
| `pedido:actualizado` | `sucursal:{id}`, `empresa:{id}` | Cambia estado/totales de un pedido |
| `pedido_item:actualizado` | `sucursal:{id}` | Cocina cambia el estado de un ítem |
| `mesa:actualizada` | `sucursal:{id}` | Cambia el estado de una mesa |
| `comanda:nueva` | `sucursal:{id}` | Un pedido se envía a cocina |
| `comanda:lista` | `sucursal:{id}`, `usuario:{meseroId}` | Todos los ítems de un pedido quedan listos |
| `inventario:alerta` | `sucursal:{id}`, `empresa:{id}` | Existencia ≤ mínimo tras un movimiento |

## Ejemplo — flujo completo (curl)

```bash
# 1. Login
TOKEN=$(curl -s -X POST $API/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@hangar421.com","password":"Hangar421!"}' | jq -r .accessToken)

# 2. Crear y enviar un pedido de mostrador
curl -s -X POST $API/pedidos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "id": "<uuid-v7>", "empresaId": "...", "sucursalId": "...",
  "tipo": "MOSTRADOR", "canalOrigen": "POS_WINDOWS", "enviarInmediato": true,
  "idempotencyKey": "dev-1-pedido-1",
  "items": [{ "productoId": "...", "cantidad": 2 }]
}'

# 3. Cobrar
curl -s -X POST $API/pedidos/<id>/cobrar -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pagos":[{"metodo":"EFECTIVO","monto":150}]}'
```

Este flujo (login → catálogo → pedido → cocina → cobro → descuento automático de inventario →
dashboard) fue **probado end-to-end contra una base de datos PostgreSQL real** como parte de
este entregable.
