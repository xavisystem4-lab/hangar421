package expo.modules.hangarusbprinter

import android.content.Context
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
