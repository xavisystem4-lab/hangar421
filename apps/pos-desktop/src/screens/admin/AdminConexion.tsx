import { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";

interface InfoConexion {
  ip: string | null;
  puerto: number | null;
  puertoPreferido: number | null;
}

interface TabletConectada {
  dispositivoId?: string;
  usuarioNombre?: string;
  ip: string;
  conectadoDesde: string;
}

function tiempoTranscurrido(iso: string): string {
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return "hace segundos";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `hace ${horas}h ${minutos % 60}min`;
}

/** IP LAN de esta PC + puerto del backend embebido — el dato exacto que hay que capturar en el
 *  módulo de conexión (⚙ Estación) de la app de Meseros para que la tablet encuentre esta PC en
 *  la misma red Wi-Fi. La IP se detecta sola, pero esa detección puede equivocarse (ej. un
 *  adaptador de VPN con nombre "normal" se coló antes que la red real en un caso real de
 *  producción) — por eso ambos campos son editables: si algo no cuadra, el admin los corrige a
 *  mano y quedan guardados (ver electron/main.ts, IPC "backend:guardarInfoConexion"). */
export function AdminConexion() {
  const sucursalId = useAuthStore((s) => s.sucursalId);
  const [info, setInfo] = useState<InfoConexion | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [ipManual, setIpManual] = useState("");
  const [puertoManual, setPuertoManual] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [tablets, setTablets] = useState<TabletConectada[] | null>(null);

  function cargar() {
    window.hangar?.backend
      ?.obtenerInfoConexion()
      .then((r) => {
        setInfo(r);
        setIpManual(r.ip ?? "");
        setPuertoManual(r.puertoPreferido ? String(r.puertoPreferido) : "3000");
      })
      .catch(() => setInfo({ ip: null, puerto: null, puertoPreferido: null }));
  }

  useEffect(cargar, []);

  // Tablets de meseros conectadas ahora mismo (ver realtime.gateway.ts) — se refresca sola cada
  // 10s para que el admin no tenga que ir y venir de la pantalla para saber si de verdad todas
  // las tablets del local están enlazadas a esta Estación.
  useEffect(() => {
    if (!sucursalId) return;
    let vivo = true;
    const cargarTablets = () => {
      apiFetch<TabletConectada[]>(`/realtime/conectados?sucursalId=${sucursalId}`)
        .then((r) => vivo && setTablets(r))
        .catch(() => vivo && setTablets([]));
    };
    cargarTablets();
    const t = setInterval(cargarTablets, 10_000);
    return () => { vivo = false; clearInterval(t); };
  }, [sucursalId]);

  const texto = info?.ip && info.puerto ? `${info.ip}:${info.puerto}` : null;

  function copiar() {
    if (!texto) return;
    navigator.clipboard?.writeText(texto).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });
  }

  async function guardar() {
    setMensaje(null);
    setGuardando(true);
    try {
      await window.hangar!.backend.guardarInfoConexion(ipManual.trim(), Number(puertoManual) || 0);
      setMensaje("✓ Guardado. El puerto nuevo aplica hasta que reinicies el POS — la IP aplica de inmediato.");
      cargar();
    } catch (e: any) {
      setMensaje(`✕ ${e.message ?? "No se pudo guardar"}`);
    } finally {
      setGuardando(false);
    }
  }

  async function restablecerAutomatico() {
    setMensaje(null);
    setGuardando(true);
    try {
      await window.hangar!.backend.guardarInfoConexion("", 0);
      setMensaje("✓ Vuelto a detección automática (IP) y puerto 3000.");
      cargar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>Conexión para la app de Meseros</h2>
      <p style={{ color: "var(--h421-gray-400)", fontSize: 14, marginTop: 0, marginBottom: 20, lineHeight: 1.5 }}>
        En cada tablet de mesero, la primera vez que abre la app (o al tocar "⚙ Estación" en el login), pide la
        IP y el puerto de esta PC. Captura exactamente lo de abajo — la tablet tiene que estar conectada a la
        misma red Wi-Fi que esta PC.
      </p>

      {info === null && <p style={{ color: "var(--h421-gray-400)" }}>Buscando…</p>}

      {info && !texto && (
        <p style={{ color: "var(--h421-red)" }}>
          Esta instalación usa un backend en la nube configurado (no un backend local embebido), así que no hay
          una IP:puerto de PC que capturar — en ese caso la app de Meseros debe apuntar directo a la URL del
          backend en la nube.
        </p>
      )}

      {texto && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            background: "var(--h421-gray-50)", border: "1px solid var(--h421-gray-200)", borderRadius: 12,
            padding: "16px 20px", fontSize: 28, fontWeight: 800, fontFamily: "monospace", letterSpacing: 0.5,
            color: "var(--h421-navy-texto)",
          }}>
            {texto}
          </div>
          <button onClick={copiar} className="btn-grande" style={{ background: "var(--h421-navy)", color: "#fff", padding: "10px 18px" }}>
            {copiado ? "✓ Copiado" : "Copiar"}
          </button>
        </div>
      )}

      {info && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--h421-gray-200)" }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>¿La IP o el puerto no son correctos?</h3>
          <p style={{ color: "var(--h421-gray-400)", fontSize: 12, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
            La detección automática puede equivocarse (por ejemplo si esta PC tiene una VPN instalada). Corrígelos
            aquí a mano — quedan guardados aunque reinicies el POS.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ flex: 2, fontSize: 12, color: "var(--h421-gray-400)" }}>
              IP manual
              <input
                value={ipManual}
                onChange={(e) => setIpManual(e.target.value)}
                placeholder="192.168.1.100"
                style={{ width: "100%", marginTop: 4, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontFamily: "monospace" }}
              />
            </label>
            <label style={{ flex: 1, fontSize: 12, color: "var(--h421-gray-400)" }}>
              Puerto preferido
              <input
                value={puertoManual}
                onChange={(e) => setPuertoManual(e.target.value.replace(/\D/g, ""))}
                placeholder="3000"
                style={{ width: "100%", marginTop: 4, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontFamily: "monospace" }}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={guardar} disabled={guardando} className="btn-grande" style={{ background: "var(--h421-esmeralda)", color: "#fff", padding: "10px 18px" }}>
              Guardar
            </button>
            <button onClick={restablecerAutomatico} disabled={guardando} style={{ background: "var(--h421-gray-50)", padding: "10px 18px" }}>
              Restablecer automático
            </button>
          </div>
          {mensaje && <p style={{ marginTop: 10, fontSize: 13, color: mensaje.startsWith("✓") ? "var(--h421-green)" : "var(--h421-red)" }}>{mensaje}</p>}
        </div>
      )}

      <p style={{ color: "var(--h421-gray-400)", fontSize: 12, marginTop: 18, lineHeight: 1.5 }}>
        La IP puede cambiar si esta PC se reconecta a otra red o el router reasigna direcciones — si algún día
        las tablets dejan de conectar, vuelve a revisar este dato aquí primero. El puerto real ahora mismo es
        {" "}{info?.puerto ?? 3000} — si cambiaste el "puerto preferido" arriba, se toma en cuenta hasta el
        próximo reinicio del POS.
      </p>

      <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--h421-gray-200)" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Tablets conectadas ahora mismo</h3>
        <p style={{ color: "var(--h421-gray-400)", fontSize: 12, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Se actualiza sola cada 10s. Si un mesero no aparece aquí, revisa que su app tenga sesión iniciada y esté
          conectada a esta misma Estación.
        </p>

        {tablets === null && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Buscando…</p>}
        {tablets && tablets.length === 0 && (
          <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Ninguna tablet de mesero conectada ahora mismo.</p>
        )}
        {tablets && tablets.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tablets.map((t, i) => (
              <div
                key={t.dispositivoId ?? i}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "var(--h421-gray-50)", borderRadius: 10, padding: "10px 14px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--h421-green)", display: "inline-block" }} />
                  <strong style={{ fontSize: 14 }}>{t.usuarioNombre ?? "Mesero"}</strong>
                </div>
                <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--h421-gray-400)" }}>{t.ip}</span>
                <span style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>{tiempoTranscurrido(t.conectadoDesde)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
