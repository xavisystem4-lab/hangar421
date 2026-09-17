import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

const CLAVE = "hangar421_modo";

export type ModoApp = "comandero" | "pos";

interface ModoState {
  modo: ModoApp | null;
  cargando: boolean;
  cargar: () => Promise<void>;
  elegir: (modo: ModoApp) => void;
  olvidar: () => void;
}

/** Modo de uso de la app en ESTA tablet/celular — "Comandero" (toma de pedidos, el único modo que
 *  existía antes) o "Punto de Venta" (réplica del POS Windows: mesas, venta, cobro, caja y
 *  administración). Es una preferencia del dispositivo, no de la sesión: una vez elegido se
 *  recuerda entre reinicios y entre inicios de sesión (una tablet dedicada a caja no debería
 *  volver a preguntar cada vez que alguien entra) — mismo criterio y misma mecánica que
 *  `temaStore.ts` (AsyncStorage, cargado antes del primer render). Solo `olvidar()` (acción
 *  explícita "Cambiar de modo") lo borra — el logout normal NO lo toca (ver App.tsx). */
export const useModoStore = create<ModoState>((set) => ({
  modo: null,
  cargando: true,

  cargar: async () => {
    const guardado = await AsyncStorage.getItem(CLAVE);
    if (guardado === "comandero" || guardado === "pos") {
      set({ modo: guardado, cargando: false });
    } else {
      set({ cargando: false });
    }
  },

  elegir: (modo) => {
    AsyncStorage.setItem(CLAVE, modo).catch(() => {});
    set({ modo });
  },

  olvidar: () => {
    AsyncStorage.removeItem(CLAVE).catch(() => {});
    set({ modo: null });
  },
}));
