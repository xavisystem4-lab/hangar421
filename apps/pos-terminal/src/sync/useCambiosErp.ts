import { useCallback, useEffect, useRef, useState } from "react";
import { Vibration } from "react-native";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerOCrearDispositivoId } from "../db/dispositivoLocal";
import { sonarCambioErp } from "../../modules/hangar-usb-printer";
import { actualizarDesdeErp } from "./syncEngine";
import { hayCambioNuevo, leerMarcaErp, versionAplicada, type MarcaErp } from "./cambiosErp";

/** Cada cuánto se pregunta al ERP si cambió algo. Es una sola lectura muy barata. */
const REVISAR_CADA_MS = 20_000;

export interface AvisoCambiosErp {
  /** Qué cambió ("Catálogo y precios"…) o null si no hay nada pendiente. */
  pendiente: MarcaErp | null;
  descargando: boolean;
  /** "Descargar modificación de ERP". */
  descargar: () => void;
  error: string | null;
}

/**
 * Aviso inmediato de cambios del ERP: cuando cambian catálogo, precios, recetas, insumos, crédito o
 * usuarios, la tablet lo detecta en segundos, suena un pitido (una vez por cambio) y ofrece el
 * botón "Descargar modificación de ERP". Vender nunca se bloquea.
 */
export function useCambiosErp(activo: boolean): AvisoCambiosErp {
  const [pendiente, setPendiente] = useState<MarcaErp | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ultimoAvisado = useRef<string | null>(null);

  const revisar = useCallback(async () => {
    try {
      const db = await abrirBaseDeDatos();
      const [marca, aplicada, dispositivoId] = await Promise.all([leerMarcaErp(), versionAplicada(db), obtenerOCrearDispositivoId(db)]);
      if (!hayCambioNuevo(marca, aplicada, dispositivoId)) {
        setPendiente(null);
        return;
      }
      setPendiente(marca);
      if (marca.version && ultimoAvisado.current !== marca.version) {
        ultimoAvisado.current = marca.version;
        sonarCambioErp();
        Vibration.vibrate([0, 250, 150, 250]);
      }
    } catch {
      /* sin red o ERP anterior sin /sync/cambios: se reintenta en el siguiente ciclo */
    }
  }, []);

  useEffect(() => {
    if (!activo) return;
    revisar();
    const t = setInterval(revisar, REVISAR_CADA_MS);
    return () => clearInterval(t);
  }, [activo, revisar]);

  const descargar = useCallback(() => {
    setDescargando(true);
    setError(null);
    actualizarDesdeErp()
      .then((r) => { if (!r.ok) setError(r.errores[0] ?? "No se pudo descargar"); })
      .catch((e: any) => setError(e?.message ?? "No se pudo descargar"))
      .finally(() => { setDescargando(false); revisar(); });
  }, [revisar]);

  return { pendiente, descargando, descargar, error };
}
