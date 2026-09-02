import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HANGAR 421 — CRM",
  description: "Panel administrativo y CRM de HANGAR 421",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
