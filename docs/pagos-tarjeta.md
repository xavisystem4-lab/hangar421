# Pago con tarjeta (terminal física)

Cobro con tarjeta coordinado por el backend entre el POS y la APK de Meseros: el POS crea una
solicitud, el backend la manda a la terminal del proveedor configurado, y el resultado real
(aprobado/rechazado) llega por webhook — nunca por lo que reporte la APK o el POS.

## Arquitectura (resumen)

```
POS (ModalCobro) ──POST /pagos/solicitudes──▶ Backend ──crea orden──▶ Mercado Pago ──▶ Terminal Point Smart
                                                 │                                          │
                                                 │◀────────── webhook (firmado) ────────────┘
                                                 │
                    ◀── WebSocket pago:actualizado ──┤── WebSocket pago:actualizado ──▶
                    (sala sucursal:{id})              (sala usuario:{meseroId})
                                                                                    APK de Meseros
```

- **Backend**: `apps/backend/src/pagos/` — `PagosService` (máquina de estados), adaptadores de
  proveedor (`proveedores/`), `PagosController` (REST + webhook).
- **Modelo de datos**: `PaymentProviderConfig`, `PaymentTerminal`, `PaymentRequest`,
  `PaymentEvent`, `PushToken` (ver `apps/backend/prisma/schema.prisma`).
- **Extensibilidad**: sumar un proveedor nuevo (otro banco, Stripe Terminal, etc.) es escribir
  una clase que implemente `ProveedorPagoAdapter` (`pagos/proveedores/proveedor-pago.interface.ts`)
  y registrarla en `ProveedorPagoRegistry` — nada más del módulo cambia.

### Estados de una solicitud (`EstadoSolicitudPago`)

`PENDIENTE → ENVIADO_A_TERMINAL → EN_PROCESO → APROBADO`, con salidas a `RECHAZADO`,
`CANCELADO`, `EXPIRADO` o `ERROR` en cualquier punto antes de `APROBADO`. Una vez en un estado
final, ninguna transición nueva se aplica (protege contra un webhook duplicado/reintentado).

Al llegar a `APROBADO`, `PagosService` llama a `PedidosService.cobrar()` directamente (mismo
endpoint que usa un cobro en efectivo) — hereda su idempotencia, descuento de inventario,
liberar mesa y emisión de eventos, sin duplicar esa lógica.

## Configuración local (desarrollo, sin cuenta real de Mercado Pago)

1. `PAGOS_CIFRADO_KEY` en `apps/backend/.env` (cualquier string — cifra las credenciales de
   proveedor en reposo, AES-256-GCM):
   ```
   PAGOS_CIFRADO_KEY=cualquier-secreto-local-de-desarrollo
   ```
2. Desde Administración → Terminales de pago, crea una configuración con proveedor **"Prueba /
   demo (sin terminal real)"** (`mock`) — no pide credenciales.
3. Da de alta una terminal con cualquier `identificadorExterno` (ej. `MOCK-TERMINAL-1`).
4. En el POS, "Tarjeta" → "Cobrar con terminal" → "Iniciar cobro en terminal" deja la solicitud
   en `ENVIADO_A_TERMINAL`. Para simular la aprobación del proveedor:
   ```bash
   curl -X POST http://localhost:3000/api/v1/pagos/webhooks/<proveedorConfigId> \
     -H "Content-Type: application/json" \
     -d '{"referenciaInterna":"<idempotencyKey de la solicitud>","referenciaExterna":"mock_ext","estado":"APROBADO"}'
   ```
   El POS/APK se actualizan solos por WebSocket, sin recargar.

## Configuración con Mercado Pago Point Smart (real)

**Requisitos previos (fuera de esta app, en el dashboard de Mercado Pago):**
1. Cuenta de Mercado Pago con Point Smart activada.
2. Crear una aplicación en *Tus integraciones* → obtener **Access Token** (pruebas o
   producción) y el **Webhook Secret** (*Tus integraciones* → tu app → *Webhooks* → *Configurar
   notificación* → revelar la clave).
3. Vincular la terminal Point Smart a una tienda/caja y **activarla en modo PDV** — es el único
   modo que permite recibir órdenes remotas por API (`PATCH /terminals/v1/setup`,
   `operating_mode: "PDV"`, desde el dashboard o la API de Mercado Pago). Solo una terminal en
   PDV por punto de venta.
4. El `terminal_id` que resulta de ese proceso (ej. `NEWLAND_N950__...` o el que Mercado Pago
   asigne al Point Smart) es lo que se captura como `identificadorExterno` al dar de alta la
   terminal en Administración.

**En HANGAR 421 (Administración → Terminales de pago):**
1. Nueva configuración → proveedor **"Mercado Pago (Point Smart)"**, ambiente (Pruebas/Producción),
   Access Token, Webhook Secret.
2. En el dashboard de Mercado Pago, registra la URL de webhook:
   `https://<tu-backend>/api/v1/pagos/webhooks/<id-de-la-configuración>` (el id se ve en la
   respuesta al guardar la configuración, o vía `GET /pagos/proveedores`).
3. Nueva terminal → selecciona esa configuración, pega el `terminal_id`, asigna sucursal/zona/mesero.
4. "Probar conexión" hace un `GET /terminals/v1/list` real contra Mercado Pago para confirmar
   que el Access Token funciona.

El adaptador (`apps/backend/src/pagos/proveedores/mercadopago.adapter.ts`) usa la **Orders API**
unificada de Mercado Pago (`POST /v1/orders` con `type: "point"`), que es el método vigente
recomendado para Point Smart (la API anterior, `point/integration-api/.../payment-intents`,
quedó como legacy) — verificado contra la documentación oficial de Mercado Pago al implementarlo.

## Producción — lo que falta antes de cobrar dinero real

- **Credenciales reales de Mercado Pago** (Access Token + Webhook Secret de producción, no de
  pruebas) — nadie más las tiene, deben capturarse desde Administración por quien administre la
  cuenta de Mercado Pago del negocio.
- **`PAGOS_CIFRADO_KEY` de producción**: un secreto robusto y único (no el de desarrollo),
  cargado como variable de entorno en el hosting del backend (Railway), nunca en el repo.
- **Notificaciones push (FCM)**: hoy el tiempo real funciona vía WebSocket mientras la APK tiene
  conexión (foreground o background con la app viva) — para despertarla con la app *cerrada*
  hace falta un proyecto de Firebase (credenciales de service account) que todavía no existe.
  El registro de tokens ya está listo (`POST /pagos/push-tokens`, tabla `PushToken`); falta
  instalar `firebase-admin` en el backend y reemplazar el cuerpo de
  `PushService.enviarPush()` (hoy un stub que solo registra en log) por el envío real.
- **Terminal(es) físicas** vinculadas y en modo PDV en el dashboard de Mercado Pago (paso manual,
  no automatizable por API).

## Pruebas automatizadas

```bash
npm test --workspace=apps/backend -- pagos
```

Cubre: idempotencia al crear una solicitud (doble tap), bloqueo de una segunda solicitud activa
sobre la misma cuenta, que un webhook duplicado no liquide el pedido dos veces, que una
solicitud en estado final no pueda transicionar de nuevo, cancelar/reintentar, y verificación de
firma de webhook de Mercado Pago (firma válida, alterada, de otra cuenta, ausente) más el mapeo
de estados de orden.
