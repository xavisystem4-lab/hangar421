// Entry point propio (en vez de usar el genérico "expo/AppEntry.js" como "main" en package.json).
// En este monorepo, `expo` queda hoisted a la raíz (npm workspaces) — el AppEntry.js genérico de
// Expo resuelve "../../App" de forma relativa a su propia ubicación en disco, así que terminaba
// buscando <raíz del repo>/App en vez de apps/waiter-mobile/App.tsx. Con un entry point propio
// aquí (junto a App.tsx), la resolución relativa siempre es correcta sin importar el hoisting.
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
