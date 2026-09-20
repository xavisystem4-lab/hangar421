import { useEffect } from "react";
import { BackHandler } from "react-native";

/**
 * Botón físico "atrás" de Android.
 *
 * Sin esto, pulsar atrás desde cualquier pantalla cierra la app entera: estando en Cobro, en el
 * corte de caja o a media captura de un conteo, el cajero perdía lo que estuviera haciendo con
 * un toque accidental. En una tablet de mostrador ese botón se roza constantemente.
 *
 * `manejar` devuelve `true` si ya se ocupó del evento (y entonces Android no hace nada más), o
 * `false` para dejar pasar el comportamiento por defecto — que en la pantalla raíz es salir.
 *
 * Los `<Modal>` de React Native NO necesitan este hook: ya reciben el botón atrás por
 * `onRequestClose`, y todos los de esta app lo usan para cerrarse.
 */
export function useBotonAtras(manejar: () => boolean, dependencias: unknown[] = []) {
  useEffect(() => {
    const suscripcion = BackHandler.addEventListener("hardwareBackPress", manejar);
    return () => suscripcion.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencias);
}
