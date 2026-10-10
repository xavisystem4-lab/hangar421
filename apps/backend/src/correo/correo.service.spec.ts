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
    const estado = new CorreoService().estadoServidor();
    expect(estado.configurado).toBe(false);
    expect(estado.proveedor).toBeNull();
  });

  it("con SMTP completo queda configurado con SMTP_USER como remitente por defecto", () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_USER = "reportes@hangar421.com";
    process.env.SMTP_PASS = "secreto";
    delete process.env.CORREO_REMITENTE;
    delete process.env.RESEND_API_KEY;
    expect(new CorreoService().estadoServidor()).toMatchObject({ configurado: true, proveedor: "smtp", remitente: "reportes@hangar421.com" });
  });

  it("con SMTP incompleto dice qué falta", () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.RESEND_API_KEY;
    const estado = new CorreoService().estadoServidor();
    expect(estado.configurado).toBe(false);
    expect(estado.detalle).toContain("SMTP_USER");
  });

  it("Resend exige remitente de dominio verificado y gana sobre SMTP", () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.SMTP_HOST = "smtp.gmail.com";
    delete process.env.CORREO_REMITENTE;
    expect(new CorreoService().estadoServidor()).toMatchObject({ configurado: false, proveedor: "resend" });
    process.env.CORREO_REMITENTE = "reportes@hangar421.com";
    expect(new CorreoService().estadoServidor()).toMatchObject({ configurado: true, proveedor: "resend" });
  });

  it("estado(empresaId) sin base ni variables cae al estado del servidor", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    await expect(new CorreoService().estado("empresa-1")).resolves.toMatchObject({ configurado: false, origen: null });
  });

  it("estado(empresaId) usa la configuración de la empresa (contraseña descifrada) antes que la del servidor", async () => {
    process.env.SMTP_HOST = "smtp.servidor.com";
    process.env.SMTP_USER = "servidor@x.com";
    process.env.SMTP_PASS = "s";
    const prisma = { configuracionCorreo: { findUnique: jest.fn().mockResolvedValue({ activo: true, passwordCifrado: "cifrado", host: "smtp.gmail.com", puerto: 587, seguridad: "STARTTLS", usuario: "cafe@gmail.com", remitenteCorreo: "cafe@gmail.com", remitenteNombre: "HANGAR 421" }) } };
    const cifrado = { descifrar: jest.fn().mockReturnValue("app-pass"), cifrar: jest.fn() };
    const estado = await new CorreoService(prisma as any, cifrado as any).estado("empresa-1");
    expect(estado).toMatchObject({ configurado: true, origen: "empresa", proveedor: "smtp", remitente: "cafe@gmail.com" });
    expect(cifrado.descifrar).toHaveBeenCalledWith("cifrado");
  });

  it("guardarConfiguracion cifra la contraseña nueva y conserva la guardada si viene vacía", async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const findUnique = jest.fn().mockResolvedValue({ passwordCifrado: "anterior" });
    const prisma = { configuracionCorreo: { findUnique, upsert } };
    const cifrado = { cifrar: jest.fn((t: string) => `enc(${t})`), descifrar: jest.fn() };
    const servicio = new CorreoService(prisma as any, cifrado as any);
    await servicio.guardarConfiguracion("e1", { proveedor: "gmail", host: "", puerto: 0, seguridad: "STARTTLS", usuario: "Cafe@gmail.com", password: "nueva" });
    expect(upsert.mock.calls[0][0].create).toMatchObject({ host: "smtp.gmail.com", puerto: 587, passwordCifrado: "enc(nueva)", remitenteCorreo: "cafe@gmail.com" });
    await servicio.guardarConfiguracion("e1", { proveedor: "gmail", host: "smtp.gmail.com", puerto: 587, seguridad: "STARTTLS", usuario: "cafe@gmail.com", password: "" });
    expect(upsert.mock.calls[1][0].update.passwordCifrado).toBe("anterior");
  });

  it("guardarConfiguracion exige contraseña la primera vez", async () => {
    const prisma = { configuracionCorreo: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() } };
    const cifrado = { cifrar: jest.fn(), descifrar: jest.fn() };
    await expect(new CorreoService(prisma as any, cifrado as any).guardarConfiguracion("e1", { proveedor: "gmail", host: "smtp.gmail.com", puerto: 587, seguridad: "STARTTLS", usuario: "cafe@gmail.com" })).rejects.toThrow(/contraseña/);
  });

  it("explica el error de autenticación de Gmail en palabras", () => {
    const t = { origen: "empresa", tipo: "smtp", remitente: "a@gmail.com", smtp: { host: "smtp.gmail.com", puerto: 587, seguridad: "STARTTLS", usuario: "a", password: "b" } } as any;
    expect(CorreoService.explicarError({ responseCode: 535, message: "Username and Password not accepted" }, t)).toContain("contraseña de aplicación");
    expect(CorreoService.explicarError({ code: "ECONNECTION", message: "connect ECONNREFUSED" }, t)).toContain("smtp.gmail.com:587");
  });

  it("enviar() rechaza cuando no hay correo configurado", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    await expect(new CorreoService().enviar({ destinatarios: ["a@b.co"], asunto: "x", html: "<p>x</p>" })).rejects.toThrow();
  });
});
