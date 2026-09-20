import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { abrirBaseDeDatos } from "../db/database";
import { contarPendientes } from "../db/outboxRepo";
import { procesarCola } from "./syncEngine";

/**
 * Sincronización con la app cerrada.
 *
 * El motor de sync solo corre mientras hay sesión abierta y la app en primer plano. Si el cajero
 * cierra el POS al terminar el turno con ventas sin subir —o el dispositivo se reinicia— esas
 * ventas se quedaban en la tablet hasta que alguien volviera a abrir la app. Con esto, Android
 * despierta la app periódicamente y drena la cola.
 *
 * Android decide CUÁNDO ejecutarla según batería, red y uso del dispositivo: los 15 minutos son
 * un mínimo, no una garantía, y el sistema puede espaciarlos mucho más si el dispositivo está en
 * reposo. Por eso esto es una red de seguridad, no el mecanismo principal — que sigue siendo el
 * ciclo en primer plano más el disparo al recuperar red.
 */
export const TAREA_SYNC = "hangar421-sync-en-segundo-plano";

const INTERVALO_MINIMO_SEGUNDOS = 15 * 60;

TaskManager.defineTask(TAREA_SYNC, async () => {
  try {
    const db = await abrirBaseDeDatos();
    const pendientes = await contarPendientes(db);
    if (pendientes === 0) return BackgroundFetch.BackgroundFetchResult.NoData;

    await procesarCola(true);

    const quedan = await contarPendientes(db);
    // Informar si hubo datos nuevos ayuda a Android a decidir si vale la pena seguir
    // despertando la app con esta frecuencia.
    return quedan < pendientes
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    // Nunca se propaga: una excepción aquí hace que Android penalice la tarea y la ejecute cada
    // vez menos. Los datos siguen en la cola y se reintentan.
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registrarTareaSegundoPlano(): Promise<void> {
  try {
    const yaRegistrada = await TaskManager.isTaskRegisteredAsync(TAREA_SYNC);
    if (yaRegistrada) return;

    await BackgroundFetch.registerTaskAsync(TAREA_SYNC, {
      minimumInterval: INTERVALO_MINIMO_SEGUNDOS,
      // La tarea debe sobrevivir a un reinicio del dispositivo y al cierre de la app: son
      // justamente los dos casos en los que las ventas se quedaban sin subir.
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch {
    // Que no se pueda registrar (permisos, fabricante con restricciones agresivas de batería)
    // no debe impedir usar el POS: la sincronización en primer plano sigue funcionando igual.
  }
}
