// Entry point propio (en vez del genérico "expo/AppEntry.js") — mismo motivo que
// apps/waiter-mobile/index.js: en este monorepo `expo` queda hoisted a la raíz (npm workspaces),
// así que el AppEntry.js genérico resolvería "../../App" relativo a su propia ubicación en disco
// en vez de a este paquete. Con un entry point propio aquí, la resolución relativa es correcta.
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
