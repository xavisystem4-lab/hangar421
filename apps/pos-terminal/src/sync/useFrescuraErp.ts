import { useCallback, useEffect, useState } from "react";
import { abrirBaseDeDatos } from "../db/database";
import { descargaAtrasada, leerEstadoDescarga, type EstadoDescarga } from "../db/estadoDescargaRepo";
import { actualizarDesdeErp } from "./syncEngine";

export interface FrescuraErp {
  /** Más de 30 min sin una descarga completa del ERP (o nunca la hubo). */
  atrasada: boolean;
  /** Hora de la última descarga completa ("9:40"), o null si nunca. */
  desde: string | null;
  /** Primer motivo del último intento fallido, recortado para la banda. */
  motivo: string | null;
  descargando: boolean;
  reintentar: () => void;
}

const REVISAR_CADA_MS = 60_000;

/** Resumen de una línea para la banda ámbar: el error técnico completo vive en Admin → Sincronización. */
export function resumirMotivo(estado: EstadoDescarga): string | null {
  const intento = estado.ultimoIntento;
  if (!intento || intento.ok || intento.errores.length === 0) return null;
  const primero = intento.errores[0];
  if (/network|timeout|fetch|no respondi/i.test(primero)) return "Sin conexión con el ERP";
  return primero.length > 90 ? `${primero.slice(0, 87)}…` : primero;
}

/**
 * ¿Lo que muestra la tablet (catálogo, precios, inventario) está al día con el ERP? Antes una
 * descarga podía fallar días en silencio —así se quedó Benito con el inventario viejo—; ahora,
 * pasados 30 min sin bajar bien, la pantalla principal lo dice con una banda ámbar y un botón para
 * reintentar. Vender nunca se bloquea por esto.
 */
export function useFrescuraErp(activo: boolean): FrescuraErp {
  const [estado, setEstado] = useState<EstadoDescarga | null>(null);
  const [descargando, setDescargando] = useState(false);

  const leer = useCallback(async () => {
    try {
      setEstado(await leerEstadoDescarga(await abrirBaseDeDatos()));
    } catch {
      /* sin base aún: se reintenta en el siguiente ciclo */
    }
  }, []);

  useEffect(() => {
    if (!activo) return;
    leer();
    const t = setInterval(leer, REVISAR_CADA_MS);
    return () => clearInterval(t);
  }, [activo, leer]);

  const reintentar = useCallback(() => {
    setDescargando(true);
    actualizarDesdeErp()
      .catch(() => undefined)
      .finally(() => { setDescargando(false); leer(); });
  }, [leer]);

  const atrasada = !!estado && descargaAtrasada(estado);
  const desde = estado?.ultimaCompleta
    ? new Date(estado.ultimaCompleta).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  return { atrasada, desde, motivo: estado ? resumirMotivo(estado) : null, descargando, reintentar };
}
