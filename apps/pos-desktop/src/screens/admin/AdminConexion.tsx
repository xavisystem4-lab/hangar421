import { useEffect, useState } from "react";

interface InfoConexion {
  ip: string | null;
  puerto: number | null;
}

/** IP LAN de esta PC + puerto del backend embebido — el dato exacto que hay que capturar en el
 *  módulo de conexión (⚙ Estación) de la app de Meseros para que la tablet encuentre esta PC en
 *  la misma red Wi-Fi. Antes había que adivinarlo (el puerto se elegía al azar en cada arranque
 *  y no se mostraba en ningún lado) — ver electron/backend-manager.ts (puerto ahora fijo, 3000
 *  por defecto) y electron/main.ts (IPC "backend:obtenerInfoConexion"). */
export function AdminConexion() {
  const [info, setInfo] = useState<InfoConexion | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    window.hangar?.backend
      ?.obtenerInfoConexion()
      .then(setInfo)
      .catch(() => setInfo({ ip: null, puerto: null }));
  }, []);

  const texto = info?.ip && info.puerto ? `${info.ip}:${info.puerto}` : null;

  function copiar() {
    if (!texto) return;
    navigator.clipboard?.writeText(texto).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });
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

      <p style={{ color: "var(--h421-gray-400)", fontSize: 12, marginTop: 18, lineHeight: 1.5 }}>
        La IP puede cambiar si esta PC se reconecta a otra red o el router reasigna direcciones — si algún día
        las tablets dejan de conectar, vuelve a revisar este dato aquí primero. El puerto ({info?.puerto ?? 3000})
        se queda fijo entre reinicios del POS salvo que ya esté ocupado por otro programa.
      </p>
    </div>
  );
}
