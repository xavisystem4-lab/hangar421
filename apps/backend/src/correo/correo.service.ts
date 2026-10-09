import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import * as nodemailer from "nodemailer";

export interface AdjuntoCorreo {
  nombre: string;
  /** Contenido en base64 (así viaja desde el navegador, que es quien genera el PDF). */
  contenidoBase64: string;
  tipo: string;
}

export interface CorreoSaliente {
  destinatarios: string[];
  asunto: string;
  html: string;
  texto?: string;
  adjuntos?: AdjuntoCorreo[];
}

export interface EstadoCorreo {
  configurado: boolean;
  proveedor: "smtp" | "resend" | null;
  remitente: string | null;
  /** Qué falta configurar, en palabras para el administrador. */
  detalle: string;
}

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Envío de correo del ERP (reportes de inventario, lista de compras). Se configura por variables
 * de entorno en el servidor, nunca desde la app:
 *
 *  - SMTP (Gmail con "contraseña de aplicación", Outlook, el correo del dominio…):
 *    SMTP_HOST, SMTP_PORT (587 o 465), SMTP_USER, SMTP_PASS y CORREO_REMITENTE (opcional,
 *    por defecto SMTP_USER).
 *  - Resend (https://resend.com, API por HTTPS sin librería): RESEND_API_KEY y CORREO_REMITENTE
 *    con un dominio verificado en Resend.
 *
 * Si no hay ninguno, `estado()` lo dice y el ERP ofrece la alternativa de abrir el correo del
 * usuario con el PDF descargado. Ver docs/correo.md.
 */
@Injectable()
export class CorreoService {
  private readonly logger = new Logger(CorreoService.name);

  estado(): EstadoCorreo {
    const env = process.env;
    if (env.RESEND_API_KEY) {
      const remitente = env.CORREO_REMITENTE ?? null;
      return remitente
        ? { configurado: true, proveedor: "resend", remitente, detalle: "Resend configurado." }
        : { configurado: false, proveedor: "resend", remitente: null, detalle: "Falta CORREO_REMITENTE (un correo de un dominio verificado en Resend)." };
    }
    if (env.SMTP_HOST) {
      const faltan = ["SMTP_USER", "SMTP_PASS"].filter((v) => !env[v]);
      const remitente = env.CORREO_REMITENTE ?? env.SMTP_USER ?? null;
      if (faltan.length > 0 || !remitente) {
        return { configurado: false, proveedor: "smtp", remitente, detalle: `Falta configurar ${faltan.join(" y ") || "CORREO_REMITENTE"} en el servidor.` };
      }
      return { configurado: true, proveedor: "smtp", remitente, detalle: `SMTP ${env.SMTP_HOST} configurado.` };
    }
    return {
      configurado: false,
      proveedor: null,
      remitente: null,
      detalle: "El servidor no tiene correo configurado (SMTP_HOST/SMTP_USER/SMTP_PASS o RESEND_API_KEY). Ver docs/correo.md.",
    };
  }

  /** Separa "a@x.com, b@y.com; c@z.com" en direcciones válidas y únicas. */
  static normalizarDestinatarios(entrada: string | string[]): string[] {
    const lista = Array.isArray(entrada) ? entrada : String(entrada ?? "").split(/[,;\s]+/);
    const vistos = new Set<string>();
    for (const d of lista) {
      const limpio = d.trim().toLowerCase();
      if (limpio && CORREO_VALIDO.test(limpio)) vistos.add(limpio);
    }
    return [...vistos];
  }

  async enviar(correo: CorreoSaliente): Promise<{ enviadoA: string[]; proveedor: "smtp" | "resend" }> {
    const estado = this.estado();
    if (!estado.configurado || !estado.proveedor || !estado.remitente) throw new ServiceUnavailableException(estado.detalle);
    const destinatarios = CorreoService.normalizarDestinatarios(correo.destinatarios);
    if (destinatarios.length === 0) throw new ServiceUnavailableException("No hay destinatarios válidos.");

    if (estado.proveedor === "resend") {
      await this.enviarConResend(estado.remitente, destinatarios, correo);
    } else {
      await this.enviarConSmtp(estado.remitente, destinatarios, correo);
    }
    this.logger.log(`Correo "${correo.asunto}" enviado por ${estado.proveedor} a ${destinatarios.join(", ")}`);
    return { enviadoA: destinatarios, proveedor: estado.proveedor };
  }

  private async enviarConSmtp(remitente: string, destinatarios: string[], correo: CorreoSaliente) {
    const puerto = Number(process.env.SMTP_PORT ?? 587);
    const transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: puerto,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : puerto === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporte.sendMail({
      from: process.env.CORREO_REMITENTE_NOMBRE ? `"${process.env.CORREO_REMITENTE_NOMBRE}" <${remitente}>` : remitente,
      to: destinatarios.join(", "),
      subject: correo.asunto,
      text: correo.texto,
      html: correo.html,
      attachments: (correo.adjuntos ?? []).map((a) => ({ filename: a.nombre, content: a.contenidoBase64, encoding: "base64", contentType: a.tipo })),
    });
  }

  private async enviarConResend(remitente: string, destinatarios: string[], correo: CorreoSaliente) {
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.CORREO_REMITENTE_NOMBRE ? `${process.env.CORREO_REMITENTE_NOMBRE} <${remitente}>` : remitente,
        to: destinatarios,
        subject: correo.asunto,
        html: correo.html,
        text: correo.texto,
        attachments: (correo.adjuntos ?? []).map((a) => ({ filename: a.nombre, content: a.contenidoBase64 })),
      }),
    });
    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => "");
      throw new ServiceUnavailableException(`Resend respondió ${respuesta.status}: ${cuerpo.slice(0, 300)}`);
    }
  }
}
