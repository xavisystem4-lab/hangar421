# Delivery (DiDi Food, Uber Eats, Rappi) en el POS APK

Admin → **Delivery** en `apps/pos-terminal` recibe, revisa y acepta los pedidos de DiDi Food, Uber
Eats y Rappi contra los endpoints `/plataformas/*` del ERP en la nube (los mismos que usan el POS de
Windows y el CRM). **Ningún secreto vive en el APK ni en el repositorio**: las credenciales se
capturan en la pantalla, viajan una sola vez al ERP y se guardan cifradas (AES-256-GCM con
`PLATAFORMAS_CIFRADO_KEY`); el ERP nunca las devuelve (solo los últimos 4 caracteres).

## Qué está implementado y qué depende de cada plataforma

> Nada de esto se ha probado todavía contra una tienda real o de prueba de las plataformas. Lo que
> sigue describe el código y la documentación oficial consultada el 06-oct-2026; antes de
> producción hay que hacer la prueba de punta a punta de la sección "Verificación".

| | DiDi Food | Uber Eats | Rappi |
|---|---|---|---|
| Acceso | Registro + certificación en developer.didi-food.com. Su documentación de órdenes **no es pública** | App aprobada por Uber para Marketplace APIs; la tienda la autoriza | Credenciales que entrega el equipo de integraciones de Rappi (TAM) + homologación |
| Autenticación | App ID / llave secreta (sin API de órdenes conectada) | OAuth2 `client_credentials` (`auth.uber.com/oauth/v2/token`, scopes `eats.order eats.store`) | OAuth2 `client_credentials` vía Auth0 (`rests-integrations[-dev].auth0.com`), header `x-authorization` |
| Firma del webhook | HMAC-SHA256 en `x-didi-signature` (supuesto, **sin confirmar**) | `X-Uber-Signature` = HMAC-SHA256 hex del body **crudo** con el Client Secret | `Rappi-Signature: t=…,sign=…` = HMAC-SHA256(secreto del webhook, `t.body`) |
| Probar conexión | Explica que falta la API (o `/ping` si se configura `DIDI_API_BASE_URL`) | Pide un token real: valida credenciales y aprobación | Pide un token real (requiere `RAPPI_AUTH_AUDIENCE`) |
| Aceptar desde el POS | **Manual**: se acepta en la tablet de DiDi y se confirma en el POS | Por API: `POST /v1/eats/orders/{id}/accept_pos_order` | Por API: `PUT …/stores/{store}/orders/{id}/take` |
| Rechazar desde el POS | Manual | Por API: `deny_pos_order` (código `OTHER`) | **Manual** (el tipo de cancelación válido no está confirmado) |
| Cancelaciones de la plataforma | Si el evento dice "cancel" | `orders.cancel` / `orders.failure` | `ORDER_EVENT_CANCEL` |
| Tiempo para responder | No documentado públicamente | ~11.5 min, luego Uber cancela | ~4 min, luego Rappi cancela |

**Alternativa autorizada si una plataforma no da acceso directo:** un agregador con soporte oficial
de las tres en México (Deliverect publica integraciones de DiDi Food, Rappi y Uber Eats para
México). Requiere contrato con el agregador y un adaptador nuevo contra su API de POS; no está
implementado.

## Flujo

1. La plataforma llama a `POST /api/v1/plataformas/webhooks/:plataforma/:slug` (URL que muestra la
   pantalla de Configuración). `main.ts` guarda el **body crudo** solo para estas rutas, porque las
   firmas se calculan sobre esos bytes.
2. El adaptador verifica la firma y normaliza la orden (artículos, opciones, notas, montos, folio
   corto, datos de entrega autorizados — nunca teléfono ni dirección del cliente).
3. Idempotencia: índice único por evento (`PlataformaWebhookEvent`) y por orden
   (`PlataformaOrdenSync`). Un reenvío no duplica nada. Siempre se responde 200 (las plataformas
   reintentan ante cualquier otro código); los rechazos (firma inválida, integración desactivada,
   sin credenciales) quedan como **errores de sincronización** visibles en la bandeja.
4. La terminal revisa la bandeja cada 30 s **en cualquier pantalla** (`useAvisosDelivery`): banner,
   vibración y sonido (configurable por terminal) cuando entra un pedido que no había avisado. Los
   ids avisados se guardan en la base local, así que tras reiniciar la app no vuelve a sonar por los
   mismos. Sin conexión reintenta con backoff 30 s → 1 → 2 → 4 → 5 min.
5. Aceptar (`plataformas/aceptarPedidoPlataforma.ts` → `PlataformasService.aceptarPedido`):
   1. Reclamo atómico de la orden (`reclamadoPor`, caduca a los 2 min): dos terminales no crean
      dos pedidos; la segunda recibe 409.
   2. Confirmación en la plataforma. **No se marca aceptado sin confirmación**: si la API falla →
      502 con mensaje accionable y el pedido sigue pendiente. Si la integración no confirma por API
      (DiDi; Rappi al rechazar; API no configurada) → 409 `CONFIRMACION_MANUAL_REQUERIDA` y el
      cajero declara que ya lo hizo en la tablet (`confirmacion = MANUAL`).
   3. Se crea el Pedido del ERP con el id uuid7 de la terminal (DOMICILIO, canal
      `PLATAFORMA_DELIVERY`, directo a cocina) y la venta local con ese mismo id, pagada con
      `OTRO` (no suma al efectivo del corte). Reintentar es seguro: el ERP es idempotente por id.
6. Estados: `RECIBIDA` (por aceptar), `SINCRONIZADA` (aceptado), `IGNORADA` (rechazado),
   `CANCELADA` (la plataforma la canceló antes de aceptarla). Si cancela **después** de aceptar,
   se conserva `SINCRONIZADA` y la bandeja avisa.

Permisos: configurar exige `ADMIN_CORPORATIVO`/`ADMIN_SUCURSAL`; ver, aceptar y rechazar también
`SUPERVISOR` y `CAJERO`. La empresa siempre sale del token.

## Modo demostración

En una integración en ambiente **Pruebas** (o sin configurar), Configuración → "Crear pedido de
prueba" genera un pedido `SIM-…` rotulado **SIMULACIÓN**. Sirve para practicar todo el flujo
(aviso, revisión, aceptar, venta, ticket). Aceptarlo nunca llama a la plataforma
(`confirmacion = SIMULADA`). En Producción se niega salvo `PLATAFORMAS_SIMULACION_HABILITADA=true`.

## Variables de entorno (backend, sin valores secretos)

| Variable | Uso |
|---|---|
| `PLATAFORMAS_CIFRADO_KEY` | Llave para cifrar credenciales (obligatoria, ≥ 32 caracteres) |
| `PLATAFORMAS_PUBLIC_BASE_URL` | Base pública para armar la URL del webhook, p. ej. `https://<api>/api/v1` |
| `UBER_API_BASE_URL`, `UBER_AUTH_URL` | Opcionales; por defecto los oficiales |
| `RAPPI_API_BASE_URL`, `RAPPI_AUTH_URL` | Opcionales; por defecto según ambiente (México: `services.mxgrability.rappi.com`) |
| `RAPPI_AUTH_AUDIENCE` | Obligatoria para Rappi: el `audience` que indica Rappi con las credenciales |
| `DIDI_API_BASE_URL` | Solo cuando DiDi habilite su API para la cuenta |
| `PLATAFORMAS_SIMULACION_HABILITADA` | `true` permite pedidos de prueba en Producción (no recomendado) |

## Qué debe proporcionar el negocio para activar cada integración

- **Uber Eats:** app en developer.uber.com aprobada por Uber para las Marketplace APIs (scopes
  `eats.order`, `eats.store`), Client ID, Client Secret y el `store_id`; registrar en Uber la URL
  del webhook que muestra el POS.
- **Rappi:** Client ID, Client Secret, secreto del webhook, `store_id` y el `audience` de Auth0, que
  entrega el equipo de integraciones (TAM) de Rappi; pasar su homologación.
- **DiDi Food:** registro de la empresa y certificación en developer.didi-food.com (App ID, llave
  secreta, tienda autorizada) y su documentación de órdenes para completar el adaptador. Mientras
  tanto: recibir en la tablet de DiDi y registrar el pedido desde el POS con confirmación manual.

## Verificación de punta a punta (por plataforma, con tienda de prueba)

1. Configuración → capturar credenciales en **Pruebas** → "Guardar y probar conexión" debe decir
   *Conectada* (token obtenido).
2. Copiar la URL del webhook al panel de la plataforma.
3. Hacer un pedido en la tienda de prueba: debe sonar el aviso y aparecer en "Por aceptar" con sus
   artículos y opciones. Si no aparece, revisar "Ver errores de sincronización".
4. Aceptar: el resultado debe decir que la plataforma confirmó, el pedido debe ir a cocina y la
   tienda de prueba debe mostrarlo aceptado.
5. Repetir con un rechazo y con una cancelación desde la plataforma.
6. Solo entonces cambiar el ambiente a **Producción**.
