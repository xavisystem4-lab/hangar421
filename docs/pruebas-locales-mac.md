# Pruebas locales de la app de Meseros desde una Mac

Guía para probar la comunicación completa **APK → API de la Estación → base de datos → menú**
sin depender de una PC Windows con el POS instalado — útil mientras se desarrolla/prueba desde
una MacBook.

## Por qué emulador Android (no VMware)

Se evaluaron las dos opciones que pedía el análisis inicial:

- **Emulador Android** (Android Studio, ya instalado en esta Mac, con el AVD `Pixel_4_API_34`
  ya configurado) — corre la app de Meseros directamente, con red virtual estándar y bien
  documentada.
- **VMware Fusion + Windows** — necesario únicamente para probar el **instalador `.exe` real**
  del POS Windows (`apps/pos-desktop`), porque ese `.exe` solo corre en Windows. Para probar la
  app de Meseros NO hace falta: el backend (`apps/backend`, NestJS + Postgres) es Node
  multiplataforma y corre igual de bien directo en macOS — meter Windows de por medio ahí no
  aporta nada y sí agrega una capa de red extra que complica el diagnóstico.

**Conclusión: emulador Android para probar la app de Meseros; VMware solo si además se necesita
probar el instalador de Windows del POS.**

## 1. Levantar el backend local en la Mac

Requisitos (ya cumplidos en esta máquina): Postgres corriendo (`brew services list | grep
postgres`) y una base `hangar421_dev` migrada (`apps/backend/prisma/schema.prisma` aplicado) con
al menos una empresa/sucursal/catálogo de prueba — la base de datos de desarrollo de este repo ya
la tiene.

```bash
# desde la raíz del repo
npm run dev:backend
```

Esto arranca NestJS en el puerto de `apps/backend/.env` (`PORT=3000` por defecto) usando la
`DATABASE_URL` de ese mismo archivo. Verificar que responde:

```bash
curl http://localhost:3000/api/v1/health
# {"status":"ok","timestamp":"...","empresa":"HANGAR 421 Coffee Shop"}
```

El campo `empresa` es el que la app de Meseros usa para "reconocer" la Estación en el módulo
Conexión (ver `apps/waiter-mobile/src/screens/ConexionScreen.tsx`).

## 2. IP especial del emulador Android para llegar al host

**El emulador Android NO ve `localhost` de la Mac como su propio `localhost`** — tiene su propia
red virtual aislada. Para que la app (corriendo dentro del emulador) llegue al backend que corre
en la Mac (el host), Android define una IP fija y especial:

```
10.0.2.2
```

Esa dirección, dentro del emulador, siempre apunta al `localhost` de la máquina que lo hospeda.
Así que en el módulo **Conexión** de la app, durante pruebas con emulador, se captura:

```
IP del servidor: 10.0.2.2
Puerto: 3000
```

(`10.0.2.2` es una convención del propio emulador de Android — no es una IP de tu red Wi-Fi ni
hay que configurarla en ningún lado más; funciona así siempre que se use el emulador estándar de
Android Studio/AOSP.)

## 3. Dispositivo físico (tablet/celular real) en la misma red

Si en vez de emulador se prueba con un dispositivo físico conectado al mismo Wi-Fi que la Mac, ya
NO aplica `10.0.2.2` — hay que usar la IP real de la Mac en esa red:

```bash
ipconfig getifaddr en0
# ej. 192.168.1.32
```

Y capturar esa IP (`192.168.1.32` en este ejemplo) + el mismo puerto `3000` en el módulo
Conexión.

## 4. Arrancar el emulador y correr la app

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"

emulator -avd Pixel_4_API_34 &     # arranca el emulador (tarda ~1-2 min la primera vez)
adb wait-for-device                # espera a que esté listo

cd apps/waiter-mobile
npm run android                    # expo run:android — compila e instala la app en el emulador
```

Al abrir la app por primera vez (sin ninguna Estación guardada) va directo al módulo Conexión —
ahí se captura `10.0.2.2` / `3000`, se toca **Probar conexión** (debe mostrar "✓ Conexión
exitosa — HANGAR 421 Coffee Shop") y luego **Guardar**.

## 5. Entorno de pruebas vs. producción

La IP y el puerto **nunca están escritos en el código** — viven únicamente en lo que se captura
en el módulo Conexión, persistido en el dispositivo (`AsyncStorage`, ver
`apps/waiter-mobile/src/store/conexionStore.ts`). Cambiar de un entorno a otro es solo cuestión de
qué se escribe ahí:

| Entorno | IP a capturar | Puerto |
|---|---|---|
| Emulador Android + backend en la Mac | `10.0.2.2` | `3000` |
| Dispositivo físico + backend en la Mac (misma red) | IP LAN de la Mac (`ipconfig getifaddr en0`) | `3000` |
| Producción (tablet + PC con el POS instalado) | IP LAN de esa PC (ver POS → Administración → "Conexión Meseros") | el que muestre esa pantalla (3000 por defecto) |

`apps/waiter-mobile/app.json` (`extra.apiUrl`) solo define un valor que a propósito nunca
responde (`localhost:3000`, ver comentario en `conexionStore.ts`) — el propósito es forzar que
CADA instalación pase por el módulo Conexión al menos una vez, en vez de asumir un entorno fijo.
