package expo.modules.hangarnotificaciones

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/**
 * Servicio de Android que recibe TODAS las notificaciones del dispositivo una vez que el usuario
 * concede "Acceso a notificaciones" a esta app. Solo se queda con las de las apps vigiladas
 * (DiDi por defecto, ver AlmacenNotificaciones.vigila): las guarda en el almacén y, si la app de
 * JavaScript está viva, se las manda al momento por el módulo (evento "notificacion").
 *
 * No toca las notificaciones de las demás apps (no las cierra ni las modifica) y no lee nada
 * fuera de título/texto, que es lo que DiDi muestra: "Nuevo pedido #1234 · $180.00".
 */
class EscuchaNotificaciones : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn ?: return
        if (!AlmacenNotificaciones.activo(applicationContext)) return
        val paquete = n.packageName ?: return
        if (paquete == applicationContext.packageName) return
        val etiqueta = etiquetaDeApp(applicationContext, paquete)
        if (!AlmacenNotificaciones.vigila(applicationContext, paquete, etiqueta)) return

        val extras = n.notification?.extras
        val titulo = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val texto = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val textoLargo = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
        val lineas = extras?.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString("\n") { it.toString() } ?: ""
        // Las notificaciones "resumen" de grupo no traen el pedido, solo "3 notificaciones".
        val esResumenDeGrupo = (n.notification?.flags ?: 0) and Notification.FLAG_GROUP_SUMMARY != 0
        if (esResumenDeGrupo) return
        if (titulo.isBlank() && texto.isBlank() && textoLargo.isBlank() && lineas.isBlank()) return

        val datos = JSONObject()
            .put("id", "${n.key}|${n.postTime}")
            .put("paquete", paquete)
            .put("app", etiqueta ?: paquete)
            .put("titulo", titulo)
            .put("texto", listOf(textoLargo, texto, lineas).firstOrNull { it.isNotBlank() } ?: "")
            .put("hora", n.postTime)

        val nueva = AlmacenNotificaciones.agregar(applicationContext, datos)
        if (nueva) emisor?.invoke(datos)
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        conectado = true
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        conectado = false
        // Android a veces desengancha el servicio (p. ej. tras actualizar la app); se pide volver
        // a enlazar en vez de esperar a que el usuario quite y vuelva a dar el permiso.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try { requestRebind(ComponentName(this, EscuchaNotificaciones::class.java)) } catch (e: Exception) { /* sin permiso aún */ }
        }
    }

    companion object {
        /** Lo pone el módulo mientras la app de JS escucha; null cuando no hay nadie que avise. */
        @Volatile var emisor: ((JSONObject) -> Unit)? = null
        @Volatile var conectado: Boolean = false

        fun etiquetaDeApp(context: Context, paquete: String): String? = try {
            val pm = context.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(paquete, 0)).toString()
        } catch (e: Exception) {
            null
        }

        /** Si el usuario ya concedió "Acceso a notificaciones" a esta app. */
        fun permisoConcedido(context: Context): Boolean {
            val habilitados = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
            val propio = ComponentName(context, EscuchaNotificaciones::class.java)
            return habilitados.split(":").any { entrada ->
                val cn = ComponentName.unflattenFromString(entrada)
                cn != null && cn.packageName == propio.packageName && cn.className == propio.className
            }
        }
    }
}
