"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";

type Proveedor = "gmail" | "outlook" | "otro";
type Seguridad = "STARTTLS" | "SSL" | "NINGUNA";

interface Configuracion {
  existe: boolean;
  proveedor: Proveedor;
  host: string;
  puerto: number;
  seguridad: Seguridad;
  usuario: string;
  tienePassword: boolean;
  remitenteNombre: string;
  remitenteCorreo: string;
  activo: boolean;
  ultimaPruebaEn: string | null;
  ultimaPruebaOk: boolean | null;
  ultimoError: string | null;
  servidor: { configurado: boolean; detalle: string; remitente: string | null };
}

const PRESETS: Record<Proveedor, { host: string; puerto: number; seguridad: Seguridad }> = {
  gmail: { host: "smtp.gmail.com", puerto: 587, seguridad: "STARTTLS" },
  outlook: { host: "smtp.office365.com", puerto: 587, seguridad: "STARTTLS" },
  otro: { host: "", puerto: 587, seguridad: "STARTTLS" },
};

const AYUDA_PROVEEDOR: Record<Proveedor, string> = {
  gmail: "Gmail pide una «contraseña de aplicación» (no su contraseña normal): Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones.",
  outlook: "Outlook / Microsoft 365: usa la contraseña de la cuenta; si tiene verificación en dos pasos, genera una contraseña de aplicación en Seguridad de la cuenta Microsoft.",
  otro: "Datos SMTP que te dé tu proveedor de hosting o de correo (servidor, puerto y si usa STARTTLS o SSL).",
};

const estiloInput: React.CSSProperties = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontSize: 15, background: "var(--h421-white)", color: "inherit" };
const estiloEtiqueta: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, margin: "12px 0 4px" };

/**
 * Admin → Correo (solo Admin. corporativo): la cuenta desde la que el ERP envía los reportes de
 * inventario y la lista de compras. Mismo formulario que el de Licencias Galaviz: proveedor,
 * servidor, puerto y seguridad, usuario, contraseña (en blanco = conservar la guardada; viaja una
 * sola vez y el servidor la guarda cifrada), nombre del remitente, y "Guardar y enviar prueba".
 */
export default function CorreoPage() {
  const { contexto } = useAuthCrm();
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [form, setForm] = useState({ proveedor: "gmail" as Proveedor, host: PRESETS.gmail.host, puerto: "587", seguridad: "STARTTLS" as Seguridad, usuario: "", password: "", remitenteNombre: "HANGAR 421", remitenteCorreo: "", activo: true });
  const [verPassword, setVerPassword] = useState(false);
  const [destinatarioPrueba, setDestinatarioPrueba] = useState("");
  const [guardando, setGuardando] = useState<"" | "guardar" | "prueba">("");
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  const esAdmin = contexto?.rol === "ADMIN_CORPORATIVO";

  async function cargar() {
    const c = await apiFetch<Configuracion>("/correo/configuracion");
    setConfig(c);
    if (c.existe) {
      setForm({ proveedor: c.proveedor, host: c.host, puerto: String(c.puerto), seguridad: c.seguridad, usuario: c.usuario, password: "", remitenteNombre: c.remitenteNombre || "HANGAR 421", remitenteCorreo: c.remitenteCorreo, activo: c.activo });
    }
  }

  useEffect(() => {
    if (!contexto || !esAdmin) return;
    cargar().catch((e) => setMensaje({ ok: false, texto: (e as Error).message }));
    const correoUsuario = (contexto.usuario as { email?: string }).email;
    if (correoUsuario) setDestinatarioPrueba(correoUsuario);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto, esAdmin]);

  function cambiarProveedor(p: Proveedor) {
    setForm((f) => ({ ...f, proveedor: p, host: PRESETS[p].host || f.host, puerto: String(PRESETS[p].puerto), seguridad: PRESETS[p].seguridad }));
  }

  function cambiarSeguridad(s: Seguridad) {
    // Puerto típico de cada modo, solo si el usuario no escribió uno distinto a los conocidos.
    const puertoActual = Number(form.puerto);
    const puerto = s === "SSL" && (puertoActual === 587 || puertoActual === 25) ? "465" : s !== "SSL" && puertoActual === 465 ? "587" : form.puerto;
    setForm((f) => ({ ...f, seguridad: s, puerto }));
  }

  async function guardar(conPrueba: boolean) {
    setMensaje(null);
    if (!form.usuario.trim()) { setMensaje({ ok: false, texto: "Captura el correo (usuario) de la cuenta que envía." }); return; }
    if (!form.password && !config?.tienePassword) { setMensaje({ ok: false, texto: "Captura la contraseña (en Gmail, la contraseña de aplicación)." }); return; }
    if (conPrueba && !destinatarioPrueba.trim()) { setMensaje({ ok: false, texto: "Captura a qué correo mandar la prueba." }); return; }
    setGuardando(conPrueba ? "prueba" : "guardar");
    try {
      const guardada = await apiFetch<Configuracion>("/correo/configuracion", {
        method: "PUT",
        body: JSON.stringify({
          proveedor: form.proveedor, host: form.host.trim(), puerto: Number(form.puerto), seguridad: form.seguridad,
          usuario: form.usuario.trim(), password: form.password || undefined,
          remitenteNombre: form.remitenteNombre.trim(), remitenteCorreo: form.remitenteCorreo.trim() || undefined, activo: form.activo,
        }),
      });
      setConfig(guardada);
      setForm((f) => ({ ...f, password: "" }));
      if (!conPrueba) { setMensaje({ ok: true, texto: "Configuración guardada. La contraseña quedó cifrada en el servidor." }); return; }
      const r = await apiFetch<{ enviadoA: string[] }>("/correo/prueba", { method: "POST", body: JSON.stringify({ destinatario: destinatarioPrueba.trim() }) });
      setMensaje({ ok: true, texto: `Guardado y correo de prueba enviado a ${r.enviadoA.join(", ")}. Revisa la bandeja (y la carpeta de spam la primera vez).` });
      cargar().catch(() => {});
    } catch (e) {
      setMensaje({ ok: false, texto: (e as Error).message || "No se pudo guardar." });
      cargar().catch(() => {});
    } finally {
      setGuardando("");
    }
  }

  if (contexto && !esAdmin) {
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>Correo</h1>
        <div className="card">Solo el Administrador corporativo puede configurar el correo de la empresa.</div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>✉️ Correo saliente</h1>
      <p style={{ color: "var(--h421-gray-400)", marginTop: -8, fontSize: 14 }}>
        La cuenta desde la que el ERP envía el <strong>reporte de inventario</strong> y la <strong>lista de compras</strong> (Inventario → Generar Reporte / Lista de Compras → Enviar por correo). Solo administradores.
      </p>

      {config && (
        <div className="card" style={{ borderLeft: `4px solid ${config.existe && config.activo ? "var(--h421-green)" : config.servidor.configurado ? "var(--h421-blue)" : "var(--h421-amber)"}`, marginBottom: 16, fontSize: 14 }}>
          {config.existe && config.activo ? (
            <>
              <strong>Configurado:</strong> se envía desde <strong>{config.remitenteCorreo || config.usuario}</strong> ({config.host}:{config.puerto}).
              {config.ultimaPruebaEn && (
                <div style={{ marginTop: 4, color: config.ultimaPruebaOk ? "var(--h421-green)" : "var(--h421-red-texto)" }}>
                  Última prueba {new Date(config.ultimaPruebaEn).toLocaleString("es-MX")}: {config.ultimaPruebaOk ? "✓ correcta" : `✕ falló — ${config.ultimoError ?? ""}`}
                </div>
              )}
            </>
          ) : config.existe ? (
            <><strong>Desactivado.</strong> {config.servidor.configurado ? `Se usa el correo del servidor (${config.servidor.remitente}).` : "Los reportes no se pueden enviar por correo hasta activarlo."}</>
          ) : config.servidor.configurado ? (
            <><strong>Sin configuración propia.</strong> Por ahora se envía con el correo del servidor ({config.servidor.remitente}); si capturas uno aquí, se usará este.</>
          ) : (
            <><strong>Todavía no hay correo configurado.</strong> Captura la cuenta abajo y guarda; mientras tanto el botón "Enviar por correo" de Inventario ofrece abrir tu correo con el PDF descargado.</>
          )}
        </div>
      )}

      <div className="card" style={{ maxWidth: 640 }}>
        <label style={estiloEtiqueta}>Proveedor</label>
        <select value={form.proveedor} onChange={(e) => cambiarProveedor(e.target.value as Proveedor)} style={estiloInput}>
          <option value="gmail">Gmail</option>
          <option value="outlook">Outlook / Microsoft 365</option>
          <option value="otro">Otro (SMTP)</option>
        </select>
        <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "6px 0 0" }}>{AYUDA_PROVEEDOR[form.proveedor]}</p>

        <label style={estiloEtiqueta}>Servidor SMTP</label>
        <input value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} placeholder="smtp.tudominio.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={estiloInput} />

        <label style={estiloEtiqueta}>Puerto y seguridad</label>
        <div style={{ display: "flex", gap: 10 }}>
          <input value={form.puerto} onChange={(e) => setForm((f) => ({ ...f, puerto: e.target.value.replace(/\D/g, "") }))} inputMode="numeric" style={{ ...estiloInput, width: 110 }} />
          <select value={form.seguridad} onChange={(e) => cambiarSeguridad(e.target.value as Seguridad)} style={{ ...estiloInput, flex: 1 }}>
            <option value="STARTTLS">STARTTLS (587)</option>
            <option value="SSL">SSL / TLS (465)</option>
            <option value="NINGUNA">Sin cifrado (25) — no recomendado</option>
          </select>
        </div>

        <label style={estiloEtiqueta}>Correo (usuario)</label>
        <input value={form.usuario} onChange={(e) => setForm((f) => ({ ...f, usuario: e.target.value }))} placeholder="tucorreo@gmail.com" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" style={estiloInput} />

        <label style={estiloEtiqueta}>Contraseña{config?.tienePassword ? " (déjela en blanco para conservar la guardada)" : ""}</label>
        <div style={{ position: "relative" }}>
          <input type={verPassword ? "text" : "password"} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder={config?.tienePassword ? "••••••••  (guardada)" : form.proveedor === "gmail" ? "Contraseña de aplicación de 16 letras" : "Contraseña"}
            autoComplete="new-password" style={{ ...estiloInput, paddingRight: 44 }} />
          <button type="button" onClick={() => setVerPassword((v) => !v)} title={verPassword ? "Ocultar" : "Ver"}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", padding: "4px 8px", minHeight: 0, fontSize: 16 }}>
            {verPassword ? "🙈" : "👁"}
          </button>
        </div>

        <label style={estiloEtiqueta}>Nombre que verá el destinatario como remitente</label>
        <input value={form.remitenteNombre} onChange={(e) => setForm((f) => ({ ...f, remitenteNombre: e.target.value }))} placeholder="HANGAR 421" style={estiloInput} />

        <label style={estiloEtiqueta}>Correo remitente (opcional, si es distinto al usuario)</label>
        <input value={form.remitenteCorreo} onChange={(e) => setForm((f) => ({ ...f, remitenteCorreo: e.target.value }))} placeholder={form.usuario || "reportes@tudominio.com"} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={estiloInput} />

        <label style={{ ...estiloEtiqueta, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.activo} onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))} /> Activo (usar esta cuenta para enviar)
        </label>

        <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "10px 0 0" }}>
          La contraseña se envía una sola vez al servidor, se guarda cifrada y nunca vuelve a mostrarse; solo el servidor la usa para enviar.
        </p>

        <label style={estiloEtiqueta}>Enviar prueba a</label>
        <input value={destinatarioPrueba} onChange={(e) => setDestinatarioPrueba(e.target.value)} placeholder="tucorreo@ejemplo.com" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={estiloInput} />

        {mensaje && (
          <p style={{ marginTop: 12, fontWeight: 700, color: mensaje.ok ? "var(--h421-green)" : "var(--h421-red-texto)", fontSize: 14 }}>{mensaje.texto}</p>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={() => guardar(true)} disabled={!!guardando} style={{ background: "var(--h421-navy)", color: "#fff", padding: "10px 16px", fontSize: 14 }}>
            {guardando === "prueba" ? "Enviando prueba…" : "✉ Guardar y enviar prueba"}
          </button>
          <button onClick={() => cargar()} disabled={!!guardando} style={{ background: "var(--h421-gray-50)", padding: "10px 16px", fontSize: 14 }}>Cancelar</button>
          <button onClick={() => guardar(false)} disabled={!!guardando} style={{ background: "var(--h421-green)", color: "#fff", padding: "10px 16px", fontSize: 14 }}>
            {guardando === "guardar" ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
