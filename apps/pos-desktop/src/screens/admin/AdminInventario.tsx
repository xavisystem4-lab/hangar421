import { useEffect, useMemo, useRef, useState } from "react";
import type { NivelInventario, Sucursal } from "@hangar421/shared";
import { calcularNivelInventario } from "@hangar421/shared";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";
import { ReporteInventario } from "../../components/ReporteInventario";

interface Existencia {
  insumoId: string;
  existencia: string;
  minimo: string;
  maximo: string | null;
  insumo: { nombre: string; unidadMedida: string };
}

interface Proveedor {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
}

interface Insumo {
  id: string;
  nombre: string;
  unidadMedida: string;
  costoUnitario: string;
  precioVenta: string | null;
  proveedorId: string | null;
  proveedor: Proveedor | null;
}

interface Movimiento {
  id: string;
  tipo: string;
  cantidad: string;
  motivo: string | null;
  createdAt: string;
  insumoId: string;
  insumo: { nombre: string; unidadMedida: string };
}

interface TraspasoItem {
  id: string;
  insumoId: string;
  cantidadSolicitada: string;
  cantidadEnviada: string | null;
  cantidadRecibida: string | null;
  insumo: { nombre: string; unidadMedida: string };
}

interface Traspaso {
  id: string;
  sucursalOrigenId: string;
  sucursalDestinoId: string;
  estado: string;
  items: TraspasoItem[];
}

const TIPOS_MOVIMIENTO = ["ENTRADA", "SALIDA", "AJUSTE", "MERMA"];

const ETIQUETA_NIVEL: Record<NivelInventario, string> = { OPTIMO: "Óptimo", BAJO: "Bajo", CRITICO: "Crítico" };
const COLOR_NIVEL: Record<NivelInventario, { bg: string; texto: string; barra: string }> = {
  OPTIMO: { bg: "var(--h421-green-bg)", texto: "var(--h421-green)", barra: "var(--h421-green)" },
  BAJO: { bg: "var(--h421-amber-bg)", texto: "var(--h421-amber-texto)", barra: "var(--h421-yellow)" },
  CRITICO: { bg: "var(--h421-red-bg)", texto: "var(--h421-red-texto)", barra: "var(--h421-red)" },
};

/** Mismo overlay que ya usan ModalNota/ModalDescuento/ModalCobro en el propio POS — se reutiliza
 *  aquí para Movimientos/Historial/Traspasar/Hacer inventario. */
function Modal({ titulo, ancho = 520, onCerrar, children }: { titulo: string; ancho?: number; onCerrar: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div className="card" style={{ width: ancho, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{titulo}</h2>
          <button onClick={onCerrar} style={{ background: "none", fontSize: 20, minHeight: 0 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Inventario (existencias, insumos, niveles, movimientos, traspasos entre sucursales) con
 *  filtro por sucursal — mismo módulo que apps/crm-web/inventario, dentro del propio POS. */
export function AdminInventario() {
  const { usuario } = useAuthStore();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [filtroNivel, setFiltroNivel] = useState<"TODOS" | NivelInventario>("TODOS");

  const [nuevoInsumo, setNuevoInsumo] = useState({
    nombre: "", unidadMedida: "pz", costoUnitario: "", precioVenta: "", proveedorId: "", minimo: "", maximo: "",
  });

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [nuevoProveedor, setNuevoProveedor] = useState({ nombre: "", telefono: "" });

  const [editandoInsumoId, setEditandoInsumoId] = useState<string | null>(null);
  const [borradorInsumo, setBorradorInsumo] = useState({ nombre: "", unidadMedida: "pz", costoUnitario: "", precioVenta: "", proveedorId: "", minimo: "", maximo: "" });

  const [modalMovimiento, setModalMovimiento] = useState<Insumo | null>(null);
  const [mov, setMov] = useState({ tipo: "ENTRADA", cantidad: "", motivo: "" });
  const [modalMovimientosRecientes, setModalMovimientosRecientes] = useState(false);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);

  const [modalReporte, setModalReporte] = useState(false);
  const [modalListaCompras, setModalListaCompras] = useState(false);

  const [modalHistorial, setModalHistorial] = useState(false);
  const [historialInsumoId, setHistorialInsumoId] = useState("");

  const [modalConteo, setModalConteo] = useState(false);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [guardandoConteo, setGuardandoConteo] = useState(false);
  const inputsConteoRef = useRef<(HTMLInputElement | null)[]>([]);

  // Enter y flechas arriba/abajo se desplazan al campo contiguo en vez de su comportamiento
  // nativo (Enter no hace nada en un input suelto; las flechas incrementan/decrementan un
  // type="number") — captura rápida de un conteo físico sin soltar el teclado.
  function moverFocoConteo(e: React.KeyboardEvent<HTMLInputElement>, indice: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      inputsConteoRef.current[indice + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      inputsConteoRef.current[indice - 1]?.focus();
    }
  }

  const [modalTraspaso, setModalTraspaso] = useState<Insumo | null>(null);
  const [traspaso, setTraspaso] = useState({ sucursalDestinoId: "", cantidad: "" });
  const [traspasosPendientes, setTraspasosPendientes] = useState<Traspaso[]>([]);

  async function cargar(suc: string) {
    if (!usuario || !suc) return;
    const [ex, ins] = await Promise.all([
      apiFetch<Existencia[]>(`/inventario/existencias?sucursalId=${suc}`),
      apiFetch<Insumo[]>(`/inventario/insumos?empresaId=${usuario.empresaId}`),
    ]);
    setExistencias(ex);
    setInsumos(ins);
    cargarTraspasosPendientes(suc);
  }

  function cargarProveedores() {
    if (!usuario) return;
    apiFetch<Proveedor[]>(`/proveedores?empresaId=${usuario.empresaId}`).then(setProveedores);
  }

  async function cargarMovimientosRecientes(suc: string) {
    const movs = await apiFetch<Movimiento[]>(`/inventario/movimientos?sucursalId=${suc}`);
    setMovimientos(movs);
  }

  async function cargarTraspasosPendientes(suc: string) {
    const todos = await apiFetch<Traspaso[]>(`/traspasos?sucursalId=${suc}`);
    setTraspasosPendientes(todos.filter((t) => t.sucursalDestinoId === suc && t.estado === "ENVIADO"));
  }

  useEffect(() => {
    if (!usuario) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargar(s[0].id); }
    });
    cargarProveedores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  const filas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return insumos
      .map((i) => {
        const ex = existencias.find((e) => e.insumoId === i.id);
        const existencia = ex ? Number(ex.existencia) : 0;
        const minimo = ex ? Number(ex.minimo) : 0;
        const maximo = ex?.maximo != null ? Number(ex.maximo) : null;
        const { porcentaje, nivel } = calcularNivelInventario(existencia, minimo, maximo);
        return { insumo: i, existencia, minimo, maximo, porcentaje, nivel, tieneExistencia: !!ex };
      })
      .filter((f) => (texto ? f.insumo.nombre.toLowerCase().includes(texto) : true))
      .filter((f) => (filtroNivel === "TODOS" ? true : f.nivel === filtroNivel));
  }, [insumos, existencias, busqueda, filtroNivel]);

  async function crearInsumo() {
    if (!usuario || !nuevoInsumo.nombre.trim()) return;
    await apiFetch("/inventario/insumos", {
      method: "POST",
      body: JSON.stringify({
        empresaId: usuario.empresaId,
        nombre: nuevoInsumo.nombre,
        unidadMedida: nuevoInsumo.unidadMedida,
        costoUnitario: nuevoInsumo.costoUnitario ? Number(nuevoInsumo.costoUnitario) : undefined,
        precioVenta: nuevoInsumo.precioVenta ? Number(nuevoInsumo.precioVenta) : undefined,
        proveedorId: nuevoInsumo.proveedorId || undefined,
        minimo: nuevoInsumo.minimo ? Number(nuevoInsumo.minimo) : undefined,
        maximo: nuevoInsumo.maximo ? Number(nuevoInsumo.maximo) : undefined,
      }),
    });
    setNuevoInsumo({ nombre: "", unidadMedida: "pz", costoUnitario: "", precioVenta: "", proveedorId: "", minimo: "", maximo: "" });
    setMensaje("Insumo creado.");
    cargar(sucursalId);
  }

  function empezarEdicionInsumo(f: (typeof filas)[number]) {
    setEditandoInsumoId(f.insumo.id);
    setBorradorInsumo({
      nombre: f.insumo.nombre, unidadMedida: f.insumo.unidadMedida, costoUnitario: f.insumo.costoUnitario,
      precioVenta: f.insumo.precioVenta ?? "", proveedorId: f.insumo.proveedorId ?? "",
      minimo: String(f.minimo), maximo: f.maximo != null ? String(f.maximo) : "",
    });
  }

  async function guardarEdicionInsumo(id: string) {
    if (!borradorInsumo.nombre.trim()) return;
    await Promise.all([
      apiFetch(`/inventario/insumos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          nombre: borradorInsumo.nombre,
          unidadMedida: borradorInsumo.unidadMedida,
          costoUnitario: Number(borradorInsumo.costoUnitario) || 0,
          precioVenta: borradorInsumo.precioVenta ? Number(borradorInsumo.precioVenta) : null,
          proveedorId: borradorInsumo.proveedorId || null,
        }),
      }),
      apiFetch("/inventario/minimos", {
        method: "POST",
        body: JSON.stringify({
          sucursalId, insumoId: id,
          minimo: Number(borradorInsumo.minimo) || 0,
          maximo: borradorInsumo.maximo ? Number(borradorInsumo.maximo) : undefined,
        }),
      }),
    ]);
    setEditandoInsumoId(null);
    setMensaje("Insumo actualizado.");
    cargar(sucursalId);
  }

  async function eliminarInsumo(i: Insumo) {
    if (!confirm(`¿Eliminar "${i.nombre}"? Deja de aparecer en inventario y en recetas nuevas (el historial ya registrado no se pierde).`)) return;
    await apiFetch(`/inventario/insumos/${i.id}`, { method: "PATCH", body: JSON.stringify({ activo: false }) });
    setMensaje("Insumo eliminado.");
    cargar(sucursalId);
  }

  async function crearProveedor() {
    if (!usuario || !nuevoProveedor.nombre.trim()) return;
    await apiFetch("/proveedores", {
      method: "POST",
      body: JSON.stringify({ empresaId: usuario.empresaId, nombre: nuevoProveedor.nombre, telefono: nuevoProveedor.telefono || undefined }),
    });
    setNuevoProveedor({ nombre: "", telefono: "" });
    cargarProveedores();
  }

  async function eliminarProveedor(p: Proveedor) {
    if (!confirm(`¿Eliminar proveedor "${p.nombre}"? Los insumos que ya lo tienen asignado conservan la referencia.`)) return;
    await apiFetch(`/proveedores/${p.id}`, { method: "PATCH", body: JSON.stringify({ activo: false }) });
    cargarProveedores();
  }

  async function registrarMovimiento() {
    if (!usuario || !modalMovimiento || !mov.cantidad) return;
    await apiFetch("/inventario/movimientos", {
      method: "POST",
      body: JSON.stringify({
        sucursalId, insumoId: modalMovimiento.id, tipo: mov.tipo, cantidad: Number(mov.cantidad),
        motivo: mov.motivo || undefined, usuarioId: usuario.id,
      }),
    });
    setMov({ tipo: "ENTRADA", cantidad: "", motivo: "" });
    setModalMovimiento(null);
    setMensaje("Movimiento registrado.");
    cargar(sucursalId);
  }

  async function guardarConteo() {
    if (!usuario) return;
    const cambios = filas.filter((f) => conteo[f.insumo.id] !== undefined && conteo[f.insumo.id] !== "" && Number(conteo[f.insumo.id]) !== f.existencia);
    if (cambios.length === 0) { setModalConteo(false); return; }
    setGuardandoConteo(true);
    try {
      await Promise.all(cambios.map((f) =>
        apiFetch("/inventario/movimientos", {
          method: "POST",
          body: JSON.stringify({
            sucursalId, insumoId: f.insumo.id, tipo: "CONTEO",
            cantidad: Number(conteo[f.insumo.id]) - f.existencia,
            motivo: "Conteo físico de inventario", usuarioId: usuario.id,
          }),
        }),
      ));
      setMensaje(`Conteo guardado: ${cambios.length} insumo(s) ajustado(s).`);
      setConteo({});
      setModalConteo(false);
      cargar(sucursalId);
    } finally {
      setGuardandoConteo(false);
    }
  }

  async function confirmarTraspaso() {
    if (!usuario || !modalTraspaso || !traspaso.sucursalDestinoId || !traspaso.cantidad) return;
    const cantidad = Number(traspaso.cantidad);
    const creado = await apiFetch<Traspaso>("/traspasos", {
      method: "POST",
      body: JSON.stringify({
        sucursalOrigenId: sucursalId,
        sucursalDestinoId: traspaso.sucursalDestinoId,
        usuarioSolicitaId: usuario.id,
        items: [{ insumoId: modalTraspaso.id, cantidadSolicitada: cantidad }],
      }),
    });
    await apiFetch(`/traspasos/${creado.id}/autorizar`, { method: "POST", body: JSON.stringify({ usuarioAutorizaId: usuario.id }) });
    await apiFetch(`/traspasos/${creado.id}/enviar`, {
      method: "POST",
      body: JSON.stringify({ usuarioEnviaId: usuario.id, items: creado.items.map((it) => ({ itemId: it.id, cantidad })) }),
    });
    setModalTraspaso(null);
    setTraspaso({ sucursalDestinoId: "", cantidad: "" });
    setMensaje("Traspaso enviado. Quedará reflejado en destino cuando lo reciban.");
    cargar(sucursalId);
  }

  async function recibirTraspaso(t: Traspaso) {
    if (!usuario) return;
    const items = t.items.map((it) => ({ itemId: it.id, cantidad: Number(it.cantidadEnviada ?? it.cantidadSolicitada) }));
    await apiFetch(`/traspasos/${t.id}/recibir`, { method: "POST", body: JSON.stringify({ usuarioRecibeId: usuario.id, items }) });
    await apiFetch(`/traspasos/${t.id}/validar`, { method: "POST" });
    setMensaje("Traspaso recibido y aplicado al inventario.");
    cargar(sucursalId);
  }

  const movimientosHistorial = historialInsumoId ? movimientos.filter((m) => m.insumoId === historialInsumoId) : movimientos;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Inventario</h2>
        <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); cargar(e.target.value); }} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {mensaje && <p style={{ color: "var(--h421-navy-texto)" }}>{mensaje}</p>}

      {traspasosPendientes.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid var(--h421-blue)", marginBottom: 16, marginTop: 12 }}>
          <strong>📥 {traspasosPendientes.length} traspaso(s) por recibir</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {traspasosPendientes.map((t) => (
              <li key={t.id} style={{ marginBottom: 6 }}>
                {t.items.map((it) => `${it.insumo.nombre} (${it.cantidadEnviada ?? it.cantidadSolicitada} ${it.insumo.unidadMedida})`).join(", ")}
                {" "}
                <button onClick={() => recibirTraspaso(t)} style={{ background: "var(--h421-navy)", color: "#fff", padding: "3px 10px", fontSize: 12, minHeight: 0 }}>Recibir</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16, marginTop: 12 }}>
        <input placeholder="Buscar insumo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          style={{ flex: "1 1 220px", padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        <select value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value as typeof filtroNivel)} style={{ padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
          <option value="TODOS">Todos los niveles</option>
          <option value="OPTIMO">Óptimo</option>
          <option value="BAJO">Bajo</option>
          <option value="CRITICO">Crítico</option>
        </select>
        <button onClick={() => setModalConteo(true)} style={{ background: "var(--h421-amber-bg)", color: "var(--h421-amber-texto)", border: "1px solid var(--h421-amber)", padding: "10px 14px", fontSize: 13, minHeight: 0 }}>📋 Hacer Inventario</button>
        <button onClick={() => setModalReporte(true)} style={{ background: "var(--h421-green-bg)", color: "var(--h421-green)", border: "1px solid var(--h421-green)", padding: "10px 14px", fontSize: 13, minHeight: 0 }}>📄 Generar Reporte</button>
        <button onClick={() => setModalListaCompras(true)} style={{ background: "var(--h421-green-bg)", color: "var(--h421-green)", border: "1px solid var(--h421-green)", padding: "10px 14px", fontSize: 13, minHeight: 0 }}>🛒 Lista de Compras</button>
        <button onClick={() => { setModalMovimientosRecientes(true); cargarMovimientosRecientes(sucursalId); }} style={{ background: "transparent", color: "var(--h421-blue)", border: "1px solid var(--h421-blue)", padding: "10px 14px", fontSize: 13, minHeight: 0 }}>🔄 Movimientos</button>
        <button onClick={() => { setModalHistorial(true); cargarMovimientosRecientes(sucursalId); }} style={{ background: "transparent", color: "#8b5cf6", border: "1px solid #8b5cf6", padding: "10px 14px", fontSize: 13, minHeight: 0 }}>🕘 Historial</button>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
              <th style={{ padding: 8 }}>Insumo</th>
              <th style={{ padding: 8 }}>Proveedor</th>
              <th style={{ padding: 8 }}>Existencia</th>
              <th style={{ padding: 8 }}>Mínimo</th>
              <th style={{ padding: 8 }}>Nivel</th>
              <th style={{ padding: 8 }}>Estado</th>
              <th style={{ padding: 8 }}>Costo</th>
              <th style={{ padding: 8 }}>Venta</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const i = f.insumo;
              if (editandoInsumoId === i.id) {
                return (
                  <tr key={i.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                    <td style={{ padding: 8 }}>
                      <input value={borradorInsumo.nombre} onChange={(e) => setBorradorInsumo((b) => ({ ...b, nombre: e.target.value }))}
                        style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                    <td style={{ padding: 8 }}>
                      <select value={borradorInsumo.proveedorId} onChange={(e) => setBorradorInsumo((b) => ({ ...b, proveedorId: e.target.value }))} style={{ padding: 6 }}>
                        <option value="">—</option>
                        {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 8, color: "var(--h421-gray-400)" }}>{f.existencia} {i.unidadMedida}</td>
                    <td style={{ padding: 8 }}>
                      <input type="number" value={borradorInsumo.minimo} onChange={(e) => setBorradorInsumo((b) => ({ ...b, minimo: e.target.value }))}
                        style={{ width: 60, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                    <td style={{ padding: 8 }} colSpan={2}>
                      <input type="number" placeholder="Máximo" value={borradorInsumo.maximo} onChange={(e) => setBorradorInsumo((b) => ({ ...b, maximo: e.target.value }))}
                        style={{ width: 90, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                    <td style={{ padding: 8 }}>
                      <input type="number" value={borradorInsumo.costoUnitario} onChange={(e) => setBorradorInsumo((b) => ({ ...b, costoUnitario: e.target.value }))}
                        style={{ width: 70, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                    <td style={{ padding: 8 }}>
                      <input type="number" value={borradorInsumo.precioVenta} onChange={(e) => setBorradorInsumo((b) => ({ ...b, precioVenta: e.target.value }))}
                        style={{ width: 70, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                    <td style={{ padding: 8, display: "flex", gap: 6 }}>
                      <button onClick={() => guardarEdicionInsumo(i.id)} style={{ background: "var(--h421-green)", color: "#fff", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>Guardar</button>
                      <button onClick={() => setEditandoInsumoId(null)} style={{ background: "var(--h421-gray-200)", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>Cancelar</button>
                    </td>
                  </tr>
                );
              }
              const colores = COLOR_NIVEL[f.nivel];
              return (
                <tr key={i.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{i.nombre}</td>
                  <td style={{ padding: 8 }}>{i.proveedor?.nombre ?? "—"}</td>
                  <td style={{ padding: 8 }}>{f.existencia} {i.unidadMedida}</td>
                  <td style={{ padding: 8 }}>{f.minimo} {i.unidadMedida}</td>
                  <td style={{ padding: 8, minWidth: 140 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--h421-gray-200)", overflow: "hidden" }}>
                        <div style={{ width: `${f.porcentaje}%`, height: "100%", background: colores.barra }} />
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: 8 }}>
                    <span style={{ background: colores.bg, color: colores.texto, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                      {ETIQUETA_NIVEL[f.nivel]}
                    </span>
                  </td>
                  <td style={{ padding: 8 }}>${Number(i.costoUnitario).toFixed(2)}</td>
                  <td style={{ padding: 8 }}>{i.precioVenta != null ? `$${Number(i.precioVenta).toFixed(2)}` : "—"}</td>
                  <td style={{ padding: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => empezarEdicionInsumo(f)} style={{ background: "var(--h421-gray-50)", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>✏️ Editar</button>
                    <button onClick={() => { setModalMovimiento(i); setMov({ tipo: "ENTRADA", cantidad: "", motivo: "" }); }} style={{ background: "transparent", color: "var(--h421-blue)", border: "1px solid var(--h421-blue)", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>Menú</button>
                    <button onClick={() => { setModalTraspaso(i); setTraspaso({ sucursalDestinoId: "", cantidad: "" }); }} style={{ background: "transparent", color: "#8b5cf6", border: "1px solid #8b5cf6", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>Traspasar</button>
                    <button onClick={() => eliminarInsumo(i)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "4px 10px", fontSize: 12, minHeight: 0 }}>Eliminar</button>
                  </td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin insumos que coincidan.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Nuevo insumo</h3>
          <input placeholder="Nombre (ej. Leche entera)" value={nuevoInsumo.nombre} onChange={(e) => setNuevoInsumo((n) => ({ ...n, nombre: e.target.value }))}
            style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={nuevoInsumo.unidadMedida} onChange={(e) => setNuevoInsumo((n) => ({ ...n, unidadMedida: e.target.value }))} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
              <option value="pz">pz</option>
              <option value="g">g</option>
              <option value="kg">kg</option>
              <option value="ml">ml</option>
              <option value="l">l</option>
            </select>
            <select value={nuevoInsumo.proveedorId} onChange={(e) => setNuevoInsumo((n) => ({ ...n, proveedorId: e.target.value }))} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
              <option value="">Proveedor…</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input placeholder="Precio costo" type="number" value={nuevoInsumo.costoUnitario} onChange={(e) => setNuevoInsumo((n) => ({ ...n, costoUnitario: e.target.value }))}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            <input placeholder="Precio venta (si se vende directo)" type="number" value={nuevoInsumo.precioVenta} onChange={(e) => setNuevoInsumo((n) => ({ ...n, precioVenta: e.target.value }))}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Stock mínimo" type="number" value={nuevoInsumo.minimo} onChange={(e) => setNuevoInsumo((n) => ({ ...n, minimo: e.target.value }))}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            <input placeholder="Stock máximo" type="number" value={nuevoInsumo.maximo} onChange={(e) => setNuevoInsumo((n) => ({ ...n, maximo: e.target.value }))}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          </div>
          <p style={{ fontSize: 11, color: "var(--h421-gray-400)", margin: "4px 0 0" }}>
            El mínimo/máximo aplica a todas las sucursales al crear el insumo — se puede ajustar después por sucursal desde &quot;Editar&quot;.
          </p>
          <button onClick={crearInsumo} style={{ width: "100%", marginTop: 8, background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>Crear insumo</button>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Proveedores</h3>
          {proveedores.length === 0 && <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Sin proveedores dados de alta todavía.</p>}
          {proveedores.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--h421-gray-200)", fontSize: 14 }}>
              <span>{p.nombre}{p.telefono ? ` · ${p.telefono}` : ""}</span>
              <button onClick={() => eliminarProveedor(p)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "4px 8px", fontSize: 12, minHeight: 0 }}>Eliminar</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input placeholder="Nombre del proveedor" value={nuevoProveedor.nombre} onChange={(e) => setNuevoProveedor((p) => ({ ...p, nombre: e.target.value }))}
              style={{ flex: 2, padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            <input placeholder="Teléfono (opcional)" value={nuevoProveedor.telefono} onChange={(e) => setNuevoProveedor((p) => ({ ...p, telefono: e.target.value }))}
              style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            <button onClick={crearProveedor} style={{ background: "var(--h421-navy)", color: "#fff", padding: "0 14px" }}>+</button>
          </div>
        </div>
      </div>

      {modalMovimiento && (
        <Modal titulo={`Movimiento — ${modalMovimiento.nombre}`} ancho={420} onCerrar={() => setModalMovimiento(null)}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={mov.tipo} onChange={(e) => setMov((m) => ({ ...m, tipo: e.target.value }))} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
              {TIPOS_MOVIMIENTO.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Cantidad" type="number" value={mov.cantidad} onChange={(e) => setMov((m) => ({ ...m, cantidad: e.target.value }))}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          </div>
          <input placeholder="Motivo (opcional)" value={mov.motivo} onChange={(e) => setMov((m) => ({ ...m, motivo: e.target.value }))}
            style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          <button onClick={registrarMovimiento} style={{ width: "100%", background: "var(--h421-navy)", color: "#fff", padding: "10px 16px" }}>Registrar</button>
        </Modal>
      )}

      {modalMovimientosRecientes && (
        <Modal titulo="Movimientos recientes" ancho={700} onCerrar={() => setModalMovimientosRecientes(false)}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                <th style={{ padding: 8 }}>Fecha</th>
                <th style={{ padding: 8 }}>Insumo</th>
                <th style={{ padding: 8 }}>Tipo</th>
                <th style={{ padding: 8 }}>Cantidad</th>
                <th style={{ padding: 8 }}>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.slice(0, 30).map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <td style={{ padding: 8 }}>{new Date(m.createdAt).toLocaleString("es-MX")}</td>
                  <td style={{ padding: 8 }}>{m.insumo.nombre}</td>
                  <td style={{ padding: 8 }}>{m.tipo}</td>
                  <td style={{ padding: 8 }}>{m.cantidad} {m.insumo.unidadMedida}</td>
                  <td style={{ padding: 8, color: "var(--h421-gray-400)" }}>{m.motivo ?? "—"}</td>
                </tr>
              ))}
              {movimientos.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin movimientos todavía.</td></tr>
              )}
            </tbody>
          </table>
        </Modal>
      )}

      {modalHistorial && (
        <Modal titulo="Historial de movimientos" ancho={760} onCerrar={() => setModalHistorial(false)}>
          <div style={{ marginBottom: 10 }}>
            <select value={historialInsumoId} onChange={(e) => setHistorialInsumoId(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
              <option value="">Todos los insumos</option>
              {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
            </select>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                <th style={{ padding: 8 }}>Fecha</th>
                <th style={{ padding: 8 }}>Insumo</th>
                <th style={{ padding: 8 }}>Tipo</th>
                <th style={{ padding: 8 }}>Cantidad</th>
                <th style={{ padding: 8 }}>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movimientosHistorial.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <td style={{ padding: 8 }}>{new Date(m.createdAt).toLocaleString("es-MX")}</td>
                  <td style={{ padding: 8 }}>{m.insumo.nombre}</td>
                  <td style={{ padding: 8 }}>{m.tipo}</td>
                  <td style={{ padding: 8 }}>{m.cantidad} {m.insumo.unidadMedida}</td>
                  <td style={{ padding: 8, color: "var(--h421-gray-400)" }}>{m.motivo ?? "—"}</td>
                </tr>
              ))}
              {movimientosHistorial.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin movimientos todavía.</td></tr>
              )}
            </tbody>
          </table>
        </Modal>
      )}

      {modalConteo && (
        <Modal titulo="Hacer inventario (conteo físico)" ancho={700} onCerrar={() => setModalConteo(false)}>
          <p style={{ fontSize: 13, color: "var(--h421-gray-400)", marginTop: 0 }}>
            Captura la cantidad que contaste físicamente de cada insumo. Solo se ajustan los que dejes con un valor distinto al actual.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                <th style={{ padding: 8 }}>Insumo</th>
                <th style={{ padding: 8 }}>Existencia actual</th>
                <th style={{ padding: 8 }}>Contado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, indice) => (
                <tr key={f.insumo.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <td style={{ padding: 8 }}>{f.insumo.nombre}</td>
                  <td style={{ padding: 8, color: "var(--h421-gray-400)" }}>{f.existencia} {f.insumo.unidadMedida}</td>
                  <td style={{ padding: 8 }}>
                    <input
                      type="number" inputMode="decimal" step="0.01"
                      placeholder={String(f.existencia)} value={conteo[f.insumo.id] ?? ""}
                      ref={(el) => { inputsConteoRef.current[indice] = el; }}
                      onChange={(e) => setConteo((c) => ({ ...c, [f.insumo.id]: e.target.value }))}
                      onKeyDown={(e) => moverFocoConteo(e, indice)}
                      style={{ width: 90, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={guardarConteo} disabled={guardandoConteo} style={{ width: "100%", marginTop: 12, background: "var(--h421-navy)", color: "#fff", padding: "10px 16px" }}>
            {guardandoConteo ? "Guardando…" : "Guardar conteo"}
          </button>
        </Modal>
      )}

      {modalTraspaso && (
        <Modal titulo={`Traspasar — ${modalTraspaso.nombre}`} ancho={420} onCerrar={() => setModalTraspaso(null)}>
          <select value={traspaso.sucursalDestinoId} onChange={(e) => setTraspaso((t) => ({ ...t, sucursalDestinoId: e.target.value }))}
            style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
            <option value="">Sucursal destino…</option>
            {sucursales.filter((s) => s.id !== sucursalId).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <input placeholder="Cantidad" type="number" value={traspaso.cantidad} onChange={(e) => setTraspaso((t) => ({ ...t, cantidad: e.target.value }))}
            style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          <p style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>Se descuenta de esta sucursal de inmediato y queda pendiente de recibir en destino.</p>
          <button onClick={confirmarTraspaso} disabled={!traspaso.sucursalDestinoId || !traspaso.cantidad} style={{ width: "100%", background: "#8b5cf6", color: "#fff", padding: "10px 16px" }}>Enviar traspaso</button>
        </Modal>
      )}

      {modalReporte && <ReporteInventario tipo="reporte" filas={filas} onCerrar={() => setModalReporte(false)} />}
      {modalListaCompras && <ReporteInventario tipo="compras" filas={filas} onCerrar={() => setModalListaCompras(false)} />}
    </div>
  );
}
