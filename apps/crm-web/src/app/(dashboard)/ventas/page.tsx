"use client";

import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { useSucursalActiva } from "@/store/sucursalActiva";
import { StatTile } from "@/components/StatTile";

interface LineaVenta {
  id: string;
  nombre: string;
  cantidad: number;
  subtotal: number;
}

interface Venta {
  id: string;
  folio: string;
  fecha: string;
  estado: string;
  canalOrigen: string;
  total: number;
  subtotal: number;
  descuento: number;
  impuestos: number;
  sucursal: { id: string; nombre: string } | null;
  mesero: { id: string; nombre: string } | null;
  cajero: { id: string; nombre: string } | null;
  numItems: number;
  items: LineaVenta[];
  pagos: { metodo: string; monto: number }[];
}

interface RespuestaVentas {
  rango: { desde: string; hasta: string; zona: string };
  resumen: {
    totalVendido: number;
    numTickets: number;
    ticketPromedio: number;
    porEstado: { estado: string; cantidad: number; total: number }[];
  };
  paginacion: { total: number; limite: number; offset: number };
  items: Venta[];
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3000";
const POR_PAGINA = 50;

/** Colores por estado. Solo COBRADO cuenta como venta cerrada; el resto son tickets en curso o
 *  anulados y se marcan para que salten a la vista. */
const COLOR_ESTADO: Record<string, string> = {
  COBRADO: "var(--h421-green)",
  CANCELADO: "var(--h421-red)",
  ABIERTO: "var(--h421-amber)",
  ENVIADO: "var(--h421-amber)",
  EN_PREPARACION: "var(--h421-amber)",
  LISTO: "var(--h421-amber)",
  ENTREGADO: "var(--h421-amber)",
  POR_COBRAR: "var(--h421-amber)",
};

const ETIQUETA_CANAL: Record<string, string> = {
  APP_POS_MOVIL: "APK Punto de Venta",
  POS_ESCRITORIO: "POS Windows",
  APP_MESERO: "Comandero",
  WEB: "Web",
};

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function VentasPage() {
  const { contexto } = useAuthCrm();
  const { seleccion } = useSucursalActiva();

  const [desde, setDesde] = useState(hoyLocal());
  const [hasta, setHasta] = useState(hoyLocal());
  const [estado, setEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(0);

  const [datos, setDatos] = useState<RespuestaVentas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!contexto) return;
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde, hasta, limite: String(POR_PAGINA), offset: String(pagina * POR_PAGINA) });
      if (seleccion?.sucursalId) params.set("sucursalId", seleccion.sucursalId);
      if (estado) params.set("estado", estado);
      if (busqueda.trim()) params.set("busqueda", busqueda.trim());
      setDatos(await apiFetch<RespuestaVentas>(`/pedidos/ventas?${params}`));
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar las ventas");
    } finally {
      setCargando(false);
    }
  }, [contexto, seleccion?.sucursalId, desde, hasta, estado, busqueda, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Una venta que entra por sincronización debe aparecer sin recargar: es justo lo que se está
  // mirando cuando se abre esta pantalla después de cobrar en la terminal.
  useEffect(() => {
    if (!contexto) return;
    const socket = io(WS_URL, { path: "/realtime", transports: ["websocket"] });
    socket.on("connect", () => socket.emit("join", { empresaId: contexto.usuario.empresaId }));
    socket.on("pedido:creado", cargar);
    socket.on("pedido:actualizado", cargar);
    return () => { socket.disconnect(); };
  }, [contexto, cargar]);

  // Cambiar cualquier filtro vuelve a la primera página: quedarse en la página 3 de un resultado
  // que ahora tiene 4 filas enseñaría una tabla vacía.
  function cambiarFiltro(aplicar: () => void) {
    aplicar();
    setPagina(0);
  }

  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.paginacion.total / POR_PAGINA)) : 1;
  const noCobradas = datos?.resumen.porEstado.filter((e) => e.estado !== "COBRADO" && e.estado !== "CANCELADO") ?? [];

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Ventas</h1>
      <p style={{ color: "var(--h421-gray-400)", marginTop: -8 }}>
        Tickets de {seleccion?.nombre ?? "todas las sucursales"}. Solo consulta: cancelar un ticket o
        reabrir una cuenta se hace desde la terminal de la sucursal, con autorización.
      </p>

      <div className="card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={campo}>
          <span style={etiqueta}>Desde</span>
          <input type="date" value={desde} onChange={(e) => cambiarFiltro(() => setDesde(e.target.value))} style={entrada} />
        </label>
        <label style={campo}>
          <span style={etiqueta}>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => cambiarFiltro(() => setHasta(e.target.value))} style={entrada} />
        </label>
        <label style={campo}>
          <span style={etiqueta}>Estado</span>
          <select value={estado} onChange={(e) => cambiarFiltro(() => setEstado(e.target.value))} style={entrada}>
            <option value="">Todos</option>
            <option value="COBRADO">Cobradas</option>
            <option value="CANCELADO">Canceladas</option>
            <option value="ABIERTO">Abiertas</option>
            <option value="ENVIADO">Enviadas</option>
            <option value="POR_COBRAR">Por cobrar</option>
          </select>
        </label>
        <label style={{ ...campo, flex: 1, minWidth: 180 }}>
          <span style={etiqueta}>Buscar folio o producto</span>
          <input
            value={busqueda}
            onChange={(e) => cambiarFiltro(() => setBusqueda(e.target.value))}
            placeholder="Ej. 1042, Latte…"
            style={entrada}
          />
        </label>
        <button onClick={cargar} disabled={cargando} style={{ padding: "10px 18px", background: "var(--h421-navy)", color: "#fff" }}>
          {cargando ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
        <StatTile etiqueta="Total vendido" valor={`$${(datos?.resumen.totalVendido ?? 0).toFixed(2)}`} acento="var(--h421-green)" />
        <StatTile etiqueta="Tickets cobrados" valor={String(datos?.resumen.numTickets ?? 0)} acento="var(--h421-blue)" />
        <StatTile etiqueta="Ticket promedio" valor={`$${(datos?.resumen.ticketPromedio ?? 0).toFixed(2)}`} acento="var(--h421-amber)" />
      </div>

      {/* Un ticket que llegó pero cuyo pago no se sincronizó se queda sin cobrar y no suma a
          ningún total. Antes desaparecía en silencio; aquí se avisa para poder repararlo. */}
      {noCobradas.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderLeft: "4px solid var(--h421-amber)" }}>
          <strong>Hay tickets sin cobrar en este rango.</strong>
          <p style={{ margin: "6px 0 0", fontSize: 14 }}>
            {noCobradas.map((e) => `${e.cantidad} en ${e.estado.toLowerCase()}`).join(", ")}. No suman al total vendido.
            Suele ser una venta que llegó a medias: el pedido se sincronizó pero su pago no. Revísalo en la terminal,
            en Sincronización.
          </p>
        </div>
      )}

      <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
        {!datos ? (
          <p>Cargando…</p>
        ) : datos.items.length === 0 ? (
          <p style={{ margin: 0, color: "var(--h421-gray-400)" }}>
            No hay ventas en este rango para {seleccion?.nombre ?? "la empresa"}.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                <th style={celdaEncabezado}>Folio</th>
                <th style={celdaEncabezado}>Hora</th>
                <th style={celdaEncabezado}>Estado</th>
                <th style={celdaEncabezado}>Origen</th>
                {!seleccion?.sucursalId && <th style={celdaEncabezado}>Sucursal</th>}
                <th style={celdaEncabezado}>Atendió</th>
                <th style={celdaEncabezado}>Pago</th>
                <th style={{ ...celdaEncabezado, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.items.map((v) => (
                <>
                  <tr
                    key={v.id}
                    onClick={() => setAbierta(abierta === v.id ? null : v.id)}
                    style={{ borderBottom: "1px solid var(--h421-gray-200)", cursor: "pointer" }}
                  >
                    <td style={celda}>{abierta === v.id ? "▾" : "▸"} {v.folio}</td>
                    <td style={celda}>
                      {new Date(v.fecha).toLocaleString("es-MX", {
                        timeZone: datos.rango.zona,
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                    <td style={celda}>
                      <span style={{ color: COLOR_ESTADO[v.estado] ?? "var(--h421-gray-400)", fontWeight: 700 }}>
                        {v.estado}
                      </span>
                    </td>
                    <td style={celda}>{ETIQUETA_CANAL[v.canalOrigen] ?? v.canalOrigen}</td>
                    {!seleccion?.sucursalId && <td style={celda}>{v.sucursal?.nombre ?? "—"}</td>}
                    <td style={celda}>{v.cajero?.nombre ?? v.mesero?.nombre ?? "—"}</td>
                    <td style={celda}>{v.pagos.map((p) => p.metodo).join(", ") || "—"}</td>
                    <td style={{ ...celda, textAlign: "right", fontWeight: 700 }}>${v.total.toFixed(2)}</td>
                  </tr>
                  {abierta === v.id && (
                    <tr key={`${v.id}-detalle`}>
                      <td colSpan={seleccion?.sucursalId ? 7 : 8} style={{ padding: "10px 12px 18px", background: "var(--h421-gray-50)" }}>
                        <strong style={{ fontSize: 13 }}>Ticket {v.folio}</strong>
                        <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
                          {v.items.map((l) => (
                            <li key={l.id}>{l.cantidad}× {l.nombre} — ${l.subtotal.toFixed(2)}</li>
                          ))}
                        </ul>
                        <div style={{ fontSize: 13, display: "flex", gap: 20, flexWrap: "wrap" }}>
                          <span>Subtotal: ${v.subtotal.toFixed(2)}</span>
                          {v.descuento > 0 && <span>Descuento: −${v.descuento.toFixed(2)}</span>}
                          <span>Impuestos: ${v.impuestos.toFixed(2)}</span>
                          <strong>Total: ${v.total.toFixed(2)}</strong>
                        </div>
                        {v.pagos.length > 0 && (
                          <div style={{ fontSize: 13, marginTop: 6 }}>
                            Pagos: {v.pagos.map((p) => `${p.metodo} $${p.monto.toFixed(2)}`).join(" · ")}
                          </div>
                        )}
                        {!v.cajero && !v.mesero && (
                          <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "8px 0 0" }}>
                            Sin cajero asignado: la terminal lo dio de alta sin conexión y todavía no está
                            registrado en el ERP. La venta sí se guardó completa.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && datos.paginacion.total > POR_PAGINA && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
          <button onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0} style={{ padding: "8px 14px" }}>
            ‹ Anterior
          </button>
          <span style={{ fontSize: 14 }}>Página {pagina + 1} de {totalPaginas} · {datos.paginacion.total} tickets</span>
          <button onClick={() => setPagina((p) => p + 1)} disabled={pagina + 1 >= totalPaginas} style={{ padding: "8px 14px" }}>
            Siguiente ›
          </button>
        </div>
      )}
    </div>
  );
}

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const etiqueta: React.CSSProperties = { fontSize: 12, color: "var(--h421-gray-400)", fontWeight: 700 };
const entrada: React.CSSProperties = { padding: "9px 10px", borderRadius: 8, border: "1px solid var(--h421-gray-200)" };
const celdaEncabezado: React.CSSProperties = { padding: "8px 12px", fontSize: 12, color: "var(--h421-gray-400)" };
const celda: React.CSSProperties = { padding: "10px 12px" };
