/** Configuración de la plantilla de tickets (ticket cliente + comanda de cocina), editada desde
 *  Administración → Ticket en el POS Windows e impresa con la API nativa de impresión de
 *  Electron. Vive en `Sucursal.configJson.ticket` (ver sucursales.service.ts
 *  `actualizarConfigTicket`) — no hay endpoint dedicado en el modelo de datos porque es un
 *  bloque de estilo que siempre se lee/escribe completo, nunca por campo. */

export interface EstiloTexto {
  fuente: string;
  tamano: number;
  negrita: boolean;
  cursiva: boolean;
  subrayado: boolean;
}

export interface ConfigTicketCliente {
  encabezadoLinea1: string;
  encabezadoLinea2: string;
  estiloEncabezado: EstiloTexto;
  estiloFechaHoraMesa: EstiloTexto;
  estiloCuerpo: EstiloTexto;
  estiloTotales: EstiloTexto;
  pieLinea1: string;
  pieLinea2: string;
  estiloPie: EstiloTexto;
}

export interface ConfigComanda {
  titulo: string;
  estiloEncabezado: EstiloTexto;
  estiloCuerpo: EstiloTexto;
}

export interface ConfigTicket {
  anchoImpresoraMM: 58 | 80;
  mostrarLogo: boolean;
  cliente: ConfigTicketCliente;
  comanda: ConfigComanda;
}

const ESTILO_BASE: EstiloTexto = { fuente: "Courier New", tamano: 12, negrita: false, cursiva: false, subrayado: false };

export const CONFIG_TICKET_DEFAULT: ConfigTicket = {
  anchoImpresoraMM: 80,
  mostrarLogo: true,
  cliente: {
    encabezadoLinea1: "",
    encabezadoLinea2: "",
    estiloEncabezado: { fuente: "Trebuchet MS", tamano: 20, negrita: true, cursiva: false, subrayado: false },
    estiloFechaHoraMesa: { ...ESTILO_BASE, tamano: 11 },
    estiloCuerpo: { ...ESTILO_BASE, tamano: 13, negrita: true },
    estiloTotales: { ...ESTILO_BASE, tamano: 12 },
    pieLinea1: "¡Gracias por su visita!",
    pieLinea2: "",
    estiloPie: { fuente: "Trebuchet MS", tamano: 14, negrita: false, cursiva: false, subrayado: true },
  },
  comanda: {
    titulo: "COMANDA",
    estiloEncabezado: { fuente: "Trebuchet MS", tamano: 18, negrita: true, cursiva: false, subrayado: false },
    estiloCuerpo: { ...ESTILO_BASE, tamano: 14, negrita: true },
  },
};

export interface AreaImpresion {
  id: string;
  empresaId: string;
  nombre: string;
  activo: boolean;
}
