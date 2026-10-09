package expo.modules.hangarnotificaciones

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Guarda en SharedPreferences lo que el servicio capta, para que no se pierda si la app de
 * JavaScript no está viva en ese momento (pantalla apagada, app en segundo plano o cerrada): al
 * abrir el POS, JS lee las pendientes y las procesa. También guarda qué paquetes se vigilan.
 *
 * Todo pasa por aquí, tanto desde el servicio (proceso del sistema que enlaza con nuestra app)
 * como desde el módulo, así que las escrituras van sincronizadas con `commit()`.
 */
object AlmacenNotificaciones {
    const val PREFS = "hangar_notificaciones"
    private const val CLAVE_PENDIENTES = "pendientes"
    private const val CLAVE_PAQUETES = "paquetes_vigilados"
    private const val CLAVE_ACTIVO = "activo"
    private const val TOPE = 100

    fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Si la escucha está encendida desde la app (además del permiso del sistema). */
    fun activo(context: Context): Boolean = prefs(context).getBoolean(CLAVE_ACTIVO, true)
    fun guardarActivo(context: Context, activo: Boolean) { prefs(context).edit().putBoolean(CLAVE_ACTIVO, activo).commit() }

    /** Paquetes (apps) cuyas notificaciones se capturan. Vacío = cualquier app cuyo paquete o
     *  nombre contenga "didi" (el valor por defecto que sirve sin configurar nada). */
    fun paquetesVigilados(context: Context): List<String> {
        val crudo = prefs(context).getString(CLAVE_PAQUETES, "[]") ?: "[]"
        return try {
            val arr = JSONArray(crudo)
            (0 until arr.length()).map { arr.getString(it) }.filter { it.isNotBlank() }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun guardarPaquetesVigilados(context: Context, paquetes: List<String>) {
        prefs(context).edit().putString(CLAVE_PAQUETES, JSONArray(paquetes).toString()).commit()
    }

    fun vigila(context: Context, paquete: String, etiquetaApp: String?): Boolean {
        val lista = paquetesVigilados(context)
        if (lista.isNotEmpty()) return lista.contains(paquete)
        val p = paquete.lowercase()
        val e = (etiquetaApp ?: "").lowercase()
        return p.contains("didi") || e.contains("didi")
    }

    @Synchronized
    fun pendientes(context: Context): JSONArray {
        val crudo = prefs(context).getString(CLAVE_PENDIENTES, "[]") ?: "[]"
        return try { JSONArray(crudo) } catch (e: Exception) { JSONArray() }
    }

    /** Agrega una notificación si no estaba ya (misma clave y misma hora). Devuelve true si era nueva. */
    @Synchronized
    fun agregar(context: Context, notificacion: JSONObject): Boolean {
        val lista = pendientes(context)
        val id = notificacion.optString("id")
        for (i in 0 until lista.length()) {
            if (lista.optJSONObject(i)?.optString("id") == id) return false
        }
        val nueva = JSONArray()
        // Las más recientes al frente, con tope: la bandeja no crece sin límite.
        nueva.put(notificacion)
        for (i in 0 until minOf(lista.length(), TOPE - 1)) nueva.put(lista.get(i))
        prefs(context).edit().putString(CLAVE_PENDIENTES, nueva.toString()).commit()
        return true
    }

    @Synchronized
    fun quitar(context: Context, ids: Collection<String>) {
        if (ids.isEmpty()) return
        val lista = pendientes(context)
        val nueva = JSONArray()
        for (i in 0 until lista.length()) {
            val o = lista.optJSONObject(i) ?: continue
            if (!ids.contains(o.optString("id"))) nueva.put(o)
        }
        prefs(context).edit().putString(CLAVE_PENDIENTES, nueva.toString()).commit()
    }

    @Synchronized
    fun vaciar(context: Context) {
        prefs(context).edit().putString(CLAVE_PENDIENTES, "[]").commit()
    }
}
