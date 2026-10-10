import { BadRequestException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import { CifradoService } from "../common/crypto/cifrado.service";

export const CIFRADO_CORREO = "CIFRADO_CORREO";

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

export type ProveedorCorreo = "gmail" | "outlook" | "otro";
export type SeguridadSmtp = "STARTTLS" | "SSL" | "NINGUNA";

export interface EstadoCorreo {
  configurado: boolean;
  /** De dónde sale la configuración: la empresa la capturó en Admin → Correo, o variables del servidor. */
  origen: "empresa" | "servidor" | null;
  proveedor: "smtp" | "resend" | null;
  remitente: string | null;
  /** Qué falta configurar, en palabras para el administrador. */
  detalle: string;
}

/** Lo que ve/edita el admin en Admin → Correo (la contraseña nunca viaja de regreso). */
export interface ConfiguracionCorreoVista {
  existe: boolean;
  proveedor: ProveedorCorreo;
  host: string;
  puerto: number;
  seguridad: SeguridadSmtp;
  usuario: string;
  tienePassword: boolean;
  remitenteNombre: string;
  remitenteCorreo: string;
  activo: boolean;
  ultimaPruebaEn: string | null;
  ultimaPruebaOk: boolean | null;
  ultimoError: string | null;
  /** Si no hay configuración de la empresa, qué tiene el servidor por variables de entorno. */
  servidor: EstadoCorreo;
}

export interface GuardarConfiguracionCorreo {
  proveedor: ProveedorCorreo;
  host: string;
  puerto: number;
  seguridad: SeguridadSmtp;
  usuario: string;
  /** Vacía o ausente = conservar la guardada. */
  password?: string;
  remitenteNombre?: string;
  remitenteCorreo?: string;
  activo?: boolean;
}

/** Valores por defecto por proveedor — los mismos que ofrece el formulario del ERP. */
export const PRESETS_CORREO: Record<ProveedorCorreo, { host: string; puerto: number; seguridad: SeguridadSmtp }> = {
  gmail: { host: "smtp.gmail.com", puerto: 587, seguridad: "STARTTLS" },
  outlook: { host: "smtp.office365.com", puerto: 587, seguridad: "STARTTLS" },
  otro: { host: "", puerto: 587, seguridad: "STARTTLS" },
};

interface TransporteResuelto {
  origen: "empresa" | "servidor";
  tipo: "smtp" | "resend";
  remitente: string;
  remitenteNombre?: string;
  smtp?: { host: string; puerto: number; seguridad: SeguridadSmtp; usuario: string; password: string };
  resendApiKey?: string;
}

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Envío de correo del ERP (reportes de inventario, lista de compras). La configuración sale, en
 * este orden:
 *
 *  1. Lo que la empresa capturó en **Admin → Correo** (tabla configuracion_correo; contraseña
 *     cifrada con CORREO_CIFRADO_KEY o, si no existe, PAGOS_CIFRADO_KEY).
 *  2. Variables de entorno del servidor: SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (+
 *     CORREO_REMITENTE opcional) o RESEND_API_KEY + CORREO_REMITENTE. Ver docs/correo.md.
 *
 * Si no hay ninguna, `estado()` lo dice y el ERP ofrece abrir el correo del usuario con el PDF.
 */
@Injectable()
export class CorreoService {
  private readonly logger = new Logger(CorreoService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() @Inject(CIFRADO_CORREO) private readonly cifrado?: CifradoService,
  ) {}

  // ---------------------------------------------------------------- configuración por empresa

  async obtenerConfiguracion(empresaId: string): Promise<ConfiguracionCorreoVista> {
    const fila = this.prisma ? await this.prisma.configuracionCorreo.findUnique({ where: { empresaId } }) : null;
    const servidor = this.estadoServidor();
    if (!fila) {
      return {
        existe: false, proveedor: "gmail", ...PRESETS_CORREO.gmail, usuario: "", tienePassword: false,
        remitenteNombre: "", remitenteCorreo: "", activo: true, ultimaPruebaEn: null, ultimaPruebaOk: null, ultimoError: null, servidor,
      };
    }
    return {
      existe: true,
      proveedor: (fila.proveedor as ProveedorCorreo) ?? "otro",
      host: fila.host,
      puerto: fila.puerto,
      seguridad: (fila.seguridad as SeguridadSmtp) ?? "STARTTLS",
      usuario: fila.usuario,
      tienePassword: !!fila.passwordCifrado,
      remitenteNombre: fila.remitenteNombre ?? "",
      remitenteCorreo: fila.remitenteCorreo ?? "",
      activo: fila.activo,
      ultimaPruebaEn: fila.ultimaPruebaEn?.toISOString() ?? null,
      ultimaPruebaOk: fila.ultimaPruebaOk,
      ultimoError: fila.ultimoError,
      servidor,
    };
  }

  async guardarConfiguracion(empresaId: string, datos: GuardarConfiguracionCorreo, actualizadoPorId?: string): Promise<ConfiguracionCorreoVista> {
    if (!this.prisma || !this.cifrado) throw new ServiceUnavailableException("El servidor no puede guardar la configuración de correo (falta la llave de cifrado).");
    const proveedor: ProveedorCorreo = (["gmail", "outlook", "otro"] as ProveedorCorreo[]).includes(datos.proveedor) ? datos.proveedor : "otro";
    const seguridad: SeguridadSmtp = (["STARTTLS", "SSL", "NINGUNA"] as SeguridadSmtp[]).includes(datos.seguridad) ? datos.seguridad : "STARTTLS";
    const host = String(datos.host ?? "").trim() || PRESETS_CORREO[proveedor].host;
    const puerto = Number(datos.puerto) || PRESETS_CORREO[proveedor].puerto;
    const usuario = String(datos.usuario ?? "").trim();
    const remitenteCorreo = String(datos.remitenteCorreo ?? "").trim().toLowerCase() || usuario.toLowerCase();
    if (!host) throw new BadRequestException("Captura el servidor SMTP.");
    if (!(puerto > 0 && puerto < 65536)) throw new BadRequestException("El puerto no es válido.");
    if (!usuario) throw new BadRequestException("Captura el correo (usuario) de la cuenta que envía.");
    if (!CORREO_VALIDO.test(remitenteCorreo)) throw new BadRequestException("El correo remitente no es válido.");

    const actual = await this.prisma.configuracionCorreo.findUnique({ where: { empresaId } });
    const password = String(datos.password ?? "");
    const passwordCifrado = password ? this.cifrado.cifrar(password) : actual?.passwordCifrado ?? null;
    if (!passwordCifrado) throw new BadRequestException("Captura la contraseña (en Gmail, la «contraseña de aplicación»).");

    const comunes = {
      proveedor, host, puerto, seguridad, usuario, passwordCifrado,
      remitenteNombre: String(datos.remitenteNombre ?? "").trim() || null,
      remitenteCorreo,
      activo: datos.activo ?? true,
      actualizadoPorId: actualizadoPorId ?? null,
    };
    await this.prisma.configuracionCorreo.upsert({
      where: { empresaId },
      update: { ...comunes, ...(password ? { ultimaPruebaEn: null, ultimaPruebaOk: null, ultimoError: null } : {}) },
      create: { empresaId, ...comunes },
    });
    this.logger.log(`Configuración de correo de la empresa ${empresaId} guardada (${proveedor}, ${host}:${puerto}, ${usuario})`);
    return this.obtenerConfiguracion(empresaId);
  }

  /** Manda un correo de prueba con la configuración guardada y deja el resultado en la fila. */
  async enviarPrueba(empresaId: string, destinatario: string, nombreUsuario?: string) {
    const destinatarios = CorreoService.normalizarDestinatarios(destinatario);
    if (destinatarios.length === 0) throw new BadRequestException("Captura un correo válido para la prueba.");
    const fecha = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" });
    try {
      const r = await this.enviar({
        destinatarios,
        asunto: "Prueba de correo · HANGAR 421 ERP",
        html: `<div style="font-family:Arial,sans-serif;color:#111318"><h2 style="color:#0b1e33">HANGAR 421</h2><p>Este es un correo de prueba enviado desde el ERP el ${fecha}${nombreUsuario ? ` por ${nombreUsuario}` : ""}.</p><p>Si lo estás leyendo, el envío de reportes de inventario y listas de compras ya funciona. ✅</p></div>`,
        texto: `Correo de prueba del ERP HANGAR 421 (${fecha}). Si lo lees, el envío ya funciona.`,
      }, empresaId);
      await this.registrarPrueba(empresaId, true, null);
      return { ok: true, enviadoA: r.enviadoA, proveedor: r.proveedor, origen: r.origen };
    } catch (e) {
      const mensaje = (e as Error)?.message ?? "Error desconocido";
      await this.registrarPrueba(empresaId, false, mensaje);
      throw e;
    }
  }

  private async registrarPrueba(empresaId: string, ok: boolean, error: string | null) {
    if (!this.prisma) return;
    try {
      await this.prisma.configuracionCorreo.updateMany({ where: { empresaId }, data: { ultimaPruebaEn: new Date(), ultimaPruebaOk: ok, ultimoError: error?.slice(0, 500) ?? null } });
    } catch {
      /* sin fila (configuración solo por servidor): no hay dónde anotarlo */
    }
  }

  // ---------------------------------------------------------------- resolución y estado

  private async transporteDe(empresaId?: string): Promise<TransporteResuelto | null> {
    if (empresaId && this.prisma && this.cifrado) {
      const fila = await this.prisma.configuracionCorreo.findUnique({ where: { empresaId } });
      if (fila?.activo && fila.passwordCifrado) {
        return {
          origen: "empresa",
          tipo: "smtp",
          remitente: fila.remitenteCorreo ?? fila.usuario,
          remitenteNombre: fila.remitenteNombre ?? undefined,
          smtp: { host: fila.host, puerto: fila.puerto, seguridad: fila.seguridad as SeguridadSmtp, usuario: fila.usuario, password: this.cifrado.descifrar(fila.passwordCifrado) },
        };
      }
    }
    return this.transporteServidor();
  }

  private transporteServidor(): TransporteResuelto | null {
    const env = process.env;
    if (env.RESEND_API_KEY && env.CORREO_REMITENTE) {
      return { origen: "servidor", tipo: "resend", remitente: env.CORREO_REMITENTE, remitenteNombre: env.CORREO_REMITENTE_NOMBRE, resendApiKey: env.RESEND_API_KEY };
    }
    if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
      const puerto = Number(env.SMTP_PORT ?? 587);
      const seguridad: SeguridadSmtp = env.SMTP_SECURE ? (env.SMTP_SECURE === "true" ? "SSL" : "STARTTLS") : puerto === 465 ? "SSL" : "STARTTLS";
      return {
        origen: "servidor", tipo: "smtp", remitente: env.CORREO_REMITENTE ?? env.SMTP_USER, remitenteNombre: env.CORREO_REMITENTE_NOMBRE,
        smtp: { host: env.SMTP_HOST, puerto, seguridad, usuario: env.SMTP_USER, password: env.SMTP_PASS },
      };
    }
    return null;
  }

  /** Estado de la configuración por variables de entorno del servidor (sin mirar la base). */
  estadoServidor(): EstadoCorreo {
    const env = process.env;
    const t = this.transporteServidor();
    if (t) return { configurado: true, origen: "servidor", proveedor: t.tipo, remitente: t.remitente, detalle: t.tipo === "resend" ? "Resend configurado en el servidor." : `SMTP ${t.smtp?.host} configurado en el servidor.` };
    if (env.RESEND_API_KEY) return { configurado: false, origen: null, proveedor: "resend", remitente: null, detalle: "Falta CORREO_REMITENTE (un correo de un dominio verificado en Resend)." };
    if (env.SMTP_HOST) {
      const faltan = ["SMTP_USER", "SMTP_PASS"].filter((v) => !env[v]);
      return { configurado: false, origen: null, proveedor: "smtp", remitente: null, detalle: `Falta configurar ${faltan.join(" y ")} en el servidor.` };
    }
    return { configurado: false, origen: null, proveedor: null, remitente: null, detalle: "Sin correo configurado: captúralo en Admin → Correo (solo administradores) o con variables SMTP_* en el servidor." };
  }

  /** Estado efectivo para una empresa: su configuración propia o, si no, la del servidor. */
  async estado(empresaId?: string): Promise<EstadoCorreo> {
    const t = await this.transporteDe(empresaId);
    if (!t) return this.estadoServidor();
    return {
      configurado: true,
      origen: t.origen,
      proveedor: t.tipo,
      remitente: t.remitente,
      detalle: t.origen === "empresa" ? `Correo de la empresa (${t.smtp?.host}).` : t.tipo === "resend" ? "Resend configurado en el servidor." : `SMTP ${t.smtp?.host} configurado en el servidor.`,
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

  // ---------------------------------------------------------------- envío

  async enviar(correo: CorreoSaliente, empresaId?: string): Promise<{ enviadoA: string[]; proveedor: "smtp" | "resend"; origen: "empresa" | "servidor" }> {
    const t = await this.transporteDe(empresaId);
    if (!t) throw new ServiceUnavailableException(this.estadoServidor().detalle);
    const destinatarios = CorreoService.normalizarDestinatarios(correo.destinatarios);
    if (destinatarios.length === 0) throw new ServiceUnavailableException("No hay destinatarios válidos.");

    try {
      if (t.tipo === "resend") await this.enviarConResend(t, destinatarios, correo);
      else await this.enviarConSmtp(t, destinatarios, correo);
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException(CorreoService.explicarError(e, t));
    }
    this.logger.log(`Correo "${correo.asunto}" enviado por ${t.tipo} (${t.origen}) a ${destinatarios.join(", ")}`);
    return { enviadoA: destinatarios, proveedor: t.tipo, origen: t.origen };
  }

  /** Traduce los errores típicos de SMTP a algo que el administrador pueda corregir. */
  static explicarError(e: unknown, t: TransporteResuelto): string {
    const err = e as { code?: string; responseCode?: number; message?: string };
    const msg = err?.message ?? String(e);
    if (err?.responseCode === 535 || /invalid login|username and password not accepted|authentication failed|5\.7\.8/i.test(msg)) {
      return t.smtp?.host.includes("gmail")
        ? "Gmail rechazó el usuario o la contraseña. Usa una «contraseña de aplicación» (Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones), no la contraseña normal."
        : "El servidor de correo rechazó el usuario o la contraseña.";
    }
    if (err?.code === "ECONNECTION" || err?.code === "ETIMEDOUT" || err?.code === "ESOCKET" || /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
      return `No se pudo conectar a ${t.smtp?.host}:${t.smtp?.puerto}. Revisa el servidor, el puerto y la seguridad (587 STARTTLS o 465 SSL).`;
    }
    if (/wrong version number|ssl/i.test(msg)) return "La seguridad no coincide con el puerto: usa STARTTLS con 587 o SSL con 465.";
    return `No se pudo enviar: ${msg.slice(0, 300)}`;
  }

  private async enviarConSmtp(t: TransporteResuelto, destinatarios: string[], correo: CorreoSaliente) {
    const smtp = t.smtp!;
    const transporte = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.puerto,
      secure: smtp.seguridad === "SSL",
      ignoreTLS: smtp.seguridad === "NINGUNA",
      requireTLS: smtp.seguridad === "STARTTLS",
      auth: { user: smtp.usuario, pass: smtp.password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    await transporte.sendMail({
      from: t.remitenteNombre ? `"${t.remitenteNombre.replace(/"/g, "'")}" <${t.remitente}>` : t.remitente,
      to: destinatarios.join(", "),
      subject: correo.asunto,
      text: correo.texto,
      html: correo.html,
      attachments: (correo.adjuntos ?? []).map((a) => ({ filename: a.nombre, content: a.contenidoBase64, encoding: "base64", contentType: a.tipo })),
    });
  }

  private async enviarConResend(t: TransporteResuelto, destinatarios: string[], correo: CorreoSaliente) {
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${t.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: t.remitenteNombre ? `${t.remitenteNombre} <${t.remitente}>` : t.remitente,
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
