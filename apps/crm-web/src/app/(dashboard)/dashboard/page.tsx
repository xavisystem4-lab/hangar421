"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { StatTile } from "@/components/StatTile";
import { BarChart } from "@/components/BarChart";

interface DashboardData {
  ventasHoy: number;
  ticketPromedio: number;
  pedidosHoy: number;
  topProductos: { productoId: string; nombre: string; cantidad: number }[];
  estadoSucursales: { sucursalId: string; nombre: string; dispositivos: { id: string; nombre: string; enLinea: boolean }[] }[];
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3000";

export default function DashboardPage() {
  const { contexto } = useAuthCrm();
  const [data, setData] = useState<DashboardData | null>(null);
  const [ventasPorHora, setVentasPorHora] = useState<{ etiqueta: string; valor: number }[]>([]);

  async function cargar() {
    if (!contexto) return;
    const empresaId = contexto.usuario.empresaId;
    const dash = await apiFetch<DashboardData>(`/reportes/dashboard?empresaId=${empresaId}`);
    setData(dash);
    if (dash.estadoSucursales[0]) {
      const horas = await apiFetch<{ hora: number; total: number }[]>(`/reportes/ventas-por-hora?sucursalId=${dash.estadoSucursales[0].sucursalId}`);
      setVentasPorHora(horas.map((h) => ({ etiqueta: `${h.hora}h`, valor: h.total })));
    }
  }

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 30_000);

    // el dashboard se refresca en vivo cuando llega una venta desde cualquier sucursal
    const socket = io(WS_URL, { path: "/realtime", transports: ["websocket"] });
    if (contexto) {
      socket.on("connect", () => socket.emit("join", { empresaId: contexto.usuario.empresaId }));
      socket.on("pedido:actualizado", cargar);
      socket.on("pedido:creado", cargar);
    }
    return () => { clearInterval(t); socket.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto]);

  if (!data) return <p>Cargando…</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <StatTile etiqueta="Ventas hoy" valor={`$${data.ventasHoy.toFixed(2)}`} acento="var(--h421-green)" />
        <StatTile etiqueta="Ticket promedio" valor={`$${data.ticketPromedio.toFixed(2)}`} acento="var(--h421-blue)" />
        <StatTile etiqueta="Pedidos hoy" valor={String(data.pedidosHoy)} acento="var(--h421-amber)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginTop: 20 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Ventas por hora</h3>
          <BarChart data={ventasPorHora} />
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
