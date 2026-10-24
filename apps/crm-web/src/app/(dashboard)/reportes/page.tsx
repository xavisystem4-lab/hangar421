"use client";

import { useEffect, useState } from "react";
import type { Producto, Sucursal } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { ProductoVendido, etiquetaProducto, type VarianteVendida } from "@/components/ProductoVendido";
import { useSucursalActiva } from "@/store/sucursalActiva";
import { useAuthCrm } from "@/lib/authClient";
import { StatTile } from "@/components/StatTile";
import { BarChart } from "@/components/BarChart";
import { ReporteCreditoEmpleados } from "@/components/ReporteCreditoEmpleados";
import { BotonesExportar } from "@/components/BotonesExportar";
import { ReporteDidi } from "@/components/ReporteDidi";
import { ReporteProductosVendidos } from "@/components/ReporteProductosVendidos";
import { TarjetaDidi } from "@/components/TarjetaDidi";
import { useResumenDidi } from "@/lib/resumenDidi";
import { exportarReporteVentasExcel, exportarReporteVentasPdf, type DatosReporteVentas } from "@/lib/exportarVentas";

interface VentaPorProducto {
  productoId: string;
  _sum: { cantidad: number | null };
  _count: number;
  nombre?: string;
  categoria?: string | null;
  subcategoria?: string | null;
  variantes?: VarianteVendida[];
}
interface VentaPorMetodo { metodo: string; _sum: { monto: string | null }; _count: number }

const ETIQUETA_METODO: Record<string, string> = {
  EFECTIVO: "Efectivo", EFECTIVO_USD: "Dólares", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", QR: "QR", OTRO: "Otro", EN_LINEA: "Pagado en línea", MONEDERO_EMPLEADO: "Crédito empleado",
};

/** "AAAA-MM-DD" en la hora LOCAL del navegador. Con toISOString() salía en UTC: después de las
 *  6 pm en México "hoy" ya era mañana y el reporte del día salía vacío. */
function fechaISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReportesPage() {
  const { contexto } = useAuthCrm();
  const { seleccion } = useSucursalActiva();
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
  /** "ventas" = el reporte de siempre; "credito" = consumo del crédito de cada empleada;
   *  "didi" = ventas de DiDi y ganancia real. `?vista=didi` abre directo esa pestaña. */
  const [vista, setVista] = useState<"ventas" | "productos" | "credito" | "didi">(() => {
    if (typeof window === "undefined") return "ventas";
    const v = new URLSearchParams(window.location.search).get("vista");
    return v === "didi" || v === "credito" || v === "productos" ? v : "ventas";
  });

  /** "Productos vendidos" abre con el día de hoy (se puede cambiar arriba con Desde/Hasta). */
  function cambiarVista(v: typeof vista) {
    if (v === "productos" && vista !== "productos") {
      const h = fechaISO(new Date());
      setDesde(h);
      setHasta(h);
    }
    setVista(v);
  }
  const resumenDidi = useResumenDidi(sucursalId, desde, hasta);

  // La sucursal la fija el contexto global (cabecera). Antes esta página elegía siempre la
  // primera del listado, así que un reporte podía ser de otra sucursal sin avisar.
  useEffect(() => {
    if (!contexto) return;
    if (seleccion?.sucursalId) setSucursalId(seleccion.sucursalId);
    apiFetch<Producto[]>(`/catalogo/productos?empresaId=${contexto.usuario.empresaId}`).then(setProductos).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto, seleccion?.sucursalId]);

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
        apiFetch<VentaPorProducto[]>(`/reportes/ventas-por-producto?empresaId=${contexto.usuario.empresaId}&sucursalId=${sucursalId}&desde=${rangoDesde}&hasta=${rangoHasta}`),
        apiFetch<VentaPorMetodo[]>(`/reportes/ventas-por-metodo-pago?sucursalId=${sucursalId}&desde=${rangoDesde}&hasta=${rangoHasta}`),
      ]);
      setPorProducto(prod);
      setPorMetodo(met);
    } finally {
      setCargando(false);
    }
  }

  const nombreProducto = (id: string) => productos.find((p) => p.id === id)?.nombre ?? "—";
  const topProductos = [...porProducto]
    .map((p) => ({ ...p, nombre: p.nombre ?? nombreProducto(p.productoId) }))
    .sort((a, b) => (b._sum.cantidad ?? 0) - (a._sum.cantidad ?? 0))
    .slice(0, 10);
  const totalVentas = porMetodo.reduce((s, m) => s + Number(m._sum.monto ?? 0), 0);
  const totalPagos = porMetodo.reduce((s, m) => s + m._count, 0);

  /** Lo que va al PDF/Excel: TODOS los productos del rango (la pantalla solo enseña el top 10). */
  function datosExportacion(): DatosReporteVentas {
    return {
      sucursal: seleccion?.nombre ?? "Todas las sucursales",
      desde,
      hasta,
      totalVentas,
      totalPagos,
      productos: [...porProducto]
        .map((p) => ({ nombre: p.nombre ?? nombreProducto(p.productoId), categoria: p.categoria, subcategoria: p.subcategoria, unidades: p._sum.cantidad ?? 0, variantes: p.variantes }))
        .sort((a, b) => b.unidades - a.unidades),
      metodos: porMetodo
        .map((m) => ({ metodo: ETIQUETA_METODO[m.metodo] ?? m.metodo, pagos: m._count, monto: Number(m._sum.monto ?? 0) }))
        .sort((a, b) => b.monto - a.monto),
    };
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ marginTop: 0 }}>Reportes de ventas</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Sin selector propio: la sucursal la fija el contexto global de la cabecera. */}
          <label style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ padding: 8 }} />
          <label style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ padding: 8 }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        {([["ventas", "Ventas"], ["productos", "📦 Productos vendidos"], ["didi", "🛵 DiDi"], ["credito", "👛 Crédito de empleados"]] as const).map(([id, etiqueta]) => (
          <button key={id} onClick={() => cambiarVista(id)}
            style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, borderRadius: 999,
              background: vista === id ? "var(--h421-navy)" : "transparent", color: vista === id ? "#fff" : "var(--h421-navy-texto)",
              border: `1px solid ${vista === id ? "var(--h421-navy)" : "var(--h421-gray-200)"}` }}>
            {etiqueta}
          </button>
        ))}
      </div>

      {vista === "credito" ? (
        <ReporteCreditoEmpleados sucursalId={sucursalId} sucursalNombre={seleccion?.nombre ?? undefined} desde={desde} hasta={hasta} />
      ) : vista === "productos" ? (
        <ReporteProductosVendidos sucursalId={sucursalId} sucursalNombre={seleccion?.nombre ?? undefined} desde={desde} hasta={hasta} />
      ) : vista === "didi" ? (
        <ReporteDidi sucursalId={sucursalId} sucursalNombre={seleccion?.nombre ?? undefined} desde={desde} hasta={hasta} />
      ) : (<>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <BotonesExportar
          deshabilitado={cargando || (porProducto.length === 0 && porMetodo.length === 0)}
          onPdf={() => exportarReporteVentasPdf(datosExportacion())}
          onExcel={() => exportarReporteVentasExcel(datosExportacion())}
        />
      </div>
      {cargando && <p style={{ color: "var(--h421-gray-400)" }}>Cargando…</p>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
        <StatTile etiqueta="Ventas en el rango" valor={`$${totalVentas.toFixed(2)}`} acento="var(--h421-green)" />
        <StatTile etiqueta="Pagos registrados" valor={String(totalPagos)} acento="var(--h421-blue)" />
        <StatTile etiqueta="Productos distintos vendidos" valor={String(porProducto.length)} acento="var(--h421-amber)" />
        {resumenDidi && resumenDidi.tickets > 0 && <TarjetaDidi resumen={resumenDidi} onVerReporte={() => setVista("didi")} />}
      </div>

      <div className="h421-grid-2col" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginTop: 20 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Top productos (por unidades vendidas)</h3>
          {topProductos.length > 0 ? (
            <>
              <BarChart data={topProductos.map((p) => ({ etiqueta: etiquetaProducto(p, topProductos), valor: p._sum.cantidad ?? 0 }))} alto={180} />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 10 }}>
                <tbody>
                  {topProductos.map((p, i) => (
                    <tr key={p.productoId} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                      <td style={{ padding: 6, width: 28, color: "var(--h421-gray-400)" }}>{i + 1}.</td>
                      <td style={{ padding: 6 }}><ProductoVendido producto={p} /></td>
                      <td style={{ padding: 6, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{p._sum.cantidad ?? 0} unidades</td>
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
              <BarChart data={porMetodo.map((m) => ({ etiqueta: ETIQUETA_METODO[m.metodo] ?? m.metodo, valor: Number(m._sum.monto ?? 0) }))} alto={160} formatoValor={(v) => `${v.toFixed(2)}`} />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 10 }}>
                <thead>
                  <tr style={{ color: "var(--h421-gray-400)", fontSize: 12, textAlign: "left" }}>
                    <th style={{ padding: 6 }}>Método</th>
                    <th style={{ padding: 6, textAlign: "right" }}>Transacciones</th>
                    <th style={{ padding: 6, textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {porMetodo.map((m) => (
                    <tr key={m.metodo} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                      <td style={{ padding: 6 }}>{ETIQUETA_METODO[m.metodo] ?? m.metodo}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{m._count}</td>
                      <td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>${Number(m._sum.monto ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 800 }}>
                    <td style={{ padding: 6 }}>Total</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{totalPagos}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>${totalVentas.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Sin pagos en este rango.</p>}
        </div>
      </div>
      </>)}
    </div>
  );
}
