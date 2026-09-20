"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthCrm } from "@/lib/authClient";
import { useThemeStore } from "@/store/themeStore";
import { Sidebar } from "@/components/Sidebar";
import { ChipSucursalActiva, SelectorSucursal } from "@/components/SelectorSucursal";
import { useSucursalActiva } from "@/store/sucursalActiva";

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
  const { seleccion, cargar: cargarSucursal } = useSucursalActiva();
  // Distinto de "no hay selección": esto es el usuario pidiendo cambiarla desde la cabecera,
  // con una ya elegida. Ese diálogo sí se puede cerrar sin elegir.
  const [cambiandoSucursal, setCambiandoSucursal] = useState(false);

  useEffect(() => {
    inicializar();
    cargarSucursal();
  }, [inicializar, cargarSucursal]);

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
      <main className="h421-main" style={{ flex: 1, padding: 28, overflowY: "auto" }}>
        {/* Sucursal activa siempre visible: el error caro en un ERP multisucursal es mirar los
            datos de una creyendo que son de otra. */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 18 }}>
          <ChipSucursalActiva onCambiar={() => setCambiandoSucursal(true)} />
        </div>
        {/* Sin sucursal elegida no se renderiza ninguna página: así ninguna puede consultar con
            un contexto a medias ni enseñar datos antes de que el usuario decida cuáles. */}
        {seleccion ? children : null}
      </main>

      {(!seleccion || cambiandoSucursal) && (
        <SelectorSucursal onCerrar={seleccion ? () => setCambiandoSucursal(false) : undefined} />
      )}
    </div>
  );
}
