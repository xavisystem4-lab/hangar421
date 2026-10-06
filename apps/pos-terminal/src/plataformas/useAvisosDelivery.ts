import { useEffect, useRef, useState } from "react";
import { Vibration } from "react-native";
import { abrirBaseDeDatos } from "../db/database";
import { guardarConfig, obtenerConfig } from "../db/configLocalRepo";
import { obtenerOCrearEmpresaIdLocal, obtenerSucursalErp } from "../db/dispositivoLocal";
import { obtenerTokensErp } from "../api/erpHttp";
import { sonarAviso } from "../../modules/hangar-usb-printer";
import { plataformasApi } from "./plataformasApi";
import { esperaTrasFallos, idsParaRecordar, pedidosNuevos, textoAviso } from "./avisosDelivery";
import type { PedidoEntrante } from "./ventaPlataforma";

export const CLAVE_SONIDO_DELIVERY = "delivery_sonido";
const CLAVE_AVISADOS = "delivery_avisados";

export interface EstadoAvisosDelivery {
  pendientes: number;
  /** Texto del aviso visible ("Nuevo pedido de Rappi #123"), o null si no hay nada nuevo. */
  aviso: string | null;
  /** true = el último intento de leer la bandeja falló (sin red o ERP caído). */
  sinConexion: boolean;
  /** Epoch ms del próximo intento cuando hay fallos (backoff), para mostrarlo. */
  proximoIntento: number | null;
  descartarAviso: () => void;
  reintentarAhora: () => void;
}

/**
 * Revisa la bandeja de delivery en segundo plano mientras el POS está abierto (en cualquier
 * pantalla) y avisa con banner + vibración + sonido (configurable) cuando entra un pedido que
 * esta terminal no había avisado. Los ids avisados se guardan en la base local: tras cerrar y
 * abrir la app no se vuelve a sonar por los mismos pedidos, y los que siguen pendientes se
 * siguen contando. Sin conexión reintenta con backoff (30 s → 5 min) en vez de martillar.
 *
 * El estado de cada pedido vive en el ERP: aquí no se guarda nada más que qué se avisó.
 */
export function useAvisosDelivery(activo: boolean): EstadoAvisosDelivery {
  const [pendientes, setPendientes] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const [proximoIntento, setProximoIntento] = useState<number | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallos = useRef(0);
  const vivo = useRef(true);

  async function revisar() {
    if (temporizador.current) clearTimeout(temporizador.current);
    let siguiente = esperaTrasFallos(0);
    try {
      const db = await abrirBaseDeDatos();
      if (!(await obtenerTokensErp())) {
        // Terminal sin enlazar al ERP: no hay bandeja que revisar, ni error que mostrar.
        setSinConexion(false);
        setPendientes(0);
      } else {
        const [empresaId, sucursalId] = await Promise.all([obtenerOCrearEmpresaIdLocal(db), obtenerSucursalErp(db)]);
        const lista: PedidoEntrante[] = await plataformasApi.listarPedidosPorAceptar(empresaId, sucursalId);
        const avisados = JSON.parse((await obtenerConfig(db, CLAVE_AVISADOS)) ?? "[]") as string[];
        const nuevos = pedidosNuevos(lista, avisados);
        if (nuevos.length > 0 && vivo.current) {
          setAviso(textoAviso(nuevos));
          Vibration.vibrate([0, 300, 150, 300]);
          if ((await obtenerConfig(db, CLAVE_SONIDO_DELIVERY)) !== "0") sonarAviso();
        }
        await guardarConfig(db, CLAVE_AVISADOS, JSON.stringify(idsParaRecordar(lista)));
        if (vivo.current) {
          setPendientes(lista.length);
          setSinConexion(false);
          setProximoIntento(null);
        }
        fallos.current = 0;
      }
    } catch (e: any) {
      // 403: este usuario no puede ver la bandeja — no es un problema de conexión ni se insiste.
      if (e?.status === 403) {
        fallos.current = 0;
        siguiente = 10 * 60_000;
      } else {
        fallos.current += 1;
        siguiente = esperaTrasFallos(fallos.current);
        if (vivo.current) {
          setSinConexion(true);
          setProximoIntento(Date.now() + siguiente);
        }
      }
    }
    if (vivo.current) temporizador.current = setTimeout(revisar, siguiente);
  }

  useEffect(() => {
    vivo.current = true;
    if (!activo) return;
    revisar();
    return () => {
      vivo.current = false;
      if (temporizador.current) clearTimeout(temporizador.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo]);

  return {
    pendientes,
    aviso,
    sinConexion,
    proximoIntento,
    descartarAviso: () => setAviso(null),
    reintentarAhora: () => {
      fallos.current = 0;
      revisar();
    },
  };
}
