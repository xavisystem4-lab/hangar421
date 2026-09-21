import { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";

type Estado =
  | { vinculado: false }
  | {
      vinculado: true;
      activo: boolean;
      urlErp: string;
      sucursalNube: string;
      sucursalIdLocal: string;
      sincronizarDesde: string;
      ultimoEnvio: string | null;
      ultimoError: string | null;
      ventas: { enviadas: number; conError: number; esperandoProducto: number; porEnviar: number };
      productosPorRelacionar: number;
    };

interface PorRelacionar {
  productos: { idLocal: string; nombre: string; lineasEnVentas: number }[];
  catalogoNube: { id: string; nombre: string }[];
}

const URL_ERP_POR_DEFECTO = "https://hangar421backend-production.up.railway.app";

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Vincula este POS (modo standalone) con el ERP en la nube para que sus ventas aparezcan en el
 * Dashboard. El POS sigue trabajando igual, sin depender de internet: solo SUBE sus ventas
 * cerradas desde la fecha elegida (ver backend enlace-nube). Se vincula con un código de UNA
 * sucursal que genera un admin en el Dashboard (Sucursales → "Enlazar terminal").
 *
 * Un producto que no existe en la nube detiene sus ventas hasta que el admin lo relaciona aquí con
 * el producto equivalente: nunca se crea solo.
 */
export function PanelEnlaceNube() {
  const sucursalActiva = useAuthStore((s) => s.sucursalId);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [sucursales, setSucursales] = useState<{ sucursalId: string; nombre: string }[]>([]);
  const [urlErp, setUrlErp] = useState(URL_ERP_POR_DEFECTO);
  const [codigo, setCodigo] = useState("");
  const [sucursalLocal, setSucursalLocal] = useState(sucursalActiva ?? "");
  const [desde, setDesde] = useState(hoyLocal());
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [porRelacionar, setPorRelacionar] = useState<PorRelacionar | null>(null);

  async function cargar() {
    try {
      const e = await apiFetch<Estado>("/enlace-nube");
      setEstado(e);
      if (e.vinculado && e.productosPorRelacionar > 0) {
        setPorRelacionar(await apiFetch<PorRelacionar>("/enlace-nube/productos-por-relacionar").catch(() => null));
      } else {
        setPorRelacionar(null);
      }
    } catch (e: any) {
      setMensaje(e?.message ?? "No se pudo consultar el enlace con la nube");
    }
  }

  useEffect(() => {
    cargar();
    apiFetch<{ sucursalId: string; nombre: string }[]>("/sucursales/mias").then(setSucursales).catch(() => setSucursales([]));
    // El envío corre solo cada minuto: se refresca el estado a ese mismo ritmo.
    const t = setInterval(cargar, 60_000);
    return () => clearInterval(t);
  }, []);

  async function accion(fn: () => Promise<unknown>, exito: string) {
    setOcupado(true);
    setMensaje(null);
    try {
      await fn();
      setMensaje(`✓ ${exito}`);
      await cargar();
    } catch (e: any) {
      setMensaje(e?.message ?? "No se pudo completar la operación");
    } finally {
      setOcupado(false);
    }
  }

  const vincular = () =>
    accion(
      () =>
        apiFetch("/enlace-nube/vincular", {
          method: "POST",
          body: JSON.stringify({ urlErp, codigo: codigo.trim(), sucursalIdLocal: sucursalLocal, sincronizarDesde: desde }),
        }),
      "POS vinculado. Las ventas empiezan a subir en menos de un minuto.",
    ).then(() => setCodigo(""));

  const relacionar = (idLocal: string, idNube: string) =>
    accion(() => apiFetch("/enlace-nube/relacionar", { method: "POST", body: JSON.stringify({ idLocal, idNube }) }), "Producto relacionado; sus ventas se suben en el siguiente envío.");

  return (
    <div style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--h421-gray-200)" }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>Subir ventas al ERP en la nube</h2>
      <p style={{ color: "var(--h421-gray-400)", fontSize: 14, marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        Este POS sigue trabajando con su base local y sin depender de internet; al vincularlo, además sube sus ventas
        cerradas al ERP para que aparezcan en el Dashboard. Pide el código en el Dashboard → Sucursales → "Enlazar
        terminal" de la sucursal que corresponde a este local.
      </p>

      {estado === null && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Cargando…</p>}

      {estado && (!estado.vinculado || !estado.activo) && (
        <div style={{ display: "grid", gap: 10 }}>
          <label style={etiqueta}>
            Dirección del ERP
            <input value={urlErp} onChange={(e) => setUrlErp(e.target.value)} style={{ ...entrada, fontFamily: "monospace", fontSize: 13 }} />
          </label>
          <label style={etiqueta}>
            Sucursal de este POS cuyas ventas se suben
            <select value={sucursalLocal} onChange={(e) => setSucursalLocal(e.target.value)} style={entrada}>
              <option value="">— Elige —</option>
              {sucursales.map((s) => (
                <option key={s.sucursalId} value={s.sucursalId}>{s.nombre}</option>
              ))}
            </select>
          </label>
          <label style={etiqueta}>
            Subir ventas desde
            <input type="date" value={desde} max={hoyLocal()} onChange={(e) => setDesde(e.target.value)} style={entrada} />
          </label>
          <label style={etiqueta}>
            Código de vinculación
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="ABCD-2345"
              style={{ ...entrada, fontFamily: "monospace", fontSize: 18, letterSpacing: 3 }}
            />
          </label>
          <button
            onClick={vincular}
            disabled={ocupado || !codigo.trim() || !sucursalLocal}
            className="btn-grande"
            style={{ background: "var(--h421-esmeralda)", color: "#fff", padding: "10px 18px", justifySelf: "start" }}
          >
            {ocupado ? "Vinculando…" : "Vincular con el ERP"}
          </button>
        </div>
      )}

      {estado?.vinculado && estado.activo && (
        <>
          <div style={{ padding: 14, borderRadius: 10, background: "var(--h421-gray-50)", fontSize: 14, display: "grid", gap: 6 }}>
            <div>
              Vinculado a <strong>{estado.sucursalNube}</strong> · ventas desde {new Date(estado.sincronizarDesde).toLocaleDateString("es-MX")}
            </div>
            <div>
              ✓ {estado.ventas.enviadas} enviadas · {estado.ventas.porEnviar} por enviar
              {estado.ventas.esperandoProducto > 0 && <> · <strong style={{ color: "var(--h421-amber-texto)" }}>{estado.ventas.esperandoProducto} esperando producto</strong></>}
              {estado.ventas.conError > 0 && <> · <strong style={{ color: "var(--h421-red-texto)" }}>{estado.ventas.conError} con error</strong></>}
            </div>
            <div style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>
              {estado.ultimoEnvio ? `Último envío: ${fechaHora(estado.ultimoEnvio)}` : "Todavía no se ha enviado nada"}
            </div>
            {estado.ultimoError && <div style={{ color: "var(--h421-red-texto)", fontSize: 13 }}>Último problema: {estado.ultimoError}</div>}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={() => accion(() => apiFetch("/enlace-nube/sincronizar", { method: "POST" }), "Envío realizado.")} disabled={ocupado} style={{ padding: "10px 18px", background: "var(--h421-navy)", color: "#fff" }}>
              {ocupado ? "Enviando…" : "Enviar ahora"}
            </button>
            <button
              onClick={() => {
                if (window.confirm("¿Dejar de subir las ventas de este POS a la nube? Lo ya enviado se conserva en el ERP.")) {
                  accion(() => apiFetch("/enlace-nube/desvincular", { method: "POST" }), "POS desvinculado.");
                }
              }}
              disabled={ocupado}
              style={{ padding: "10px 18px", background: "var(--h421-gray-50)" }}
            >
              Desvincular
            </button>
          </div>

          {porRelacionar && porRelacionar.productos.length > 0 && (
            <div style={{ marginTop: 18, padding: 14, borderRadius: 10, border: "1px solid var(--h421-amber)", background: "var(--h421-amber-bg)" }}>
              <strong style={{ fontSize: 14 }}>Productos por relacionar</strong>
              <p style={{ fontSize: 13, margin: "4px 0 10px" }}>
                Estos productos de este POS no existen con el mismo nombre en la nube. Elige su equivalente: las ventas que
                los incluyen esperan (no se pierden) y se suben en cuanto quedan relacionados. Si no existe, pide que lo den de
                alta en el catálogo del ERP.
              </p>
              {porRelacionar.productos.map((p) => (
                <div key={p.idLocal} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--h421-gray-200)", fontSize: 14 }}>
                  <span style={{ flex: 1 }}>
                    {p.nombre}
                    {p.lineasEnVentas > 0 && <span style={{ color: "var(--h421-gray-400)" }}> · en {p.lineasEnVentas} venta(s)</span>}
                  </span>
                  <select defaultValue="" onChange={(e) => e.target.value && relacionar(p.idLocal, e.target.value)} disabled={ocupado} style={{ ...entrada, width: 240 }}>
                    <option value="">— Equivale a… —</option>
                    {porRelacionar.catalogoNube.map((n) => (
                      <option key={n.id} value={n.id}>{n.nombre}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mensaje && (
        <p style={{ marginTop: 10, fontSize: 13, color: mensaje.startsWith("✓") ? "var(--h421-green)" : "var(--h421-red)" }}>{mensaje}</p>
      )}
    </div>
  );
}

const etiqueta: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12, color: "var(--h421-gray-400)" };
const entrada: React.CSSProperties = { padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" };
