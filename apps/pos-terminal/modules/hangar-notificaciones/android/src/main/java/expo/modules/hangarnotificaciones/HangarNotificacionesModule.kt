package expo.modules.hangarnotificaciones

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/**
 * Puente JavaScript ↔ Kotlin del escucha de notificaciones (ver EscuchaNotificaciones). La
 * contraparte en TS es modules/hangar-notificaciones/index.ts. Igual que el módulo de la
 * impresora, lo que cruza va como JSON en texto.
 */
class HangarNotificacionesModule : Module() {
    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "Sin contexto de Android" }.applicationContext

    override fun definition() = ModuleDefinition {
        Name("HangarNotificaciones")

        Events("notificacion")

        OnStartObserving {
            EscuchaNotificaciones.emisor = { datos ->
                try { sendEvent("notificacion", mapOf("json" to datos.toString())) } catch (e: Exception) { /* JS no disponible */ }
            }
        }

        OnStopObserving {
            EscuchaNotificaciones.emisor = null
        }

        /** Si el usuario ya concedió "Acceso a notificaciones" a esta app en Ajustes. */
        Function("permisoConcedido") {
            EscuchaNotificaciones.permisoConcedido(context)
        }

        /** Si el sistema tiene enlazado el servicio ahora mismo (puede tardar unos segundos tras dar el permiso). */
        Function("servicioConectado") {
            EscuchaNotificaciones.conectado
        }

        /** Abre la pantalla de Ajustes donde se concede el acceso a notificaciones. */
        Function("abrirAjustesAcceso") {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            true
        }

        Function("activo") { AlmacenNotificaciones.activo(context) }
        Function("guardarActivo") { activo: Boolean -> AlmacenNotificaciones.guardarActivo(context, activo); true }

        /** Notificaciones captadas y todavía no procesadas por la app (JSON, las más recientes primero). */
        Function("listarPendientes") {
            AlmacenNotificaciones.pendientes(context).toString()
        }

        Function("marcarProcesadas") { idsJson: String ->
            val arr = JSONArray(idsJson)
            AlmacenNotificaciones.quitar(context, (0 until arr.length()).map { arr.getString(it) })
            true
        }

        Function("vaciarPendientes") { AlmacenNotificaciones.vaciar(context); true }

        Function("paquetesVigilados") {
            JSONArray(AlmacenNotificaciones.paquetesVigilados(context)).toString()
        }

        Function("guardarPaquetesVigilados") { json: String ->
            val arr = JSONArray(json)
            AlmacenNotificaciones.guardarPaquetesVigilados(context, (0 until arr.length()).map { arr.getString(it) })
            true
        }

        /** Apps instaladas con icono en el lanzador (las que un usuario reconoce), para elegir
         *  cuál vigilar. Devuelve [{paquete, nombre, vigilada}] ordenadas por nombre. */
        Function("listarAppsInstaladas") {
            val pm = context.packageManager
            val vigiladas = AlmacenNotificaciones.paquetesVigilados(context).toSet()
            val lanzables = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
                .map { it.activityInfo.packageName }
                .toSet()
            val salida = JSONArray()
            val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
                .filter { lanzables.contains(it.packageName) && it.packageName != context.packageName }
                .map { info: ApplicationInfo -> info.packageName to (pm.getApplicationLabel(info)?.toString() ?: info.packageName) }
                .sortedBy { it.second.lowercase() }
            for ((paquete, nombre) in apps) {
                salida.put(JSONObject().put("paquete", paquete).put("nombre", nombre).put("vigilada", vigiladas.contains(paquete)))
            }
            salida.toString()
        }
    }
}
