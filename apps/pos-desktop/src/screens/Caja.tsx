import { useEffect, useState } from "react";
import { apiFetch } from "../api/http";
import { useAuthStore } from "../store/authStore";

interface CajaDto { id: string; nombre: string }
interface TurnoDto { id: string; montoInicial: string; fechaApertura: string }

export function Caja({ sucursalId }: { sucursalId: string }) {
  const { usuario } = useAuthStore();
  const [cajas, setCajas] = useState<CajaDto[]>([]);
  const [cajaId, setCajaId] = useState<string>("");
  const [turno, setTurno] = useState<TurnoDto | null>(null);
  const [montoInicial, setMontoInicial] = useState("500");
  const [montoDeclarado, setMontoDeclarado] = useState("");
  const [resumen, setResumen] = useState<any>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CajaDto[]>(`/sucursales/${sucursalId}/cajas`).then((data) => {
      setCajas(data);
      if (data[0]) setCajaId(data[0].id);
    });
  }, [sucursalId]);

  useEffect(() => {
    if (!cajaId) return;
    apiFetch<TurnoDto | null>(`/caja/cajas/${cajaId}/turno-activo`).then(setTurno);
  }, [cajaId]);

  async function abrir() {
    setMensaje(null);
    try {
      const t = await apiFetch<TurnoDto>("/caja/turnos/abrir", {
        method: "POST",
        body: JSON.stringify({ sucursalId, cajaId, usuarioId: usuario!.id, montoInicial: Number(montoInicial) }),
      });
      setTurno(t);
    } catch (e: any) {
      setMensaje(e.message);
    }
  }

  async function cerrar() {
    setMensaje(null);
    if (!turno) return;
    try {
      const cerrado = await apiFetch(`/caja/turnos/${turno.id}/cerrar`, {
        method: "POST",
        body: JSON.stringify({ montoFinalDeclarado: Number(montoDeclarado) }),
      });
      setResumen(cerrado);
      setTurno(null);
    } catch (e: any) {
      setMensaje(e.message);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <h2>Caja</h2>
      <label style={{ display: "block", marginBottom: 12 }}>
        Caja
        <select value={cajaId} onChange={(e) => setCajaId(e.target.value)} style={{ display: "block", width: "100%", padding: 10, marginTop: 4 }}>
          {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </label>

      {!turno ? (
        <div style={{ background: "#fff", padding: 20, borderRadius: 12 }}>
          <h3>Apertura de turno</h3>
          <label>
            Monto inicial
            <input type="number" value={montoInicial} onChange={(e) => setMontoInicial(e.target.value)} style={{ display: "block", width: "100%", padding: 10, marginTop: 4 }} />
          </label>
          <button onClick={abrir} className="btn-grande" style={{ width: "100%", marginTop: 14, background: "var(--h421-green)", color: "#fff" }}>
            Abrir caja
          </button>
        </div>
      ) : (
        <div style={{ background: "#fff", padding: 20, borderRadius: 12 }}>
          <h3>Corte de caja</h3>
          <p style={{ color: "var(--h421-gray-400)" }}>Turno abierto desde {new Date(turno.fechaApertura).toLocaleString("es-MX")}</p>
          <label>
            Efectivo contado en caja
            <input type="number" value={montoDeclarado} onChange={(e) => setMontoDeclarado(e.target.value)} style={{ display: "block", width: "100%", padding: 10, marginTop: 4 }} />
          </label>
          <button onClick={cerrar} className="btn-grande" style={{ width: "100%", marginTop: 14, background: "var(--h421-red)", color: "#fff" }}>
            Cerrar turno
          </button>
        </div>
      )}

      {mensaje && <p style={{ color: "var(--h421-red)" }}>{mensaje}</p>}
      {resumen && (
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, marginTop: 14 }}>
          <strong>Resumen del corte</strong>
          <p>Sistema: ${Number(resumen.montoFinalSistema).toFixed(2)}</p>
          <p>Declarado: ${Number(resumen.montoFinalDeclarado).toFixed(2)}</p>
          <p style={{ color: Number(resumen.diferencia) === 0 ? "var(--h421-green)" : "var(--h421-red)" }}>
            Diferencia: ${Number(resumen.diferencia).toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}
