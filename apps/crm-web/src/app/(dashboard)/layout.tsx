"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthCrm } from "@/lib/authClient";
import { useThemeStore } from "@/store/themeStore";
import { Sidebar } from "@/components/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { contexto, cargando, inicializar } = useAuthCrm();
  const inicializarTema = useThemeStore((s) => s.inicializar);
  // Solo tiene efecto en celular/tablet (≤860px, ver globals.css .h421-sidebar) — en escritorio
  // el menú siempre se ve fijo sin importar este estado. Arranca cerrado (no "recuerda" haber
  // quedado abierto de una sesión anterior): un cajón que aparece abierto solo tapando toda la
  // pantalla al entrar sería peor experiencia que partir siempre cerrado.
  const [menuAbierto, setMenuAbierto] = useState(false);

  useEffect(() => {
    inicializar();
  }, [inicializar]);

  useEffect(() => {
    inicializarTema();
  }, [inicializarTema]);

  useEffect(() => {
    if (!cargando && !contexto) router.replace("/login");
  }, [cargando, contexto, router]);

  // Cambiar de página (ej. desde otra pestaña, o al tocar "atrás") también cierra el cajón.
  useEffect(() => {
    setMenuAbierto(false);
  }, [pathname]);

  if (cargando || !contexto) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <button
        className="h421-menu-hamburguesa"
        onClick={() => setMenuAbierto((a) => !a)}
        aria-label="Abrir menú"
      >
        ☰
      </button>
      <div className="h421-sidebar-fondo" data-abierto={menuAbierto} onClick={() => setMenuAbierto(false)} />
      <Sidebar abierto={menuAbierto} onCerrar={() => setMenuAbierto(false)} />
      <main className="h421-main" style={{ flex: 1, padding: 28, overflowY: "auto" }}>{children}</main>
    </div>
  );
}
