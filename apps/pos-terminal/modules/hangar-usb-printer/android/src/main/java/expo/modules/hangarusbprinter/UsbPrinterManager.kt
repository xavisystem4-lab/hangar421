package expo.modules.hangarusbprinter

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

class ImpresoraException(mensaje: String, causa: Throwable? = null) : Exception(mensaje, causa)

/**
 * Transporte USB OTG hacia la impresora térmica: encontrarla, pedir permiso y mandarle bytes.
 *
 * - Todo el I/O corre en Dispatchers.IO; ningún método bloquea el hilo de UI.
 * - Un Mutex serializa los trabajos: dos cobros seguidos no intercalan sus bytes.
 * - La conexión se abre y se cierra en cada trabajo, así que desconectar el cable a media
 *   jornada no deja un handle muerto: el siguiente ticket vuelve a buscarla desde cero.
 */
class UsbPrinterManager(private val context: Context) {
    private val usb = context.getSystemService(Context.USB_SERVICE) as UsbManager
    private val mutex = Mutex()

    fun buscarImpresora(cfg: ConfigImpresora): UsbDevice? {
        val dispositivos = usb.deviceList.values
        if (cfg.vendorId != null && cfg.productId != null) {
            dispositivos.firstOrNull { it.vendorId == cfg.vendorId && it.productId == cfg.productId }
                ?.let { return it }
        }
        return dispositivos.firstOrNull { esClaseImpresora(it) && endpointSalida(it) != null }
            ?: dispositivos.firstOrNull { endpointSalida(it) != null }
    }

    fun buscarPorId(vendorId: Int, productId: Int): UsbDevice? =
        usb.deviceList.values.firstOrNull { it.vendorId == vendorId && it.productId == productId }

    /** Para la pantalla de diagnóstico: todo lo conectado por USB, sea o no una impresora. */
    fun listarDispositivos(cfg: ConfigImpresora): JSONArray {
        val elegida = buscarImpresora(cfg)
        val arr = JSONArray()
        for (d in usb.deviceList.values) {
            val permiso = usb.hasPermission(d)
            val clases = JSONArray()
            for (i in 0 until d.interfaceCount) clases.put(d.getInterface(i).interfaceClass)
            arr.put(JSONObject().apply {
                put("nombreSistema", d.deviceName)
                put("vendorId", d.vendorId)
                put("productId", d.productId)
                // Desde Android 10 leer estos textos sin permiso lanza SecurityException.
                put("fabricante", if (permiso) runCatching { d.manufacturerName }.getOrNull() ?: JSONObject.NULL else JSONObject.NULL)
                put("producto", if (permiso) runCatching { d.productName }.getOrNull() ?: JSONObject.NULL else JSONObject.NULL)
                put("clasesInterfaz", clases)
                put("esClaseImpresora", esClaseImpresora(d))
                put("tieneSalidaBulk", endpointSalida(d, cualquierClase = true) != null)
                put("tienePermiso", permiso)
                put("seleccionada", elegida?.deviceName == d.deviceName)
            })
        }
        return arr
    }

    /**
     * Pide permiso al usuario (diálogo del sistema) y suspende hasta que conteste.
     *
     * Android 12+: el PendingIntent debe ser FLAG_MUTABLE — el sistema le agrega EXTRA_DEVICE y
     * EXTRA_PERMISSION_GRANTED; con FLAG_IMMUTABLE llegan vacíos y parece que siempre se negó.
     * Android 14+: un PendingIntent mutable exige intent EXPLÍCITO, de ahí el setPackage().
     * Android 13+: registrar un receptor exige declarar si se exporta; RECEIVER_NOT_EXPORTED
     * basta porque el broadcast lo envía el propio PendingIntent de esta app.
     */
    suspend fun solicitarPermiso(device: UsbDevice, timeoutMs: Long = 30_000): Boolean {
        if (usb.hasPermission(device)) return true
        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine { cont ->
                val terminado = AtomicBoolean(false)
                val receptor = object : BroadcastReceiver() {
                    override fun onReceive(c: Context, intent: Intent) {
                        if (intent.action != ACTION_USB_PERMISSION) return
                        val d = IntentCompat.getParcelableExtra(intent, UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                        if (d != null && d.deviceName != device.deviceName) return
                        if (!terminado.compareAndSet(false, true)) return
                        runCatching { context.unregisterReceiver(this) }
                        val concedido = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) ||
                            usb.hasPermission(device)
                        if (cont.isActive) cont.resume(concedido)
                    }
                }
                ContextCompat.registerReceiver(
                    context, receptor, IntentFilter(ACTION_USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED,
                )
                cont.invokeOnCancellation {
                    if (terminado.compareAndSet(false, true)) runCatching { context.unregisterReceiver(receptor) }
                }
                val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                usb.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags))
            }
        } ?: false
    }

    /** Manda [data] completo a la impresora. Lanza ImpresoraException con un mensaje para el cajero. */
    suspend fun imprimir(data: ByteArray, cfg: ConfigImpresora) = mutex.withLock {
        val device = buscarImpresora(cfg)
            ?: throw ImpresoraException("No hay impresora USB conectada. Revisa el cable OTG y que esté encendida.")
        if (!solicitarPermiso(device)) throw ImpresoraException("No se concedió permiso para usar la impresora USB.")

        withContext(Dispatchers.IO) {
            val fijada = cfg.vendorId == device.vendorId && cfg.productId == device.productId
            val (intf, ep) = endpointSalida(device, cualquierClase = fijada)
                ?: throw ImpresoraException("El dispositivo USB no tiene un canal de salida de impresora (BULK OUT).")
            val conn = usb.openDevice(device) ?: throw ImpresoraException("No se pudo abrir la impresora USB.")
            try {
                if (!conn.claimInterface(intf, true)) throw ImpresoraException("La impresora USB está ocupada por otra app.")
                var off = 0
                while (off < data.size) {
                    ensureActive()
                    val len = minOf(CHUNK, data.size - off)
                    val n = conn.bulkTransfer(ep, data, off, len, TIMEOUT_MS)
                    if (n <= 0) throw ImpresoraException("La impresora dejó de responder (¿sin papel, tapa abierta o desconectada?).")
                    off += n
                }
                // Algunos clones pierden los últimos bytes si se cierra el handle en el mismo instante.
                delay(150)
            } finally {
                runCatching { conn.releaseInterface(intf) }
                conn.close()
            }
        }
    }

    private fun esClaseImpresora(d: UsbDevice) =
        (0 until d.interfaceCount).any { d.getInterface(it).interfaceClass == UsbConstants.USB_CLASS_PRINTER }

    /**
     * Primer endpoint BULK OUT, buscando en orden: interfaz de impresora (7), propietaria (0xFF) y
     * CDC-datos (0x0A, impresoras que se presentan como puerto serie). Con [cualquierClase] (el
     * usuario fijó este dispositivo a mano) acepta cualquier interfaz — nunca por defecto, para no
     * mandarle un ticket a una memoria USB, que también tiene BULK OUT.
     */
    private fun endpointSalida(d: UsbDevice, cualquierClase: Boolean = false): Pair<UsbInterface, UsbEndpoint>? {
        val clases = CLASES_COMPATIBLES + if (cualquierClase) listOf(null) else emptyList()
        for (clase in clases) {
            for (i in 0 until d.interfaceCount) {
                val intf = d.getInterface(i)
                if (clase != null && intf.interfaceClass != clase) continue
                for (e in 0 until intf.endpointCount) {
                    val ep = intf.getEndpoint(e)
                    if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) return intf to ep
                }
            }
        }
        return null
    }

    companion object {
        const val ACTION_USB_PERMISSION = "com.hangar421.pos.USB_PERMISSION"
        private const val CHUNK = 4096
        private const val TIMEOUT_MS = 5_000
        private val CLASES_COMPATIBLES: List<Int?> = listOf(
            UsbConstants.USB_CLASS_PRINTER,
            UsbConstants.USB_CLASS_VENDOR_SPEC,
            UsbConstants.USB_CLASS_CDC_DATA,
        )
    }
}
