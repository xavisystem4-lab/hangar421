import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { instalarFallbackNavegador } from "./db/browserFallback";
// Aplica el tema (claro/oscuro) guardado antes de renderizar nada, para evitar un parpadeo
// de tema claro al arrancar si el dispositivo tiene el oscuro guardado.
import "./store/themeStore";

instalarFallbackNavegador();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
