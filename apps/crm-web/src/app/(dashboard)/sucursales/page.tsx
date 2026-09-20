"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";

interface Sucursal {
  id: string;
  nombre: string;
  direccion?: string;
  horarioApertura?: string;
  horarioCierre?: string;
  tasaImpuesto: number;
  activo: boolean;
}

interface Dispositivo {
  id: string;
  nombre: string;
  tipo: string;
  ultimaConexion?: string | null;
}

export default function SucursalesPage() {
  const { contexto } = useAuthCrm();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: "", direccion: "" });

  // Edición inline de nombre y dirección — mismo patrón que Catálogo/Inventario: sin modal, se
  // edita en el lugar. Antes no había ninguna forma de corregir estos datos de una sucursal ya
  // creada desde el CRM (el backend sí lo soportaba vía PUT /sucursales/:id, solo faltaba
  // exponerlo aquí — la dirección solo se podía capturar al crear la sucursal, nunca después).
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreBorrador, setNombreBorrador] = useState("");
  const [direccionBorrador, setDireccionBorrador] = useState("");

  // Código de vinculación de terminales (APK Punto de Venta): se genera aquí y se le dicta al
  // cajero, que lo teclea una vez en la app. Así la terminal queda enlazada sin que nadie
  // escriba una contraseña en el dispositivo.
  const [codigo, setCodigo] = useState<{ sucursalId: string; codigo: string; expiraAt: string } | null>(null);
  const [generando, setGenerando] = useState<string | null>(null);
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);

  async function generarCodigo(sucursalId: string) {
    setErrorCodigo(null);
    setGenerando(sucursalId);
    try {
      const r = await apiFetch<{ codigo: string; expiraAt: string }>("/auth/codigos-vinculacion", {
        method: "POST",
        body: JSON.stringify({ sucursalId }),
      });
      setCodigo({ sucursalId, codigo: r.codigo, expiraAt: r.expiraAt });
    } catch (e: any) {
      setErrorCodigo(e?.message ?? "No se pudo generar el código");
    } finally {
      setGenerando(null);
    }
  }

  function minutosRestantes(expiraAt: string): number {
    return Math.max(0, Math.round((new Date(expiraAt).getTime() - Date.now()) / 60_000));
  }

  // Terminales conectadas por sucursal. "Conectada" = dio señal hace menos de 3 min; el APK
  // manda un latido cada 45s (ver sync/heartbeat), así que dos latidos perdidos la marcan
  // offline — suficiente margen para un wifi que parpadea, sin mentir si de verdad se cayó.
  const [dispositivos, setDispositivos] = useState<Record<string, Dispositivo[]>>({});

  async function cargar() {
    if (!contexto) return;
    const data = await apiFetch<Sucursal[]>(`/sucursales?empresaId=${contexto.usuario.empresaId}`);
    setSucursales(data);

    const porSucursal: Record<string, Dispositivo[]> = {};
    await Promise.all(
      data.map(async (s) => {
        // Una sucursal sin terminales, o un fallo puntual, no debe tumbar la página entera.
        porSucursal[s.id] = await apiFetch<Dispositivo[]>(`/sucursales/${s.id}/dispositivos`).catch(() => []);
      }),
    );
    setDispositivos(porSucursal);
  }

  useEffect(() => { cargar(); }, [contexto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresco periódico: el estado de conexión envejece solo, así que una página abierta en la
  // oficina tiene que actualizarse sin que nadie recargue.
  useEffect(() => {
    const t = setInterval(() => { cargar(); }, 60_000);
    return () => clearInterval(t);
  }, [contexto]); // eslint-disable-line react-hooks/exhaustive-deps

  function estaConectada(d: Dispositivo): boolean {
    return !!d.ultimaConexion && Date.now() - new Date(d.ultimaConexion).getTime() < 3 * 60_000;
  }

  function haceCuanto(iso?: string | null): string {
    if (!iso) return "nunca";
    const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (minutos < 1) return "hace segundos";
    if (minutos < 60) return `hace ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `hace ${horas} h`;
    return `hace ${Math.floor(horas / 24)} d`;
  }

  async function crear() {
    if (!contexto || !nuevo.nombre) return;
    await apiFetch("/sucursales", {
      method: "POST",
      body: JSON.stringify({ empresaId: contexto.usuario.empresaId, nombre: nuevo.nombre, direccion: nuevo.direccion }),
    });
    setNuevo({ nombre: "", direccion: "" });
    cargar();
  }

  function empezarEdicion(s: Sucursal) {
    setEditandoId(s.id);
    setNombreBorrador(s.nombre);
    setDireccionBorrador(s.direccion ?? "");
  }

  async function guardarEdicion(id: string) {
    if (!nombreBorrador.trim()) return;
    await apiFetch(`/sucursales/${id}`, {
      method: "PUT",
      body: JSON.stringify({ nombre: nombreBorrador.trim(), direccion: direccionBorrador.trim() }),
    });
    setEditandoId(null);
    cargar();
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Sucursales</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {sucursales.map((s) => (
          <div key={s.id} className="card">
            {editandoId === s.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                <input
                  value={nombreBorrador}
                  onChange={(e) => setNombreBorrador(e.target.value)}
                  autoFocus
                  placeholder="Nombre"
                  style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontSize: 16, fontWeight: 700 }}
                />
                <input
                  value={direccionBorrador}
                  onChange={(e) => setDireccionBorrador(e.target.value)}
                  placeholder="Dirección"
                  style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)", fontSize: 13 }}
                />
              </div>
            ) : (
              <>
                <strong style={{ fontSize: 16 }}>{s.nombre}</strong>
                <p style={{ color: "var(--h421-gray-400)", fontSize: 13, margin: "6px 0" }}>{s.direccion || "Sin dirección capturada"}</p>
              </>
            )}

            {/* Estado de conexión de la sucursal, sin desglosar por dispositivo: para saber si
                el negocio está operando y mandando datos, los nombres internos de las terminales
                ("POS Caja", "Pantalla cocina") son ruido. Basta con que la sucursal esté viva.
                Cuando no lo está, sí importa desde cuándo — eso es lo accionable. */}
            {(() => {
              const terminales = dispositivos[s.id] ?? [];
              const conectada = terminales.some(estaConectada);
              const ultimaSenal = terminales
                .map((d) => d.ultimaConexion)
                .filter(Boolean)
                .sort()
                .pop();
              return (
                <div style={{ margin: "10px 0", padding: "10px 12px", borderRadius: 8, background: "var(--h421-gray-50)" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: conectada ? "var(--h421-green)" : "var(--h421-gray-400)" }}>
                    {conectada ? `● ${s.nombre} — conectado` : `○ ${s.nombre} — sin conexión`}
                  </div>
                  {!conectada && (
                    <div style={{ fontSize: 12, color: "var(--h421-gray-400)", marginTop: 3 }}>
                      {terminales.length === 0 ? "Ninguna terminal enlazada todavía" : `Última señal ${haceCuanto(ultimaSenal)}`}
                    </div>
                  )}
                </div>
              );
            })()}
            <p style={{ fontSize: 13 }}>Horario: {s.horarioApertura ?? "—"} – {s.horarioCierre ?? "—"}</p>
            <p style={{ fontSize: 13 }}>IVA: {(Number(s.tasaImpuesto) * 100).toFixed(0)}%</p>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {editandoId === s.id ? (
                <>
                  <button onClick={() => guardarEdicion(s.id)} style={{ background: "var(--h421-green)", color: "#fff", padding: "6px 12px", fontSize: 13 }}>Guardar</button>
                  <button onClick={() => setEditandoId(null)} style={{ background: "var(--h421-gray-200)", padding: "6px 12px", fontSize: 13 }}>Cancelar</button>
                </>
              ) : (
                <button onClick={() => empezarEdicion(s)} style={{ background: "var(--h421-gray-50)", padding: "6px 12px", fontSize: 13 }}>Editar nombre y dirección</button>
              )}
              <button
                onClick={() => generarCodigo(s.id)}
                disabled={generando === s.id}
                style={{ background: "var(--h421-navy)", color: "#fff", padding: "6px 12px", fontSize: 13 }}
              >
                {generando === s.id ? "Generando…" : "Enlazar terminal"}
              </button>
            </div>

            {codigo?.sucursalId === s.id && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--h421-gray-50)", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--h421-gray-400)", textTransform: "uppercase", fontWeight: 700 }}>
                  Dictar en el Punto de Venta
                </div>
                {/* Partido en dos mitades y con espaciado: se lee en voz alta y se teclea en una
                    tablet. La app acepta el código con o sin el guion. */}
                <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 4, margin: "6px 0", fontFamily: "monospace" }}>
                  {codigo.codigo.slice(0, 4)}-{codigo.codigo.slice(4)}
                </div>
                <div style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>
                  Sirve una sola vez · caduca en {minutosRestantes(codigo.expiraAt)} min
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {errorCodigo && <p style={{ color: "var(--h421-red)", marginTop: 12 }}>{errorCodigo}</p>}

      <div className="card" style={{ marginTop: 20, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Nueva sucursal</h3>
        <input placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))}
          style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        <input placeholder="Dirección" value={nuevo.direccion} onChange={(e) => setNuevo((n) => ({ ...n, direccion: e.target.value }))}
          style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        <button onClick={crear} style={{ background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>Crear sucursal</button>
      </div>
    </div>
  );
}
