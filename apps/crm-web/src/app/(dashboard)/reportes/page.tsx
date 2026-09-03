"use client";

import { useEffect, useState } from "react";
import type { Producto, Sucursal } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { StatTile } from "@/components/StatTile";
import { BarChart } from "@/components/BarChart";

interface VentaPorProducto { productoId: string; _sum: { cantidad: number | null }; _count: number }
interface VentaPorMetodo { metodo: string; _sum: { monto: string | null }; _count: number }

const ETIQUETA_METODO: Record<string, string> = {
  EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", QR: "QR", OTRO: "Otro",
};

function fechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function ReportesPage() {
  const { contexto } = useAuthCrm();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);

  const hoy = new Date();
  const hace7dias = new Date(hoy.getTime() - 7 * 86_400_000);
  const [desde, setDesde] = useState(fechaISO(hace7dias));
  const [hasta, setHasta] = useState(fechaISO(hoy));

  const [porProducto, setPorProducto] = useState<VentaPorProducto[]>([]);
  const [porMetodo, setPorMetodo] = useState<VentaPorMetodo[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!contexto) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${contexto.usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) setSucursalId(s[0].id);
    });
    apiFetch<Producto[]>(`/catalogo/productos?empresaId=${contexto.usuario.empresaId}`).then(setProductos).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto]);

  useEffect(() => {
    if (!contexto || !sucursalId) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto, sucursalId, desde, hasta]);

  async function cargar() {
    if (!contexto || !sucursalId) return;
    setCargando(true);
    const rangoDesde = new Date(`${desde}T00:00:00`).toISOString();
    const rangoHasta = new Date(`${hasta}T23:59:59`).toISOString();
    try {
      const [prod, met] = await Promise.all([
        apiFetch<VentaPorProducto[]>(`/reportes/ventas-por-producto?empresaId=${contexto.usuario.empresaId}&desde=${rangoDesde}&hasta=${rangoHasta}`),
        apiFetch<VentaPorMetodo[]>(`/reportes/ventas-por-metodo-pago?sucursalId=${sucursalId}&desde=${rangoDesde}&hasta=${rangoHasta}`),
      ]);
      setPorProducto(prod);
      setPorMetodo(met);
    } finally {
      setCargando(false);
    }
  }

  const nombreProducto = (id: string) => productos.find((p) => p.id === id)?.nombre ?? "—";
  const topProductos = [...porProducto].sort((a, b) => (b._sum.cantidad ?? 0) - (a._sum.cantidad ?? 0)).slice(0, 10);
  const totalVentas = porMetodo.reduce((s, m) => s + Number(m._sum.monto ?? 0), 0);
  const totalPagos = porMetodo.reduce((s, m) => s + m._count, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ marginTop: 0 }}>Reportes de ventas</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} style={{ padding: 8 }}>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <label style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ padding: 8 }} />
          <label style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ padding: 8 }} />
        </div>
      </div>

      {cargando && <p style={{ color: "var(--h421-gray-400)" }}>Cargando…</p>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
        <StatTile etiqueta="Ventas en el rango" valor={`$${totalVentas.toFixed(2)}`} acento="var(--h421-green)" />
        <StatTile etiqueta="Pagos registrados" valor={String(totalPagos)} acento="var(--h421-blue)" />
        <StatTile etiqueta="Productos distintos vendidos" valor={String(porProducto.length)} acento="var(--h421-amber)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginTop: 20 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Top productos (por unidades vendidas)</h3>
          {topProductos.length > 0 ? (
            <>
              <BarChart data={topProductos.map((p) => ({ etiqueta: nombreProducto(p.productoId).slice(0, 6), valor: p._sum.cantidad ?? 0 }))} alto={180} />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 10 }}>
                <tbody>
                  {topProductos.map((p) => (
                    <tr key={p.productoId} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                      <td style={{ padding: 6 }}>{nombreProducto(p.productoId)}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{p._sum.cantidad ?? 0} unidades</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Sin ventas en este rango.</p>}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Ventas por método de pago</h3>
          {porMetodo.length > 0 ? (
            <>
              <BarChart data={porMetodo.map((m) => ({ etiqueta: ETIQUETA_METODO[m.metodo] ?? m.metodo, valor: Number(m._sum.monto ?? 0) }))} alto={160} />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 10 }}>
                <tbody>
                  {porMetodo.map((m) => (
                    <tr key={m.metodo} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                      <td style={{ padding: 6 }}>{ETIQUETA_METODO[m.metodo] ?? m.metodo} ({m._count})</td>
                      <td style={{ padding: 6, textAlign: "right" }}>${Number(m._sum.monto ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Sin pagos en este rango.</p>}
        </div>
      </div>
    </div>
  );
}
