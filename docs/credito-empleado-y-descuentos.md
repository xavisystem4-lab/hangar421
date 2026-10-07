# Descuentos y crédito de empleado (APK POS · "Cobrar cuenta")

## Descuento

Botón **🏷 Descuento** en el cobro. Pregunta si es:

- **General**: a toda la cuenta.
- **Por producto**: a una o varias líneas del carrito.

En ambos casos se elige **porcentaje** o **monto fijo**. No pide PIN. Reglas (en
`packages/shared/src/calculos.ts → calcularDescuentosVenta`, las mismas en la tablet y en el ERP):

- Un monto fijo por producto se toma de la línea completa (precio + extras × cantidad), no por pieza.
- Ningún descuento excede lo que vale su línea / la cuenta.
- El general se calcula **después** de los descuentos por producto.
- No se combina con la cortesía (que sí exige PIN de supervisor).

El ERP recalcula con sus precios y guarda una fila en `descuentos` por línea y una general.

## Crédito de empleado (monedero)

Botón **👛 Crédito empleado**: buscador por nombre + filtro por sucursal; muestra el saldo.

- Tope **$500** por empleada, el mismo monedero en **todas las sucursales**.
- **Un solo monedero activo por nombre** (primer nombre, sin acentos). Cada empleada tiene un usuario por sucursal; la migración `20261007190000_monedero_unico_por_nombre` deja el de su sucursal (o el usuario más antiguo), apaga los demás y les pasa sus consumos. El servidor además manda a las tablets uno por nombre y rechaza activar un segundo (`PUT /monedero/:usuarioId`).
- Se **reinicia sin acumular** a un día y hora fijos: Diana, Andrea y Daniela → viernes 9:00 PM;
  Dalia → sábado 5:00 PM.
- Si la cuenta supera el saldo, se usa todo el monedero y **el resto se cobra con otro método**
  (pago mixto). El monedero no entra al cajón ni al efectivo del corte.
- Cancelar la venta devuelve el saldo.
- El saldo no se guarda: es `tope − consumos desde el último reinicio`
  (`packages/shared/src/monedero.ts`). Cada consumo usa el id de la venta, así que el que se hace
  en la tablet y el que luego sube al ERP son el mismo registro. Sin red, cada tablet descuenta
  con lo que conoce; los consumos de otras tablets llegan al sincronizar (cada 15 min y al abrir
  el buscador).

### Alta y cambios (API, solo ADMIN)

- `GET /api/v1/monedero` — lista de monederos.
- `PUT /api/v1/monedero/:usuarioId` — `{ diaReinicio: 0-6 (0=domingo), horaReinicio: 0-23, minutoReinicio?, limite? (500), activo?, sucursalId? }`.

La migración `20261007160000_credito_empleado_monedero` da de alta a Diana, Andrea, Daniela y Dalia
buscando a los usuarios **activos por primer nombre** y su sucursal por nombre (Mecánicos / Benito
Juárez). Si alguna no coincide, se da de alta con el `PUT` de arriba.

## Modificadores desde el alta de producto (APK POS)

En Admin → Catálogo → *Nuevo producto* → **⚙ Modificadores** se pueden elegir los grupos que ya
existen (Tamaño, Tipo de leche, Extras, Jarabe…) **y crear uno nuevo** con **➕ Crear modificador
nuevo**: nombre, *elegir una / varias*, obligatorio y sus opciones con precio extra. El grupo nuevo
queda marcado en el producto en ese momento.

- El grupo se guarda en la tablet con `origen = 'TERMINAL'` (no `'LOCAL'`, que es el catálogo
  sembrado y se retira al bajar el del ERP) y se encola como `SyncEntidad.MODIFICADOR` / CREATE
  **antes** que el producto que lo usa. Grupo y opciones conservan sus ids al llegar al ERP.
- Reglas (`caja/nuevoModificador.ts`): nombre obligatorio y no repetido, al menos una opción,
  opciones sin repetir, precio extra ≥ 0 (vacío = $0).
- Backend: `CatalogoService.crearModificadorDesdeTerminal` (idempotente por id; la empresa sale
  del token).

## Editar un producto por completo (APK POS)

Admin → Catálogo → **Editar** en un producto abre la edición completa: nombre, precio, **categoría** y
**modificadores**. En ⚙ Modificadores se eligen los grupos del producto y, con **✎ Editar** en cada
grupo, se cambian sus opciones: agregar, quitar (✕) y cambiar el precio extra. Un cambio en un grupo
aplica a **todos los productos que lo usan**.

- Nombre/categoría: `SyncEntidad.PRODUCTO` / UPDATE (la lista de modificadores solo se toca si llega).
  Precio: `PRODUCTO_SUCURSAL`, como antes.
- Grupo: `SyncEntidad.MODIFICADOR` / UPDATE con la lista **completa** de opciones. Una opción quitada
  se borra si nunca se vendió; si ya se vendió se apaga (`opciones_modificador.activo = false`) para
  no romper el historial. El pull del catálogo no pisa un grupo con cambios aún sin subir.

## Precios de DiDi en los extras

Los productos DiDi comparten los grupos de modificadores con el mostrador, así que la migración
`20261007210000_didi_precios_modificadores` crea copias **"Tipo de leche (DiDi)"**, **"Jarabe (DiDi)"**
y **"Cold Foam (DiDi)"** y cambia el vínculo solo de los productos de la categoría DIDI:

| Opción | Precio DiDi |
|---|---|
| Leche de almendra | $28 |
| Leche de avena | $30 |
| Jarabes (los que cuestan extra) | $21 |
| Cold foam (los que cuestan extra) | $32 |

Las demás opciones conservan su precio y Tamaño/Extras no cambian. Los modificadores son de la
empresa, así que aplica en **todas las sucursales**. Para cambiar un precio después, se edita el grupo
"(DiDi)" desde el APK.
