import { Alert, BackHandler } from "react-native";

/** Cierra la app por completo (termina el proceso), no solo la manda a segundo plano — pedido
 *  explícito para el login y la pantalla de Conexión: si la tablet no logra conectar con la
 *  Estación, antes no había ninguna forma de salir de esa pantalla más que arreglar la
 *  conexión o forzar el cierre desde el sistema operativo. Solo funciona en Android
 *  (`BackHandler.exitApp()` no existe en iOS, pero esta app es exclusivamente para tablets/
 *  celulares Android — ver el resto del flujo de build en release-waiter-apk.yml). */
export function confirmarCerrarApp() {
  Alert.alert("Cerrar aplicación", "¿Seguro que quieres cerrar la app por completo?", [
    { text: "Cancelar", style: "cancel" },
    { text: "Cerrar", style: "destructive", onPress: () => BackHandler.exitApp() },
  ]);
}
