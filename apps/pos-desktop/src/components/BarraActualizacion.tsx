import { useEffect, useState } from "react";

type EstadoUpdater = "inactivo" | "verificando" | "descargando" | "descargada" | "al-dia" | "error";

/** Footer fijo: versión + crédito a la izquierda, botón de actualización + barra de
 *  progreso a la derecha — envuelve electron-updater vía IPC (ver electron/updater.ts). */
export function BarraActualizacion() {
  const [version, setVersion] = useState("");
  const [estado, setEstado] = useState<EstadoUpdater>("inactivo");
  const [progreso, setProgreso] = useState(0);
  const [versionNueva, setVersionNueva] = useState<string | null>(null);
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  useEffect(() => {
    window.hangar.appVersion().then(setVersion);

    const quitar = window.hangar.updater.onEvento((evento) => {
      switch (evento.tipo) {
        case "verificando":
          setEstado("verificando");
          break;
        case "disponible":
          setEstado("descargando");
          setVersionNueva((evento.data as any)?.version ?? null);
          setProgreso(0);
          break;
        case "progreso":
          setEstado("descargando");
          setProgreso((evento.data as any)?.porcentaje ?? 0);
          break;
        case "descargada":
          setEstado("descargada");
          setProgreso(100);
          break;
        case "al-dia":
          setEstado("al-dia");
          setTimeout(() => setEstado("inactivo"), 4000);
          break;
        case "error":
          setEstado("error");
          setMensajeError((evento.data as any)?.mensaje ?? "Error al actualizar");
          setTimeout(() => setEstado("inactivo"), 6000);
          break;
      }
    });
    return quitar;
  }, []);

  async function manejarClick() {
    if (estado === "descargada") {
      await window.hangar.updater.instalar();
      return;
    }
    setEstado("verificando");
    await window.hangar.updater.verificar();
  }

  const enProgreso = estado === "verificando" || estado === "descargando";

  return (
    <footer
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 16px", background: "var(--h421-navy)", color: "rgba(255,255,255,0.75)",
        fontSize: 12, borderTop: "1px solid rgba(255,255,255,0.08)", gap: 16,
      }}
    >
      <div>
        v{version || "…"} — Desarrollado por Soft Gala
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {estado === "descargando" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Descargando {versionNueva ? `v${versionNueva}` : "actualización"}…</span>
            <div style={{ width: 120, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
              <div style={{ width: `${progreso}%`, height: "100%", background: "var(--h421-amber)", transition: "width 0.2s" }} />
            </div>
            <span>{progreso}%</span>
          </div>
        )}
        {estado === "verificando" && <span>Buscando actualizaciones…</span>}
        {estado === "al-dia" && <span style={{ color: "var(--h421-green)" }}>✓ Ya tienes la última versión</span>}
        {estado === "error" && <span style={{ color: "var(--h421-red)" }}>⚠ {mensajeError}</span>}

        <button
          onClick={manejarClick}
          disabled={enProgreso}
          style={{
            background: estado === "descargada" ? "var(--h421-green)" : "rgba(255,255,255,0.1)",
            color: "#fff", padding: "6px 14px", fontSize: 12, minHeight: 30, borderRadius: 8,
            opacity: enProgreso ? 0.6 : 1,
          }}
        >
          {estado === "descargada" ? "⟳ Reiniciar e instalar" : "⬇ Actualizar"}
        </button>
      </div>
    </footer>
  );
}
