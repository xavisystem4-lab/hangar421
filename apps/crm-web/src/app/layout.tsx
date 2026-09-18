import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HANGAR 421 — ERP",
  description: "Panel administrativo y ERP de HANGAR 421",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

// Script anti-flash: se ejecuta antes de la hidratación de React, así que evita el parpadeo de
// tema claro al recargar con modo oscuro guardado (ver src/store/themeStore.ts). No puede leer
// el store de Zustand (aún no existe en este punto) por eso repite la misma lógica en JS plano
// contra la misma clave de localStorage.
const SCRIPT_ANTI_FLASH = `
(function () {
  try {
    var guardado = localStorage.getItem("hangar421-crm-tema");
    var tema = guardado === "claro" || guardado === "oscuro"
      ? guardado
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro");
    document.documentElement.setAttribute("data-theme", tema);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_ANTI_FLASH }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
