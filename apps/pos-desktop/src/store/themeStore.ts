import { create } from "zustand";

export type Tema = "claro" | "oscuro";

const CLAVE_STORAGE = "hangar421-tema";

/** Preferencia de tema (claro/oscuro) — es una preferencia por dispositivo, no por usuario, así
 *  que se guarda en localStorage (no en la sesión) y debe estar disponible ya en la pantalla de
 *  login, antes de que exista ninguna sesión iniciada. Se aplica como atributo `data-theme` en
 *  <html>; los tokens de color en theme.css responden a ese atributo automáticamente. */
function leerTemaInicial(): Tema {
  const guardado = localStorage.getItem(CLAVE_STORAGE);
  if (guardado === "claro" || guardado === "oscuro") return guardado;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}

function aplicarAlDocumento(tema: Tema) {
  document.documentElement.setAttribute("data-theme", tema);
}

interface ThemeState {
  tema: Tema;
  alternar: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  tema: leerTemaInicial(),
  alternar: () => {
    const siguiente: Tema = get().tema === "claro" ? "oscuro" : "claro";
    localStorage.setItem(CLAVE_STORAGE, siguiente);
    aplicarAlDocumento(siguiente);
    set({ tema: siguiente });
  },
}));

// Aplica el tema inicial de inmediato (antes de que React monte nada) para que no haya un
// parpadeo de tema claro antes de que se hidrate el store.
aplicarAlDocumento(useThemeStore.getState().tema);
