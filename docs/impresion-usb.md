# Impresión de tickets por USB OTG (POS APK)

Impresora térmica ESC/POS (probada para 80 mm, modelo POS-8360) conectada a la tablet por cable
USB OTG. Sin librerías externas: módulo nativo local de Expo en Kotlin.

## Piezas

| Archivo | Qué hace |
|---|---|
| `apps/pos-terminal/modules/hangar-usb-printer/android/.../TicketBuilder.kt` | Arma los bytes ESC/POS (texto, columnas, logo raster, QR, CODE128, corte, cajón). |
| `.../TicketRenderer.kt` | Convierte el `TicketPayload` (JSON) en el ticket: logo → negocio → productos → totales → pie → QR → código de barras del folio → corte. |
| `.../UsbPrinterManager.kt` | Busca la impresora, pide el permiso USB y transmite con `bulkTransfer` en `Dispatchers.IO`, serializado con un `Mutex`. |
| `.../ConfigImpresora.kt` | Ajustes por equipo (código de página, logo, corte, cajón, vendorId/productId fijados) en SharedPreferences. |
| `.../HangarUsbPrinterModule.kt` | Puente Expo Modules (`AsyncFunction` / `Coroutine`). |
| `modules/hangar-usb-printer/index.ts` | Contraparte JS (`impresoraUsb`). Devuelve "módulo no disponible" en vez de fallar si el binario no lo trae. |
| `src/printing/usbPrinterAdapter.ts` | Implementa `PrinterAdapter`; es el adaptador por defecto de `imprimirTicket.ts`. |
| `src/screens/PosAdminImpresoraScreen.tsx` | Admin → Impresora: dispositivos USB, permiso, ajustes y ticket de prueba. |

El módulo se enlaza solo (`expo-modules-autolinking` busca en `apps/pos-terminal/modules/`) y su
`AndroidManifest.xml` añade `android.hardware.usb.host` con `required="false"`.

## Flujo

La venta se confirma primero, siempre. Después `imprimirTicket.ts` pregunta si hay impresora
conectada; si la hay, manda el ticket. Si no hay impresora, falta el permiso o la transmisión
falla, el ticket queda `PENDIENTE` y se muestra el recibo en pantalla (reintentable).

## Permisos USB en Android 12+

- `PendingIntent.FLAG_MUTABLE` (el sistema agrega `EXTRA_DEVICE` y `EXTRA_PERMISSION_GRANTED`).
- Intent explícito con `setPackage()` (Android 14 lo exige para PendingIntent mutables).
- `ContextCompat.registerReceiver(..., RECEIVER_NOT_EXPORTED)` (Android 13+).

El permiso dura mientras la impresora siga conectada y la app abierta. Para que Android lo
recuerde ("usar siempre con esta app") falta un `intent-filter` `USB_DEVICE_ATTACHED` con el
vendorId/productId real de la impresora — pendiente de leerlos en Admin → Impresora.

## Puesta en marcha en tienda

1. Conectar la impresora por OTG, abrir Admin → Impresora y tocar **Dar permiso**.
2. Elegir ancho (80 mm) y código de página; imprimir la prueba hasta que "áéíóú ñÑ ¡¿" salga bien
   (16 = WPC1252 suele funcionar; si no, 2 = PC850; último recurso: "Quitar acentos").
3. Si hay varios dispositivos USB, **Usar para tickets** en el correcto.
