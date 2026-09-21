"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { useSucursalActiva } from "@/store/sucursalActiva";
import { avisarCambioSolicitudes } from "@/lib/solicitudes";

interface Solicitud {
  id: string;
  texto: string;
  estado: "PENDIENTE" | "ATENDIDA" | "DESCARTADA";
  solicitadaEn: string;
  resueltaEn: string | null;
  notaResolucion: string | null;
  sucursal: { id: string; nombre: string };
  usuario: { id: string; nombre: string } | null;
  dispositivo: { id: string; nombre: string; tipo: string } | null;
  resueltaPor: { id: string; nombre: string } | null;
  producto: { id: string; nombre: string } | null;
}

interface ProductoCatalogo {
  id: string;
  nombre: string;
}

const ETIQUETA_ESTADO: Record<Solicitud["estado"], { texto: string; color: string }> = {
  PENDIENTE: { texto: "Pendiente", color: "var(--h421-amber)" },
  ATENDIDA: { texto: "Atendida", color: "var(--h421-green)" },
  DESCARTADA: { texto: "Descartada", color: "var(--h421-gray-400)" },
};

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Solicitudes de alta de productos que alguien intentó vender y no existen en el catálogo.
 *
 * El producto nunca se crea solo: la venta se detuvo en el punto de venta y quedó esta solicitud.
 * El administrador lo da de alta en Catálogo y aquí la marca como atendida (idealmente indicando
 * con qué producto), o la descarta si no procede.
 */
export default function SolicitudesPage() {
  const { contexto } = useAuthCrm();
  const { seleccion } = useSucursalActiva();
  const puedeResolver = contexto?.rol === "ADMIN_CORPORATIVO" || contexto?.rol === "ADMIN_SUCURSAL";

  const [estado, setEstado] = useState("PENDIENTE");
  const [solicitudes, setSolicitudes] = useState<Solicitud[] | null>(null);
  const [productos, setProductos] = useState<ProductoCatalogo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [productoElegido, setProductoElegido] = useState("");
  const [nota, setNota] = useState("");

  const cargar = useCallback(async () => {
    if (!contexto) return;
    setError(null);
    try {
      const params = new URLSearchParams();
      if (seleccion?.sucursalId) params.set("sucursalId", seleccion.sucursalId);
      if (estado) params.set("estado", estado);
      setSolicitudes(await apiFetch<Solicitud[]>(`/solicitudes-producto?${params}`));
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar las solicitudes");
    }
  }, [contexto, seleccion?.sucursalId, estado]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Catálogo para elegir con qué producto se atendió. Si falla, se puede atender sin elegirlo.
  useEffect(() => {
    if (!contexto || !puedeResolver) return;
    const params = new URLSearchParams({ empresaId: contexto.usuario.empresaId });
    if (seleccion?.sucursalId) params.set("sucursalId", seleccion.sucursalId);
    apiFetch<ProductoCatalogo[]>(`/catalogo/productos?${params}`)
      .then((p) => setProductos([...p].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))))
      .catch(() => setProductos([]));
  }, [contexto, seleccion?.sucursalId, puedeResolver]);

  async function resolver(id: string, nuevoEstado: "ATENDIDA" | "DESCARTADA") {
    setError(null);
    try {
      await apiFetch(`/solicitudes-producto/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ estado: nuevoEstado, productoId: nuevoEstado === "ATENDIDA" && productoElegido ? productoElegido : undefined, nota: nota || undefined }),
      });
      setResolviendo(null);
      setProductoElegido("");
      setNota("");
      avisarCambioSolicitudes();
      await cargar();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar la solicitud");
    }
  }

  const consolidado = !seleccion?.sucursalId;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Solicitudes de productos</h1>
      <p style={{ color: "var(--h421-gray-400)", marginTop: -8 }}>
        Productos que se intentaron vender en {seleccion?.nombre ?? "todas las sucursales"} y no están en el catálogo. La venta
        se detuvo: nada se da de alta solo. Regístralo en <Link href="/catalogo">Catálogo</Link> y marca aquí la solicitud como
        atendida.
      </p>

      <div className="card" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={etiqueta}>Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} style={entrada}>
            <option value="PENDIENTE">Pendientes</option>
            <option value="ATENDIDA">Atendidas</option>
            <option value="DESCARTADA">Descartadas</option>
            <option value="">Todas</option>
          </select>
        </label>
        <button onClick={cargar} style={{ padding: "10px 18px", background: "var(--h421-navy)", color: "#fff" }}>
          Actualizar
        </button>
      </div>

      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

      <div className="card h421-tabla-wrap" style={{ marginTop: 16, overflowX: "auto" }}>
        {!solicitudes ? (
          <p>Cargando…</p>
        ) : solicitudes.length === 0 ? (
          <p style={{ margin: 0, color: "var(--h421-gray-400)" }}>
            {estado === "PENDIENTE" ? "No hay solicitudes pendientes." : "No hay solicitudes con este filtro."}
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                <th style={celdaEncabezado}>Fecha y hora</th>
                <th style={celdaEncabezado}>Producto solicitado</th>
                {consolidado && <th style={celdaEncabezado}>Sucursal</th>}
                <th style={celdaEncabezado}>Usuario</th>
                <th style={celdaEncabezado}>Dispositivo</th>
                <th style={celdaEncabezado}>Estado</th>
                <th style={celdaEncabezado}></th>
              </tr>
            </thead>
            <tbody>
              {solicitudes.map((s) => (
                <>
                  <tr key={s.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                    <td style={celda}>{fechaHora(s.solicitadaEn)}</td>
                    <td style={{ ...celda, fontWeight: 700 }}>{s.texto}</td>
                    {consolidado && <td style={celda}>{s.sucursal.nombre}</td>}
                    <td style={celda}>{s.usuario?.nombre ?? "—"}</td>
                    <td style={celda}>{s.dispositivo?.nombre ?? "—"}</td>
                    <td style={celda}>
                      <span style={{ color: ETIQUETA_ESTADO[s.estado].color, fontWeight: 700 }}>{ETIQUETA_ESTADO[s.estado].texto}</span>
                      {s.estado !== "PENDIENTE" && (
                        <div style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>
                          {s.resueltaPor?.nombre ?? "—"}
                          {s.resueltaEn && ` · ${fechaHora(s.resueltaEn)}`}
                          {s.producto && ` · como «${s.producto.nombre}»`}
                          {s.notaResolucion && ` · ${s.notaResolucion}`}
                        </div>
                      )}
                    </td>
                    <td style={celda}>
                      {puedeResolver && s.estado === "PENDIENTE" && resolviendo !== s.id && (
                        <button onClick={() => { setResolviendo(s.id); setProductoElegido(""); setNota(""); }} style={{ padding: "6px 12px" }}>
                          Resolver
                        </button>
                      )}
                    </td>
                  </tr>
                  {resolviendo === s.id && (
                    <tr key={`${s.id}-resolver`}>
                      <td colSpan={consolidado ? 7 : 6} style={{ padding: "12px", background: "var(--h421-gray-50)" }}>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                          <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 240 }}>
                            <span style={etiqueta}>Producto con que se atendió (opcional)</span>
                            <select value={productoElegido} onChange={(e) => setProductoElegido(e.target.value)} style={entrada}>
                              <option value="">— Sin indicar —</option>
                              {productos.map((p) => (
                                <option key={p.id} value={p.id}>{p.nombre}</option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
                            <span style={etiqueta}>Nota (opcional)</span>
                            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. ya existía como «Chai de avena»" style={entrada} />
                          </label>
                          <button onClick={() => resolver(s.id, "ATENDIDA")} style={{ padding: "10px 14px", background: "var(--h421-green)", color: "#fff" }}>
                            Marcar atendida
                          </button>
                          <button onClick={() => resolver(s.id, "DESCARTADA")} style={{ padding: "10px 14px" }}>
                            Descartar
                          </button>
                          <button onClick={() => setResolviendo(null)} style={{ padding: "10px 14px", background: "transparent", textDecoration: "underline" }}>
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const etiqueta: React.CSSProperties = { fontSize: 12, color: "var(--h421-gray-400)", fontWeight: 700 };
const entrada: React.CSSProperties = { padding: "9px 10px", borderRadius: 8, border: "1px solid var(--h421-gray-200)" };
const celdaEncabezado: React.CSSProperties = { padding: "8px 12px", fontSize: 12, color: "var(--h421-gray-400)" };
const celda: React.CSSProperties = { padding: "10px 12px" };
