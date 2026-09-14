"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthCrm } from "@/lib/authClient";
import { useThemeStore } from "@/store/themeStore";
import { Sidebar } from "@/components/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { contexto, cargando, inicializar } = useAuthCrm();
  const inicializarTema = useThemeStore((s) => s.inicializar);

  useEffect(() => {
    inicializar();
  }, [inicializar]);

  useEffect(() => {
    inicializarTema();
  }, [inicializarTema]);

  useEffect(() => {
    if (!cargando && !contexto) router.replace("/login");
  }, [cargando, contexto, router]);

  if (cargando || !contexto) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{ flex: 1, padding: 28, overflowY: "auto" }}>{children}</main>
    </div>
  );
}
