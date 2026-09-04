import { useWindowDimensions } from "react-native";

export interface InfoDispositivo {
  ancho: number;
  alto: number;
  /** true si el lado corto (independiente de la orientación) mide >= 600dp — el mismo umbral
   *  que usa Android nativo (`sw600dp`) para distinguir tablet de celular. Reactivo: si rotas
   *  el dispositivo, `useWindowDimensions` dispara un re-render y esto se recalcula solo. */
  esTablet: boolean;
  horizontal: boolean;
}

/** Detección automática celular/tablet + orientación, para ajustar tamaños de botones,
 *  columnas de la grilla de productos, etc. sin tener que adivinar por plataforma — se basa en
 *  el tamaño REAL de la ventana, así que funciona igual de bien en un celular grande que en una
 *  tablet chica. */
export function useDispositivo(): InfoDispositivo {
  const { width, height } = useWindowDimensions();
  const ladoCorto = Math.min(width, height);
  return {
    ancho: width,
    alto: height,
    esTablet: ladoCorto >= 600,
    horizontal: width > height,
  };
}

/** Columnas de la grilla de productos según el tamaño de pantalla disponible — un celular en
 *  vertical usa 2, una tablet (o un celular en horizontal) usa más, calculado a partir del ancho
 *  real dividido entre un ancho de tarjeta "ideal" (~165dp) en vez de un número fijo por
 *  dispositivo, para que se vea bien en cualquier tamaño intermedio también. */
export function columnasProductos(ancho: number): number {
  return Math.max(2, Math.min(5, Math.floor(ancho / 165)));
}

/** Columnas de la grilla de mesas — tarjetas más anchas que las de producto (~130dp mínimo). */
export function columnasMesas(ancho: number): number {
  return Math.max(3, Math.min(6, Math.floor(ancho / 130)));
}
