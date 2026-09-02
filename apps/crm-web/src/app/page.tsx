"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthCrm } from "@/lib/authClient";

export default function Home() {
  const router = useRouter();
  const { contexto, cargando, inicializar } = useAuthCrm();

  useEffect(() => {
    inicializar();
  }, [inicializar]);

  useEffect(() => {
    if (cargando) return;
    router.replace(contexto ? "/dashboard" : "/login");
  }, [cargando, contexto, router]);

  return null;
}
