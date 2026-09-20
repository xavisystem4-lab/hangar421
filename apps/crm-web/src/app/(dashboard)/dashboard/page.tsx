"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { useSucursalActiva } from "@/store/sucursalActiva";
import { StatTile } from "@/components/StatTile";
import { BarChart } from "@/components/BarChart";
import { IndicadorEnVivo } from "@/components/IndicadorEnVivo";
import { suscribirVentas } from "@/lib/realtime";

interface DashboardData {
  ventasHoy: number;
  ticketPromedio: number;
  pedidosHoy: number;
  topProductos: { productoId: string; nombre: string; cantidad: number }[];
  estadoSucursales: { sucursalId: string; nombre: string; dispositivos: { id: string; nombre: string; enLinea: boolean }[] }[];
}

export default function DashboardPage() {
  const { contexto } = useAuthCrm();
  const { seleccion } = useSucursalActiva();
  const [data, setData] = useState<DashboardData | null>(null);
  const [ventasPorHora, setVentasPorHora] = useState<{ etiqueta: string; valor: number }[]>([]);

  async function cargar() {
    if (!contexto) return;
    const empresaId = contexto.usuario.empresaId;
    // Con una sucursal elegida, el dashboard muestra SOLO la suya; con "Todas", el consolidado
    // de la empresa (el endpoint ya lo hace cuando se omite sucursalId).
    const filtro = seleccion?.sucursalId ? `&sucursalId=${seleccion.sucursalId}` : "";
    const dash = await apiFetch<DashboardData>(`/reportes/dashboard?empresaId=${empresaId}${filtro}`);
    setData(dash);

    // El gráfico por hora es de UNA sucursal: antes cogía siempre la primera del listado, así
    // que con dos sucursales mostraba la de Condesa aunque estuvieras mirando Mecánicos.
    const paraGrafico = seleccion?.sucursalId ?? dash.estadoSucursales[0]?.sucursalId;
    if (paraGrafico) {
      const horas = await apiFetch<{ hora: number; total: number }[]>(`/reportes/ventas-por-hora?sucursalId=${paraGrafico}`);
      setVentasPorHora(horas.map((h) => ({ etiqueta: `${h.hora}h`, valor: h.total })));
    }
  }

  useEffect(() => {
    cargar();
    // El temporizador es la red de seguridad, no el mecanismo principal: si el socket se cae, el
    // dashboard sigue refrescándose, solo que más despacio.
    const t = setInterval(cargar, 30_000);

    // Se refresca en vivo cuando llega una venta. El socket es compartido por toda la app y
    // filtra por la sucursal activa (ver lib/realtime.ts).
    const desuscribir = contexto
      ? suscribirVentas(contexto.usuario.empresaId, seleccion?.sucursalId ?? null, () => cargar())
      : undefined;

    return () => { clearInterval(t); desuscribir?.(); };
    // `seleccion?.sucursalId` en las dependencias es imprescindible: sin él, cambiar de sucursal
    // en la cabecera no recargaba nada. Peor aún, el `setInterval` capturaba el `cargar` de la
    // primera carga, así que seguía refrescando LA SUCURSAL ANTERIOR cada 30 s — se veía un
    // dashboard que decía "Sucursal de prueba" con los números de otra, y una venta recién hecha
    // no aparecía nunca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto, seleccion?.sucursalId]);

  if (!data) return <p>Cargando…</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Dashboard</h1>
        <IndicadorEnVivo />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <StatTile etiqueta="Ventas hoy" valor={`$${data.ventasHoy.toFixed(2)}`} acento="var(--h421-green)" />
        <StatTile etiqueta="Ticket promedio" valor={`$${data.ticketPromedio.toFixed(2)}`} acento="var(--h421-blue)" />
        <StatTile etiqueta="Pedidos hoy" valor={String(data.pedidosHoy)} acento="var(--h421-amber)" />
      </div>

      <div className="h421-grid-2col" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginTop: 20 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Ventas por hora</h3>
          <BarChart data={ventasPorHora} formatoValor={(v) => `${v.toFixed(0)}`} />
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Top productos</h3>
          <ol style={{ paddingLeft: 18 }}>
            {data.topProductos.map((p) => (
              <li key={p.productoId}>{p.nombre} — {p.cantidad}</li>
            ))}
          </ol>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Estado de sincronización por sucursal</h3>
        {data.estadoSucursales.map((s) => (
          <div key={s.sucursalId} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--h421-gray-200)" }}>
            <span>{s.nombre}</span>
            <span style={{ display: "flex", gap: 10 }}>
              {s.dispositivos.map((d) => (
                <span key={d.id} title={d.nombre} style={{ fontSize: 12, color: d.enLinea ? "var(--h421-green)" : "var(--h421-gray-400)" }}>
                  ● {d.nombre}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
