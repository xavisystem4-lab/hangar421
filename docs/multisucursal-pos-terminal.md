# Multisucursal en el POS Android (pos-terminal) — análisis y propuesta

> Estado: **pasos 0 y 2 implementados** (ver §7); el resto sigue siendo propuesta. Documenta el
> análisis de la arquitectura actual y el plan recomendado. Complementa `architecture.md` (visión
> general) y `sync-flows.md` (sincronización).

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
| `SucursalAccessGuard` | `common/guards/sucursal-access.guard.ts` | ⚠️ Escrito, pero **sin conectar** — ver §4.3 |
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

### 4.1 🔴 `empresaId` no se valida contra el token — fuga entre empresas

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

### 4.2 🔴 La base local del APK asume UNA sola sucursal

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

### 4.3 🔴 `SucursalAccessGuard` no está conectado a nada

El guard que debía impedir operar sobre otra sucursal **existe pero no se usa**: no aparece en los
`APP_GUARD` de `app.module.ts` ni en ningún `@UseGuards()` del proyecto. Es código muerto. Hoy,
por tanto, no hay aislamiento por sucursal a nivel de API.

No se conecta en el paso 0 a propósito: el guard compara contra `user.sucursalId`, y el flujo
actual de `ConexionErpScreen` permite iniciar sesión **sin** sucursal resuelta (cuenta con varias)
y luego llamar a `/catalogo/productos?sucursalId=…` con ese token. Activarlo hoy rompería ese
camino sin darle recambio. Su sitio natural es el paso 1, junto a `cambiar-sucursal`, que es lo
que garantiza que todo token en circulación tenga una sucursal activa válida.

### 4.4 🟠 No existe forma de cambiar de sucursal de forma segura

`SucursalAccessGuard` lee `user.sucursalId` **del token**. Cambiar de sucursal por tanto no es un
cambio de estado en el cliente: exige un token nuevo. No hay endpoint para eso; hoy la única vía
es cerrar sesión y volver a entrar.

### 4.5 🟠 El APK guarda una sola sucursal y se pide escribiendo un UUID a mano

`dispositivoLocal.ts` guarda una única clave `sucursal_id_erp` en `config_local`. Y cuando la
cuenta tiene varias sucursales, `ConexionErpScreen.tsx` pide **teclear el ID de la sucursal** —
un UUID, a mano, en un teclado de celular. Es el sitio donde va el selector.

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
| 1 | `mis-sucursales` + `cambiar-sucursal`, y conectar `SucursalAccessGuard` (§4.3) | Base de todo lo demás |
| 2 | ✅ **Hecho** — Migración `sucursal_id` en el APK | Antes de que existan datos de dos sucursales que ya no se puedan separar |
| 3 | Selector de sucursal + indicador en cabecera | El requisito visible |
| 4 | Acotar repos y sync | Cierra la separación de datos |
| 5 | Reportes consolidados | Ya con datos correctamente separados |
| 6 | Módulo de compras y pantallas faltantes | Desarrollo nuevo, sin bloquear lo anterior |

Los pasos 0–4 son los que hacen que "los datos no se mezclen" sea cierto. El 5 y el 6 son
funcionalidad encima de esa base.

## 8. Compatibilidad

Nada de lo anterior rompe lo existente si se respeta el orden:

- Un dispositivo ya enlazado conserva su sucursal: la migración rellena `sucursal_id` con la que
  ya tiene guardada.
- El POS de Windows no se toca; sigue con su backend embebido o en la nube, como esté hoy.
- Las ventas offline siguen sin depender de la red.
- Las migraciones SQLite se añaden al final de la lista, nunca se editan las publicadas.
