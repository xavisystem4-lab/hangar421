import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HANGAR 421 — CRM",
  description: "Panel administrativo y CRM de HANGAR 421",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
