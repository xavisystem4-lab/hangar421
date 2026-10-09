import { CorreoService } from "./correo.service";

describe("CorreoService", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("normaliza destinatarios: separa por coma/punto y coma/espacios, descarta inválidos y repetidos", () => {
    expect(CorreoService.normalizarDestinatarios("Compras@x.com, gerente@y.mx; compras@x.com  no-es-correo")).toEqual(["compras@x.com", "gerente@y.mx"]);
    expect(CorreoService.normalizarDestinatarios(["a@b.co", " "])).toEqual(["a@b.co"]);
  });

  it("sin variables de entorno no está configurado y lo explica", () => {
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    const estado = new CorreoService().estado();
    expect(estado.configurado).toBe(false);
    expect(estado.proveedor).toBeNull();
  });

  it("con SMTP completo queda configurado con SMTP_USER como remitente por defecto", () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_USER = "reportes@hangar421.com";
    process.env.SMTP_PASS = "secreto";
    delete process.env.CORREO_REMITENTE;
    delete process.env.RESEND_API_KEY;
    expect(new CorreoService().estado()).toMatchObject({ configurado: true, proveedor: "smtp", remitente: "reportes@hangar421.com" });
  });

  it("con SMTP incompleto dice qué falta", () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.RESEND_API_KEY;
    const estado = new CorreoService().estado();
    expect(estado.configurado).toBe(false);
    expect(estado.detalle).toContain("SMTP_USER");
  });

  it("Resend exige remitente de dominio verificado y gana sobre SMTP", () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.SMTP_HOST = "smtp.gmail.com";
    delete process.env.CORREO_REMITENTE;
    expect(new CorreoService().estado()).toMatchObject({ configurado: false, proveedor: "resend" });
    process.env.CORREO_REMITENTE = "reportes@hangar421.com";
    expect(new CorreoService().estado()).toMatchObject({ configurado: true, proveedor: "resend" });
  });

  it("enviar() rechaza cuando no hay correo configurado", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    await expect(new CorreoService().enviar({ destinatarios: ["a@b.co"], asunto: "x", html: "<p>x</p>" })).rejects.toThrow();
  });
});
