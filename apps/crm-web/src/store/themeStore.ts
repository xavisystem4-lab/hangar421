"use client";

import { create } from "zustand";

export type Tema = "claro" | "oscuro";

const CLAVE_STORAGE = "hangar421-crm-tema";

// Mismo patrón que apps/pos-desktop/src/store/themeStore.ts, pero con guardas para SSR de
// Next.js: aquí `document`/`localStorage`/`window` no existen durante el render en el servidor,
// así que el estado inicial es siempre "claro" y el valor real se aplica en `inicializar()`,
// llamado desde un useEffect (ver (dashboard)/layout.tsx). El script anti-flash en layout.tsx
// (root, Server Component) ya deja `data-theme` correcto en <html> antes de la hidratación,
// así que no hay parpadeo aunque el estado de Zustand arranque en "claro".
function leerTemaGuardado(): Tema | null {
  if (typeof window === "undefined") return null;
  const guardado = localStorage.getItem(CLAVE_STORAGE);
  return guardado === "claro" || guardado === "oscuro" ? guardado : null;
}

function aplicarAlDocumento(tema: Tema) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", tema);
}

interface ThemeState {
  tema: Tema;
  inicializado: boolean;
  inicializar: () => void;
  alternar: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  tema: "claro",
  inicializado: false,
  inicializar: () => {
    if (get().inicializado) return;
    const guardado = leerTemaGuardado();
    const preferido = guardado ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro");
    aplicarAlDocumento(preferido);
    set({ tema: preferido, inicializado: true });
  },
  alternar: () => {
    const siguiente: Tema = get().tema === "claro" ? "oscuro" : "claro";
    localStorage.setItem(CLAVE_STORAGE, siguiente);
    aplicarAlDocumento(siguiente);
    set({ tema: siguiente });
  },
}));
