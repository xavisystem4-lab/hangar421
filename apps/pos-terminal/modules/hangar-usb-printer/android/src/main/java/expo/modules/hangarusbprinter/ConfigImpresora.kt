package expo.modules.hangarusbprinter

import android.content.SharedPreferences
import org.json.JSONObject

/**
 * Ajustes de la impresora de ESTA tablet. Viven en SharedPreferences del módulo, no en la base
 * SQLite de la app: son del hardware conectado a este equipo, no de la sucursal, y el lado
 * nativo los necesita sin ir y volver a JavaScript en cada ticket.
 *
 * [vendorId]/[productId] fijan una impresora concreta cuando hay varios dispositivos USB (lector
 * de código de barras, hub…). Sin ellos se elige sola: primero clase USB "impresora" (7), luego
 * clase propietaria (0xFF) o serie CDC con endpoint BULK de salida.
 */
data class ConfigImpresora(
    val codePage: Int = 16,
    val quitarAcentos: Boolean = false,
    val cortarPapel: Boolean = true,
    val abrirCajon: Boolean = false,
    val imprimirLogo: Boolean = true,
    val vendorId: Int? = null,
    val productId: Int? = null,
) {
    fun aJson(): JSONObject = JSONObject().apply {
        put("codePage", codePage)
        put("quitarAcentos", quitarAcentos)
        put("cortarPapel", cortarPapel)
        put("abrirCajon", abrirCajon)
        put("imprimirLogo", imprimirLogo)
        put("vendorId", vendorId ?: JSONObject.NULL)
        put("productId", productId ?: JSONObject.NULL)
    }

    fun guardar(prefs: SharedPreferences) {
        prefs.edit().putString(CLAVE, aJson().toString()).apply()
    }

    companion object {
        const val PREFS = "hangar_usb_printer"
        private const val CLAVE = "config"

        fun desdeJson(j: JSONObject) = ConfigImpresora(
            codePage = j.optInt("codePage", 16),
            quitarAcentos = j.optBoolean("quitarAcentos", false),
            cortarPapel = j.optBoolean("cortarPapel", true),
            abrirCajon = j.optBoolean("abrirCajon", false),
            imprimirLogo = j.optBoolean("imprimirLogo", true),
            vendorId = if (j.isNull("vendorId")) null else j.optInt("vendorId"),
            productId = if (j.isNull("productId")) null else j.optInt("productId"),
        )

        fun leer(prefs: SharedPreferences): ConfigImpresora =
            prefs.getString(CLAVE, null)
                ?.let { runCatching { desdeJson(JSONObject(it)) }.getOrNull() }
                ?: ConfigImpresora()
    }
}
