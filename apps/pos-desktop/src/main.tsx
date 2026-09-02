import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { instalarFallbackNavegador } from "./db/browserFallback";

instalarFallbackNavegador();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
