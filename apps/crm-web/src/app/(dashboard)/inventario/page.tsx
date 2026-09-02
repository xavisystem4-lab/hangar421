"use client";

import { useEffect, useState } from "react";
import type { Sucursal } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";

interface Existencia {
  insumoId: string;
  existencia: string;
  minimo: string;
  insumo: { nombre: string; unidadMedida: string };
}

export default function InventarioPage() {
  const { contexto } = useAuthCrm();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [alertas, setAlertas] = useState<Existencia[]>([]);

  async function cargar(suc: string) {
    const [ex, al] = await Promise.all([
      apiFetch<Existencia[]>(`/inventario/existencias?sucursalId=${suc}`),
      apiFetch<Existencia[]>(`/inventario/alertas?sucursalId=${suc}`),
    ]);
    setExistencias(ex);
    setAlertas(al);
  }

  useEffect(() => {
    if (!contexto) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${contexto.usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargar(s[0].id); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginTop: 0 }}>Inventario</h1>
        <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); cargar(e.target.value); }} style={{ padding: 8 }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {alertas.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid var(--h421-yellow)", marginBottom: 16 }}>
          <strong style={{ color: "#92400e" }}>⚠ {alertas.length} insumo(s) en nivel mínimo</strong>
          <ul>
            {alertas.map((a) => <li key={a.insumoId}>{a.insumo.nombre}: {a.existencia} {a.insumo.unidadMedida}</li>)}
          </ul>
        </div>
      )}

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
              <th style={{ padding: 8 }}>Insumo</th>
              <th style={{ padding: 8 }}>Existencia</th>
              <th style={{ padding: 8 }}>Mínimo</th>
              <th style={{ padding: 8 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {existencias.map((e) => {
              const bajo = Number(e.existencia) <= Number(e.minimo);
              return (
                <tr key={e.insumoId} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <td style={{ padding: 8 }}>{e.insumo.nombre}</td>
                  <td style={{ padding: 8 }}>{e.existencia} {e.insumo.unidadMedida}</td>
                  <td style={{ padding: 8 }}>{e.minimo}</td>
                  <td style={{ padding: 8, color: bajo ? "var(--h421-red)" : "var(--h421-green)" }}>{bajo ? "Bajo" : "OK"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
