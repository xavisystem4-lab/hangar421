import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { create } from "zustand";
import { paleta, type Paleta, type Tema } from "../theme";

const CLAVE = "hangar421_tema";

interface TemaState {
  tema: Tema;
  cargando: boolean;
  cargar: () => Promise<void>;
  alternar: () => void;
}

/** Preferencia de tema (claro/oscuro) — es una preferencia del dispositivo (la tablet la usa
 *  gente distinta en cada turno), no del usuario logeado, así que se guarda aparte de la sesión
 *  y está disponible ya en LoginScreen, antes de que exista ningún usuario. Mismo criterio que
 *  el modo oscuro del POS Windows (`apps/pos-desktop/src/store/themeStore.ts`): si nunca se
 *  eligió nada, se sigue la preferencia del sistema operativo. */
export const useTemaStore = create<TemaState>((set, get) => ({
  tema: Appearance.getColorScheme() === "dark" ? "oscuro" : "claro",
  cargando: true,

  cargar: async () => {
    const guardado = await AsyncStorage.getItem(CLAVE);
    if (guardado === "claro" || guardado === "oscuro") {
      set({ tema: guardado, cargando: false });
    } else {
      set({ cargando: false });
    }
  },

  alternar: () => {
    const siguiente: Tema = get().tema === "claro" ? "oscuro" : "claro";
    AsyncStorage.setItem(CLAVE, siguiente).catch(() => {});
    set({ tema: siguiente });
  },
}));

/** Hook que usa cada pantalla en vez de importar `colores` directo — así el componente se
 *  vuelve a renderizar (y recalcula sus estilos) cuando alguien alterna el tema. */
export function usarColores(): Paleta {
  return useTemaStore((s) => paleta(s.tema));
}
