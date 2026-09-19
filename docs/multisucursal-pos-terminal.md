# Multisucursal en el POS Android (pos-terminal) — análisis y propuesta

> Estado: **pasos 0 a 4 implementados** (ver §7); quedan el 5 (reportes consolidados) y el 6
> (módulo de compras y pantallas faltantes). Documenta el análisis de la arquitectura actual y el
> plan seguido. Complementa `architecture.md` (visión general) y `sync-flows.md` (sincronización).

## 1. Resumen

El objetivo pedido es: que el APK pueda **elegir sucursal**, que cada sucursal conserve sus datos
separados, y que un administrador autorizado pueda consultar cualquiera de ellas y obtener
reportes consolidados.

La conclusión del análisis es que **el modelo de datos ya es multisucursal**: la jerarquía
empresa→sucursal, los permisos por sucursal (`UsuarioSucursal`) y el precio por sucursal
(`ProductoSucursal`) están completos. Lo que falta es su aplicación — los guards que debían
hacerlos cumplir no estaban conectados (§4.1, §4.3) — y todo el lado del APK.

La recomendación central es **no crear una base de datos por sucursal**. El aislamiento debe
seguir siendo lógico (`sucursalId` + guards), que es lo que el sistema ya hace. El detalle está en
§3.

## 2. Lo que ya existe — no hay que construirlo

| Pieza | Dónde | Qué resuelve del encargo |
|---|---|---|
| `GET /sucursales?empresaId=` | `sucursales.controller.ts` | El endpoint que alimenta el selector de sucursal |
| `UsuarioSucursal(usuarioId, sucursalId, rol, perfilId, permisosJson)` | `schema.prisma:359` | Rol y permisos **por sucursal**, no globales |
| `JwtPayload.sucursalId` | `packages/shared/src/types/auth.ts:40` | La "sucursal activa" ya es un concepto del token |
| `SucursalAccessGuard` | `common/guards/sucursal-access.guard.ts` | Bloquea operar sobre otra sucursal; exime a `ADMIN_CORPORATIVO`. Estaba escrito pero **sin conectar** — ver §4.3 |
| `POST /auth/switch-sucursal` | `auth.controller.ts` | Cambio de sucursal activa, revalidando contra `UsuarioSucursal` — ver §4.4 |
| `ProductoSucursal` | `schema.prisma` | Catálogo central con precio y disponibilidad por sucursal |
| `GET /reportes/dashboard?empresaId=&sucursalId?=` | `reportes.controller.ts:13` | `sucursalId` es opcional → el consolidado por empresa **ya funciona** |
| Módulos de dominio | `apps/backend/src/` | `catalogo`, `inventario`, `caja`, `pedidos`, `clientes`, `proveedores`, `reportes`, `usuarios`, `perfiles`, `traspasos` |

De la lista de áreas pedidas (ventas, inventario, productos/precios, compras y proveedores,
clientes, caja, reportes, usuarios y permisos), **la única que no tiene módulo es Compras**:
existe el modelo `Proveedor` (`schema.prisma:1047`) pero no hay órdenes de compra, recepciones ni
cuentas por pagar. Eso es desarrollo nuevo, no una adaptación.

## 3. La decisión clave: ¿una base por sucursal?

El encargo dice "conectarse a la base de datos asignada a esa sucursal". **Recomiendo no hacerlo**
y mantener una sola base con aislamiento por `sucursalId`.

**Por qué una base por sucursal sale cara aquí:**

- **Rompe justo lo que pides al final.** Los reportes consolidados pasarían de un `GROUP BY` a
  consultar N bases y unir en memoria, sin transacciones ni consistencia entre ellas.
- **Rompe el catálogo central.** Hoy el producto es de la empresa y solo el precio/disponibilidad
  es por sucursal (`ProductoSucursal`). Con N bases habría N copias del mismo café y editarlo
  centralmente dejaría de existir.
- **Rompe los traspasos entre sucursales**, ya modelados: necesitan origen y destino en la misma
  transacción.
- **No mejora la seguridad.** El aislamiento real lo da el guard + el filtro por `sucursalId`. Un
  token con sucursal A no lee B en ninguno de los dos diseños.
- **Multiplica la operación por N**: migraciones, respaldos, pools de conexión y coste de Railway
  por cada sucursal nueva.
- **Prisma necesitaría cambiar de datasource por petición**, un cambio transversal y propenso a
  fallos silenciosos (una consulta que se va a la base equivocada no da error, da datos de otro).

**Cuándo sí valdría la pena** (y queda anotado para Fase 3 del roadmap): entidades legales
distintas con requisitos de residencia de datos, o vender el sistema a terceros que exijan
aislamiento físico. No es el caso de dos sucursales de la misma empresa.

**Lo que sí hay que reforzar del aislamiento lógico:** ver §4.1, que es una fuga real y abierta.

## 4. Huecos reales

### 4.1 🔴 ~~`empresaId` no se valida contra el token~~ — resuelto (paso 0)

`GET /sucursales?empresaId=` y el resto de endpoints toman `empresaId` **del query string** y lo
usan tal cual (`sucursales.service.ts:9`). Ningún guard lo compara con el `empresaId` del JWT:
`JwtAuthGuard` solo valida la firma, `RolesGuard` solo mira el rol y `SucursalAccessGuard` solo
mira `sucursalId`. El único sitio que usa `user.empresaId` es el módulo `plataformas`.

Efecto: cualquier usuario autenticado que cambie el `empresaId` de la URL lee datos de otra
empresa — catálogo, sucursales, reportes.

Además `SucursalAccessGuard` devuelve `true` cuando la petición no trae `sucursalId` ("el endpoint
no está scoped por sucursal"), así que los endpoints que solo filtran por empresa no pasan por
ninguna comprobación.

Hoy el impacto está contenido porque hay una sola empresa. **Añadir una segunda sucursal en la
nube y un selector es exactamente el momento en que deja de estarlo**, así que esto debería ir
primero, antes que la funcionalidad.

Arreglo: un guard (o un decorador `@EmpresaScope()`) que tome `empresaId` del token y rechace —
o simplemente ignore — el del query. `ADMIN_CORPORATIVO` sigue pudiendo ver todas las sucursales
*de su empresa*, no de otras.

### 4.2 🔴 ~~La base local del APK asume UNA sola sucursal~~ — resuelto (paso 2)

Este es el hueco más grande del lado del cliente. De las 15 tablas locales
(`pos-terminal/src/db/migrations.ts`), **solo `sync_outbox` lleva `sucursal_id`**. `ventas`,
`venta_items`, `pagos`, `turnos`, `movimientos_caja` y `usuarios_locales` no lo tienen.

Consecuencias si hoy se cambiara de sucursal sin tocar el esquema:

- Las ventas de ambas sucursales quedarían mezcladas en la misma tabla, sin forma de separarlas
  después.
- `ventas.folio_local` es un consecutivo único por dispositivo: dos sucursales compartirían
  numeración, lo cual además de confuso es un problema fiscal.
- Los cortes de caja y turnos sumarían las dos sucursales.
- Los usuarios locales (PIN offline) de una sucursal podrían abrir caja en la otra.

### 4.3 🔴 ~~`SucursalAccessGuard` no está conectado a nada~~ — resuelto (paso 1)

El guard que debía impedir operar sobre otra sucursal **existía pero no se usaba**: no aparecía en
los `APP_GUARD` de `app.module.ts` ni en ningún `@UseGuards()`. Era código muerto, así que no
había aislamiento por sucursal a nivel de API.

No se conectó en el paso 0 a propósito: compara contra `user.sucursalId`, y mientras el login
pudiera dejar sesiones sin sucursal resuelta, activarlo habría roto el enlace del APK sin
recambio. Se conectó en el paso 1, una vez garantizado que **todo access token en circulación
tiene una sucursal activa válida**.

Una exención explícita, `@SucursalLibre()`, marca los endpoints que nombran por definición otra
sucursal. Hoy solo `POST /auth/switch-sucursal`, que sin ella se bloquearía a sí mismo.

### 4.4 🔴 La pantalla de elegir sucursal del APK era inalcanzable — resuelto (pasos 1 y 3)

`POST /auth/switch-sucursal` ya existía y validaba correctamente contra `UsuarioSucursal`. El
problema estaba en cómo se llegaba a él:

- `resolverSucursalActiva` lanzaba **400** si la cuenta tenía varias sucursales y no se indicaba
  cuál. Como en ese punto no se emite ningún token, el cliente no tenía forma de consultar la
  lista: el selector era inalcanzable para toda cuenta no corporativa.
- A un `ADMIN_CORPORATIVO` le asignaba **la primera sucursal en silencio**, sin preguntar. La
  terminal quedaba ligada a una sucursal arbitraria.

Arreglo: el 400 pasa a llevar la lista de sucursales (`codigo: "SUCURSAL_REQUERIDA"`), y los
accesos incluyen el **nombre** de cada sucursal. Se prefirió esto a emitir un token sin sucursal
activa, porque mantener ese invariante es lo que hace seguro aplicar `SucursalAccessGuard`
globalmente.

### 4.5 🟠 ~~El APK guarda una sola sucursal y se pide escribiendo un UUID a mano~~ — resuelto (paso 3)

`ConexionErpScreen.tsx` pedía **teclear el UUID de la sucursal** a mano, en un teclado de celular.
Ahora muestra un selector con los nombres y el rol en cada una, y `PosNavigator` lleva el
indicador de sucursal activa en la cabecera, que se toca para cambiarla.

### 4.6 🟡 El APK no tiene pantallas para la mitad de las áreas pedidas

`PosNavigator.tsx` ofrece Venta, Caja y Admin (Catálogo, Reportes, Usuarios). No hay inventario,
clientes, compras/proveedores ni movimientos financieros más allá del corte de caja.

## 5. Diseño propuesto

### 5.1 Flujo de sucursal activa

```
Login (email+contraseña)  ──▶  token sin sucursal + lista de sucursales permitidas
                                (de UsuarioSucursal, no de un query libre)
          │
          ▼
  Selector de sucursal  ──▶  POST /auth/cambiar-sucursal { sucursalId }
                                • valida que exista UsuarioSucursal(usuario, sucursal, activo)
                                • emite token NUEVO con sucursalId y el rol DE ESA sucursal
          │
          ▼
  Todas las llamadas van con ese token ──▶ SucursalAccessGuard ya las acota
```

Esto cumple los requisitos sin excepciones: la APK nunca ve credenciales de base de datos (habla
solo con la API), los permisos se respetan porque el rol se toma de `UsuarioSucursal` de esa
sucursal concreta, y el servidor decide — el cliente no puede "declarar" en qué sucursal está.

### 5.2 Separación de datos en el APK

Una sola base SQLite con `sucursal_id` en cada tabla operativa, no un archivo por sucursal: el
archivo por sucursal obligaría a cerrar y reabrir la base al cambiar, y `abrirBaseDeDatos()`
cachea la promesa a propósito para evitar carreras.

- `sucursal_id TEXT NOT NULL DEFAULT ''` en `ventas`, `turnos`, `movimientos_caja`,
  `usuarios_locales` (el `DEFAULT ''` deja las filas existentes intactas y la migración las
  rellena con la sucursal actual del dispositivo).
- `folio_local` pasa a ser consecutivo **por sucursal**: `UNIQUE(sucursal_id, folio_local)`.
- Todas las consultas de `ventasRepo`, `turnosRepo`, `reportesRepo` y `usuariosLocalesRepo` se
  acotan a la sucursal activa.
- El catálogo ya queda resuelto con el `origen` que se acaba de introducir; faltaría acotar
  también por sucursal si se quiere cachear dos catálogos a la vez.

### 5.3 Errores sin conexión

El principio que ya sigue la app (`erpHttp.ts`: un fallo de red nunca debe llegar a una pantalla
de venta) se mantiene:

- Con la sucursal ya elegida, **vender sigue siendo 100% offline** — nada del cambio toca ese
  camino.
- **Cambiar de sucursal sí exige conexión**, porque exige un token nuevo. Debe decirlo con esas
  palabras en vez de fallar en silencio.
- Si el token de la sucursal activa caduca sin red, se sigue operando offline y la cola de sync
  acumula, como hoy.
- El selector debe distinguir "no hay red" de "no tienes acceso a esa sucursal" — son dos
  mensajes distintos y el usuario actúa distinto ante cada uno.

## 6. Qué habría que tocar

### Backend (`apps/backend/`)

| Archivo | Cambio |
|---|---|
| `common/guards/empresa-scope.guard.ts` | **Nuevo** — `empresaId` del token, no del query (§4.1) |
| `common/guards/sucursal-access.guard.ts` | Dejar de aprobar por defecto lo que no trae `sucursalId` |
| `auth/auth.controller.ts` · `auth.service.ts` | **Nuevo** `POST /auth/cambiar-sucursal`; `GET /auth/mis-sucursales` desde `UsuarioSucursal` |
| `reportes/` | Consolidado explícito por empresa (hoy implícito con `sucursalId` ausente) |
| `compras/` | **Módulo nuevo** — órdenes, recepciones, cuentas por pagar |
| `prisma/schema.prisma` | Modelos de compras; el resto **no cambia** |

### APK (`apps/pos-terminal/`)

| Archivo | Cambio |
|---|---|
| `src/db/migrations.ts` | Migración 3: `sucursal_id` + `UNIQUE(sucursal_id, folio_local)` |
| `src/db/dispositivoLocal.ts` | De una sucursal a sucursal activa + lista de permitidas |
| `src/db/ventasRepo.ts` · `turnosRepo.ts` · `reportesRepo.ts` · `usuariosLocalesRepo.ts` | Acotar toda consulta a la sucursal activa |
| `src/screens/SelectorSucursalScreen.tsx` | **Nuevo** — selector real, no un UUID a mano |
| `src/screens/ConexionErpScreen.tsx` | Sustituir el campo de UUID por el selector |
| `src/screens/PosNavigator.tsx` | Sucursal activa visible y conmutable en la cabecera |
| `src/api/erpHttp.ts` | Reemitir token al cambiar de sucursal |
| `src/sync/syncEngine.ts` · `pullEngine.ts` | Outbox y pull acotados a la sucursal activa |
| Pantallas nuevas | Inventario, clientes, compras/proveedores (§4.6) |

### CRM (`apps/crm-web/`)

Ya es el panel corporativo; necesitaría el consolidado y el comparativo entre sucursales, que es
donde ese trabajo rinde más que replicado en el APK.

## 7. Orden recomendado

| # | Entrega | Por qué en este punto |
|---|---|---|
| 0 | ✅ **Hecho** — Cerrar la fuga de `empresaId` (§4.1) | Es una vulnerabilidad abierta y la segunda sucursal la activa |
| 1 | ✅ **Hecho** — `SucursalAccessGuard` conectado + login que devuelve las sucursales (§4.3, §4.4) | Base de todo lo demás |
| 2 | ✅ **Hecho** — Migración `sucursal_id` en el APK | Antes de que existan datos de dos sucursales que ya no se puedan separar |
| 3 | ✅ **Hecho** — Selector de sucursal + indicador en cabecera | Va con el paso 1: al conectar el guard, el campo de UUID a mano dejaba de funcionar y sin selector no había recambio |
| 4 | ✅ **Hecho** (con el paso 2) — Acotar repos y sync | Cierra la separación de datos |
| 5 | Reportes consolidados | Ya con datos correctamente separados |
| 6 | Módulo de compras y pantallas faltantes | Desarrollo nuevo, sin bloquear lo anterior |

Con los pasos 0–4 hechos, "los datos no se mezclan" ya es cierto. El 5 y el 6 son
funcionalidad encima de esa base.

## 8. Compatibilidad

Nada de lo anterior rompe lo existente si se respeta el orden:

- Un dispositivo ya enlazado conserva su sucursal: la migración rellena `sucursal_id` con la que
  ya tiene guardada.
- El POS de Windows no se toca; sigue con su backend embebido o en la nube, como esté hoy.
- Las ventas offline siguen sin depender de la red.
- Las migraciones SQLite se añaden al final de la lista, nunca se editan las publicadas.
