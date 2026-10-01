# Plataformas de delivery en el POS APK

Admin → **Delivery** en `apps/pos-terminal` es el equivalente de Administración → Plataformas del
POS de Windows: DiDi Food, Uber Eats y Rappi contra los endpoints `/plataformas/*` del ERP en la
nube. Requiere conexión al ERP y usuario administrador (`ADMIN_SUCURSAL` / `ADMIN_CORPORATIVO`).

## Configuración

Credenciales por plataforma (se cifran en el servidor y nunca se vuelven a mostrar), URL de
webhook para pegar en el panel de la plataforma, probar conexión, desconectar/reconectar y
regenerar el webhook.

## Pedidos: aceptar = cocina + venta, sin duplicar

La bandeja muestra los pedidos `RECIBIDA` y se refresca cada 30 s. Al aceptar, el cajero elige el
producto del menú para cada artículo (con sugerencia por nombre) y
`plataformas/aceptarPedidoPlataforma.ts`:

1. Exige turno de caja abierto.
2. Genera el id de la venta (uuid7) y llama a `POST /plataformas/pedidos/:id/aceptar` con
   `pedidoId`, `turnoId`, `meseroId` y `dispositivoId`. El ERP crea el Pedido (DOMICILIO, canal
   `PLATAFORMA_DELIVERY`) **con ese id** y lo manda a cocina.
3. Registra la venta local con ese mismo id, los precios/totales que devolvió el ERP, pagada con
   `MetodoPago.OTRO` y referencia `"<Plataforma> #<orden>"` (no suma al efectivo del corte).
4. Imprime el ticket (la línea de pago muestra la plataforma).

Cuando la venta sube por `/sync/push`, `PedidosService.crear` encuentra el id existente (es
idempotente) y solo se aplica el `PAGO`: el pedido no se cuenta dos veces. Reintentar tras un corte
de red es seguro: el ERP devuelve el pedido ya aceptado y la terminal no registra otra venta.

Sin `pedidoId` (POS Windows, CRM) el comportamiento del backend es el de siempre.
