import { generarSlug } from "./busqueda";

/** Modificadores REALES de HANGAR 421, copiados de la misma fuente que el catálogo:
 *  apps/backend/src/bootstrap/seed-demo-data.ts. Son los que el POS de Windows pregunta al
 *  tocar un café (tamaño, tipo de leche, jarabes, cold foam).
 *
 *  Se mantiene aparte de catalogoHangar.ts por tamaño, pero es el mismo criterio: duplicado a
 *  mano porque packages/shared guarda tipos y cálculos, no datos de negocio, y modificadoresHangar.spec.ts
 *  fija los conteos para que las dos copias no se separen en silencio. */

export type TipoModificador = "SELECCION_UNICA" | "MULTIPLE";

export interface OpcionHangar {
  nombre: string;
  precioExtra: number;
  orden: number;
}

export interface ModificadorHangar {
  nombre: string;
  tipo: TipoModificador;
  obligatorio: boolean;
  opciones: OpcionHangar[];
}

export const MODIFICADORES_HANGAR: ModificadorHangar[] = [
  {
    nombre: "Tamaño",
    tipo: "SELECCION_UNICA",
    obligatorio: true,
    opciones: [
      { nombre: "Chico", precioExtra: 0, orden: 1 },
      { nombre: "Grande", precioExtra: 12, orden: 2 },
      { nombre: "XL", precioExtra: 20, orden: 3 },
    ],
  },
  {
    nombre: "Tipo de leche",
    tipo: "SELECCION_UNICA",
    obligatorio: true,
    opciones: [
      { nombre: "Entera", precioExtra: 0, orden: 1 },
      { nombre: "Deslactosada", precioExtra: 0, orden: 2 },
      { nombre: "Avena", precioExtra: 25, orden: 3 },
      { nombre: "Almendra", precioExtra: 20, orden: 4 },
    ],
  },
  {
    nombre: "Extras",
    tipo: "MULTIPLE",
    obligatorio: false,
    opciones: [
      { nombre: "Shot extra", precioExtra: 25, orden: 1 },
      { nombre: "Sin azúcar", precioExtra: 0, orden: 2 },
      { nombre: "Canela", precioExtra: 5, orden: 3 },
      { nombre: "Gr de Matcha", precioExtra: 20, orden: 4 },
    ],
  },
  {
    nombre: "Jarabe",
    tipo: "MULTIPLE",
    obligatorio: false,
    opciones: [
      { nombre: "Vainilla", precioExtra: 15, orden: 1 },
      { nombre: "Caramelo", precioExtra: 15, orden: 2 },
      { nombre: "Miel de agave", precioExtra: 15, orden: 3 },
      { nombre: "Cacao", precioExtra: 15, orden: 4 },
      { nombre: "Salted Caramel", precioExtra: 15, orden: 5 },
      { nombre: "Plátano", precioExtra: 15, orden: 6 },
    ],
  },
  {
    nombre: "Cold Foam",
    tipo: "MULTIPLE",
    obligatorio: false,
    opciones: [
      { nombre: "Blue Matcha", precioExtra: 25, orden: 1 },
      { nombre: "Matcha", precioExtra: 25, orden: 2 },
      { nombre: "Cajeta", precioExtra: 25, orden: 3 },
      { nombre: "Plátano", precioExtra: 25, orden: 4 },
      { nombre: "Vainilla", precioExtra: 25, orden: 5 },
    ],
  },
  {
    // Va incluido en el combo, por eso todas las opciones cuestan 0 — a diferencia de "Jarabe",
    // que se cobra aparte sobre una bebida suelta.
    nombre: "Jarabe a escoger",
    tipo: "SELECCION_UNICA",
    obligatorio: true,
    opciones: [
      { nombre: "Vainilla", precioExtra: 0, orden: 1 },
      { nombre: "Caramelo", precioExtra: 0, orden: 2 },
      { nombre: "Miel de agave", precioExtra: 0, orden: 3 },
      { nombre: "Cacao", precioExtra: 0, orden: 4 },
      { nombre: "Salted Caramel", precioExtra: 0, orden: 5 },
      { nombre: "Plátano", precioExtra: 0, orden: 6 },
    ],
  },
];

/** Las cinco preguntas de una bebida preparada, en el orden en que las hace el POS Windows. */
export const MODAL_BEBIDA = ["Tamaño", "Tipo de leche", "Extras", "Jarabe", "Cold Foam"];

/** Qué modificadores pregunta cada producto, por `categoria#nombre`. Un producto que no está
 *  aquí se agrega directo al carrito sin abrir el modal — igual que en el POS Windows, donde
 *  `personalizacion` ausente significa "sin modal".
 *
 *  Americano, Espresso Tonic y Cold Brew Black Honey quedan fuera a propósito: en el menú no
 *  llevaban `*`, no se preparan a medida. */
export const PERSONALIZACION_POR_PRODUCTO: Record<string, string[]> = {
  "Bebidas frías#Latte": MODAL_BEBIDA,
  "Bebidas frías#Chai": MODAL_BEBIDA,
  "Bebidas frías#Dirty Chai": MODAL_BEBIDA,
  "Bebidas frías#Latte Maple y Sal": MODAL_BEBIDA,
  "Bebidas frías#Latte Amanecer": MODAL_BEBIDA,
  "Bebidas frías#Latte Chicago": MODAL_BEBIDA,
  "Bebidas frías#Matcha Iced Latte": MODAL_BEBIDA,

  "Bebidas calientes#Latte": MODAL_BEBIDA,
  "Bebidas calientes#Chai": MODAL_BEBIDA,
  "Bebidas calientes#Dirty Chai": MODAL_BEBIDA,
  "Bebidas calientes#Flat White": MODAL_BEBIDA,
  "Bebidas calientes#Capuccino": MODAL_BEBIDA,
  "Bebidas calientes#Matcha": MODAL_BEBIDA,

  "Combos#H & T": ["Jarabe a escoger"],
  "Combos#BnE & T": ["Jarabe a escoger"],
};

export function idModificadorHangar(nombre: string): string {
  return `hangar-mod-${generarSlug(nombre)}`;
}

/** Incluye el modificador porque el nombre de opción se repite entre ellos: "Vainilla" está en
 *  Jarabe, en Cold Foam y en Jarabe a escoger, con precios distintos. */
export function idOpcionHangar(modificador: string, opcion: string): string {
  return `hangar-opt-${generarSlug(modificador)}-${generarSlug(opcion)}`;
}
