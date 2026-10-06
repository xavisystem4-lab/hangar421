package expo.modules.hangarusbprinter

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.media.RingtoneManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

/**
 * Puente JavaScript ↔ Kotlin (Expo Modules). La contraparte en TS es
 * modules/hangar-usb-printer/index.ts. Todo lo que cruza va como JSON en texto: evita sorpresas
 * del convertidor de tipos con números (Int vs Double) y listas anidadas.
 *
 * Las funciones `Coroutine` corren en el scope de módulos de Expo (fuera del hilo de UI) y el
 * I/O USB además salta a Dispatchers.IO dentro de UsbPrinterManager.
 */
class HangarUsbPrinterModule : Module() {
    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "Sin contexto de Android" }.applicationContext

    private var manager: UsbPrinterManager? = null
    private fun impresora(): UsbPrinterManager = manager ?: UsbPrinterManager(context).also { manager = it }

    private fun prefs() = context.getSharedPreferences(ConfigImpresora.PREFS, Context.MODE_PRIVATE)
    private fun config() = ConfigImpresora.leer(prefs())

    override fun definition() = ModuleDefinition {
        Name("HangarUsbPrinter")

        // Sonido de aviso (pedido de delivery nuevo): el tono de notificación del sistema. Vive
        // aquí para no sumar otra dependencia nativa solo por un sonido; no toca la impresora.
        Function("sonarAviso") {
            try {
                val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                RingtoneManager.getRingtone(context, uri)?.play()
                true
            } catch (e: Exception) {
                false
            }
        }

        // Instalador de actualizaciones: abre el instalador de Android con el .apk ya descargado
        // (content:// de expo-file-system). Si Android 8+ todavía no permite que esta app instale
        // apps, abre el ajuste para permitirlo y devuelve "permiso"; al volver se reintenta.
        Function("abrirInstalador") { contentUri: String ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
                val ajustes = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(ajustes)
                "permiso"
            } else {
                val instalar = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(Uri.parse(contentUri), "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(instalar)
                "ok"
            }
        }

        AsyncFunction("isAvailable") {
            impresora().buscarImpresora(config()) != null
        }

        AsyncFunction("listarDispositivos") {
            impresora().listarDispositivos(config()).toString()
        }

        AsyncFunction("solicitarPermiso") Coroutine { vendorId: Int, productId: Int ->
            val d = impresora().buscarPorId(vendorId, productId)
                ?: throw CodedException("ERR_IMPRESORA", "Ese dispositivo ya no está conectado.", null)
            impresora().solicitarPermiso(d)
        }

        AsyncFunction("obtenerConfig") {
            config().aJson().toString()
        }

        AsyncFunction("guardarConfig") { json: String ->
            ConfigImpresora.desdeJson(JSONObject(json)).guardar(prefs())
        }

        AsyncFunction("imprimirTicket") Coroutine { json: String, anchoMM: Int ->
            envolver {
                val cfg = config()
                impresora().imprimir(TicketRenderer(context, cfg, anchoMM).ticketVenta(JSONObject(json)), cfg)
            }
            true
        }

        AsyncFunction("imprimirPrueba") Coroutine { anchoMM: Int ->
            envolver {
                val cfg = config()
                impresora().imprimir(TicketRenderer(context, cfg, anchoMM).paginaPrueba(), cfg)
            }
            true
        }
    }

    /** Cualquier falla llega a JS como promesa rechazada con código ERR_IMPRESORA y un mensaje legible. */
    private suspend fun envolver(bloque: suspend () -> Unit) {
        try {
            bloque()
        } catch (e: CancellationException) {
            throw e
        } catch (e: CodedException) {
            throw e
        } catch (e: Exception) {
            throw CodedException("ERR_IMPRESORA", e.message ?: e.javaClass.simpleName, e)
        }
    }
}
