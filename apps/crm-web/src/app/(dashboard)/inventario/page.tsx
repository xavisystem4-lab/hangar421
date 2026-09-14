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
  insumo: { nombre: string; unidadMedida: string };
}

const TIPOS_MOVIMIENTO = ["ENTRADA", "SALIDA", "AJUSTE", "MERMA", "CONTEO"];

export default function InventarioPage() {
  const { contexto } = useAuthCrm();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [alertas, setAlertas] = useState<Existencia[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [nuevoInsumo, setNuevoInsumo] = useState({
    nombre: "", unidadMedida: "pz", costoUnitario: "", precioVenta: "", proveedorId: "", minimo: "", maximo: "",
  });
  const [mov, setMov] = useState({ insumoId: "", tipo: "ENTRADA", cantidad: "", motivo: "" });
  const [minimos, setMinimos] = useState<Record<string, string>>({});

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [nuevoProveedor, setNuevoProveedor] = useState({ nombre: "", telefono: "" });

  // Edición inline de un insumo (nombre, unidad, costo, precio de venta, proveedor) — mismo
  // patrón que el catálogo de productos: sin modal, se edita en el lugar.
  const [editandoInsumoId, setEditandoInsumoId] = useState<string | null>(null);
  const [borradorInsumo, setBorradorInsumo] = useState({ nombre: "", unidadMedida: "pz", costoUnitario: "", precioVenta: "", proveedorId: "" });

  async function cargar(suc: string) {
    if (!contexto || !suc) return;
    const [ex, al, ins, movs] = await Promise.all([
      apiFetch<Existencia[]>(`/inventario/existencias?sucursalId=${suc}`),
      apiFetch<Existencia[]>(`/inventario/alertas?sucursalId=${suc}`),
      apiFetch<Insumo[]>(`/inventario/insumos?empresaId=${contexto.usuario.empresaId}`),
      apiFetch<Movimiento[]>(`/inventario/movimientos?sucursalId=${suc}`),
    ]);
    setExistencias(ex);
    setAlertas(al);
    setInsumos(ins);
    setMovimientos(movs);
    if (!mov.insumoId && ins[0]) setMov((m) => ({ ...m, insumoId: ins[0].id }));
  }

  function cargarProveedores() {
    if (!contexto) return;
    apiFetch<Proveedor[]>(`/proveedores?empresaId=${contexto.usuario.empresaId}`).then(setProveedores);
  }

  useEffect(() => {
    if (!contexto) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${contexto.usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargar(s[0].id); }
    });
    cargarProveedores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto]);

  async function crearInsumo() {
    if (!contexto || !nuevoInsumo.nombre.trim()) return;
    await apiFetch("/inventario/insumos", {
      method: "POST",
      body: JSON.stringify({
        empresaId: contexto.usuario.empresaId,
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

  function empezarEdicionInsumo(i: Insumo) {
    setEditandoInsumoId(i.id);
    setBorradorInsumo({
      nombre: i.nombre, unidadMedida: i.unidadMedida, costoUnitario: i.costoUnitario,
      precioVenta: i.precioVenta ?? "", proveedorId: i.proveedorId ?? "",
    });
  }

  async function guardarEdicionInsumo(id: string) {
    if (!borradorInsumo.nombre.trim()) return;
    await apiFetch(`/inventario/insumos/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        nombre: borradorInsumo.nombre,
        unidadMedida: borradorInsumo.unidadMedida,
        costoUnitario: Number(borradorInsumo.costoUnitario) || 0,
        precioVenta: borradorInsumo.precioVenta ? Number(borradorInsumo.precioVenta) : null,
        proveedorId: borradorInsumo.proveedorId || null,
      }),
    });
    setEditandoInsumoId(null);
    setMensaje("Insumo actualizado.");
    cargar(sucursalId);
  }

  // Baja lógica — nunca se borra el registro (conserva el historial de movimientos/recetas que
  // ya lo referencian), solo deja de listarse (listarInsumos filtra activo: true).
  async function eliminarInsumo(i: Insumo) {
    if (!confirm(`¿Eliminar "${i.nombre}"? Deja de aparecer en inventario y en recetas nuevas (el historial ya registrado no se pierde).`)) return;
    await apiFetch(`/inventario/insumos/${i.id}`, { method: "PATCH", body: JSON.stringify({ activo: false }) });
    setMensaje("Insumo eliminado.");
    cargar(sucursalId);
  }

  async function crearProveedor() {
    if (!contexto || !nuevoProveedor.nombre.trim()) return;
    await apiFetch("/proveedores", {
      method: "POST",
      body: JSON.stringify({ empresaId: contexto.usuario.empresaId, nombre: nuevoProveedor.nombre, telefono: nuevoProveedor.telefono || undefined }),
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
    if (!contexto || !mov.insumoId || !mov.cantidad) return;
    await apiFetch("/inventario/movimientos", {
      method: "POST",
      body: JSON.stringify({
        sucursalId,
        insumoId: mov.insumoId,
        tipo: mov.tipo,
        cantidad: Number(mov.cantidad),
        motivo: mov.motivo || undefined,
        usuarioId: contexto.usuario.id,
      }),
    });
    setMov((m) => ({ ...m, cantidad: "", motivo: "" }));
    setMensaje("Movimiento registrado.");
    cargar(sucursalId);
  }

  async function guardarMinimo(insumoId: string) {
    const valor = minimos[insumoId];
    if (valor === undefined) return;
    await apiFetch("/inventario/minimos", {
      method: "POST",
      body: JSON.stringify({ sucursalId, insumoId, minimo: Number(valor) }),
    });
    cargar(sucursalId);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginTop: 0 }}>Inventario</h1>
        <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); cargar(e.target.value); }} style={{ padding: 8 }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {mensaje && <p style={{ color: "var(--h421-navy-texto)" }}>{mensaje}</p>}

      {alertas.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid var(--h421-yellow)", marginBottom: 16 }}>
          <strong style={{ color: "var(--h421-amber-texto)" }}>⚠ {alertas.length} insumo(s) en nivel mínimo</strong>
          <ul>
            {alertas.map((a) => <li key={a.insumoId}>{a.insumo.nombre}: {a.existencia} {a.insumo.unidadMedida}</li>)}
          </ul>
        </div>
      )}

      <div className="card" style={{ overflowX: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Existencias por sucursal</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
              <th style={{ padding: 8 }}>Insumo</th>
              <th style={{ padding: 8 }}>Existencia</th>
              <th style={{ padding: 8 }}>Mínimo</th>
              <th style={{ padding: 8 }}>Estado</th>
              <th style={{ padding: 8 }}>Cambiar mínimo</th>
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
                  <td style={{ padding: 8, color: bajo ? "var(--h421-red-texto)" : "var(--h421-green)" }}>{bajo ? "Bajo" : "OK"}</td>
                  <td style={{ padding: 8, display: "flex", gap: 6 }}>
                    <input type="number" placeholder={e.minimo} value={minimos[e.insumoId] ?? ""} onChange={(ev) => setMinimos((m) => ({ ...m, [e.insumoId]: ev.target.value }))}
                      style={{ width: 70, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    <button onClick={() => guardarMinimo(e.insumoId)} style={{ background: "var(--h421-navy)", color: "#fff", padding: "4px 10px", fontSize: 12 }}>Guardar</button>
                  </td>
                </tr>
              );
            })}
            {existencias.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin existencias registradas todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ overflowX: "auto", marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Insumos</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
              <th style={{ padding: 8 }}>Nombre</th>
              <th style={{ padding: 8 }}>Unidad</th>
              <th style={{ padding: 8 }}>Cantidad existente</th>
              <th style={{ padding: 8 }}>Proveedor</th>
              <th style={{ padding: 8 }}>Precio costo</th>
              <th style={{ padding: 8 }}>Precio venta</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {insumos.map((i) => {
              // Existencia de este insumo en la sucursal seleccionada arriba (mismo dato que la
              // tabla "Existencias por sucursal") — aquí solo se muestra, se sigue editando desde
              // "Registrar movimiento" o el campo de mínimo de esa tabla, nunca desde aquí.
              const existencia = existencias.find((e) => e.insumoId === i.id);
              if (editandoInsumoId === i.id) {
                return (
                  <tr key={i.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                    <td style={{ padding: 8 }}>
                      <input value={borradorInsumo.nombre} onChange={(e) => setBorradorInsumo((b) => ({ ...b, nombre: e.target.value }))}
                        style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                    <td style={{ padding: 8 }}>
                      <select value={borradorInsumo.unidadMedida} onChange={(e) => setBorradorInsumo((b) => ({ ...b, unidadMedida: e.target.value }))} style={{ padding: 6 }}>
                        <option value="pz">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option>
                      </select>
                    </td>
                    <td style={{ padding: 8, color: "var(--h421-gray-400)" }}>{existencia ? `${existencia.existencia} ${i.unidadMedida}` : "—"}</td>
                    <td style={{ padding: 8 }}>
                      <select value={borradorInsumo.proveedorId} onChange={(e) => setBorradorInsumo((b) => ({ ...b, proveedorId: e.target.value }))} style={{ padding: 6 }}>
                        <option value="">—</option>
                        {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 8 }}>
                      <input type="number" value={borradorInsumo.costoUnitario} onChange={(e) => setBorradorInsumo((b) => ({ ...b, costoUnitario: e.target.value }))}
                        style={{ width: 80, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                    <td style={{ padding: 8 }}>
                      <input type="number" value={borradorInsumo.precioVenta} onChange={(e) => setBorradorInsumo((b) => ({ ...b, precioVenta: e.target.value }))}
                        style={{ width: 80, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                    <td style={{ padding: 8, display: "flex", gap: 6 }}>
                      <button onClick={() => guardarEdicionInsumo(i.id)} style={{ background: "var(--h421-green)", color: "#fff", padding: "4px 10px", fontSize: 12 }}>Guardar</button>
                      <button onClick={() => setEditandoInsumoId(null)} style={{ background: "var(--h421-gray-200)", padding: "4px 10px", fontSize: 12 }}>Cancelar</button>
                    </td>
                  </tr>
                );
              }
              const bajo = existencia && Number(existencia.existencia) <= Number(existencia.minimo);
              return (
                <tr key={i.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <td style={{ padding: 8 }}>{i.nombre}</td>
                  <td style={{ padding: 8 }}>{i.unidadMedida}</td>
                  <td style={{ padding: 8, color: bajo ? "var(--h421-red-texto)" : undefined, fontWeight: bajo ? 700 : undefined }}>
                    {existencia ? `${existencia.existencia} ${i.unidadMedida}` : "—"}
                  </td>
                  <td style={{ padding: 8 }}>{i.proveedor?.nombre ?? "—"}</td>
                  <td style={{ padding: 8 }}>${Number(i.costoUnitario).toFixed(2)}</td>
                  <td style={{ padding: 8 }}>{i.precioVenta != null ? `$${Number(i.precioVenta).toFixed(2)}` : "—"}</td>
                  <td style={{ padding: 8, display: "flex", gap: 6 }}>
                    <button onClick={() => empezarEdicionInsumo(i)} style={{ background: "var(--h421-gray-50)", padding: "4px 10px", fontSize: 12 }}>Editar</button>
                    <button onClick={() => eliminarInsumo(i)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "4px 10px", fontSize: 12 }}>Eliminar</button>
                  </td>
                </tr>
              );
            })}
            {insumos.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin insumos todavía.</td></tr>
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
            <select value={nuevoInsumo.unidadMedida} onChange={(e) => setNuevoInsumo((n) => ({ ...n, unidadMedida: e.target.value }))} style={{ flex: 1, padding: 10 }}>
              <option value="pz">pz</option>
              <option value="g">g</option>
              <option value="kg">kg</option>
              <option value="ml">ml</option>
              <option value="l">l</option>
            </select>
            <select value={nuevoInsumo.proveedorId} onChange={(e) => setNuevoInsumo((n) => ({ ...n, proveedorId: e.target.value }))} style={{ flex: 1, padding: 10 }}>
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
            El mínimo/máximo aplica a todas las sucursales al crear el insumo — se puede ajustar después por sucursal abajo en &quot;Existencias por sucursal&quot;.
          </p>
          <button onClick={crearInsumo} style={{ width: "100%", marginTop: 8, background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>Crear insumo</button>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Proveedores</h3>
          {proveedores.length === 0 && <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Sin proveedores dados de alta todavía.</p>}
          {proveedores.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--h421-gray-200)", fontSize: 14 }}>
              <span>{p.nombre}{p.telefono ? ` · ${p.telefono}` : ""}</span>
              <button onClick={() => eliminarProveedor(p)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "4px 8px", fontSize: 12 }}>Eliminar</button>
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

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Registrar movimiento</h3>
          <select value={mov.insumoId} onChange={(e) => setMov((m) => ({ ...m, insumoId: e.target.value }))} style={{ width: "100%", padding: 10, marginBottom: 8 }}>
            {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={mov.tipo} onChange={(e) => setMov((m) => ({ ...m, tipo: e.target.value }))} style={{ flex: 1, padding: 10 }}>
              {TIPOS_MOVIMIENTO.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Cantidad" type="number" value={mov.cantidad} onChange={(e) => setMov((m) => ({ ...m, cantidad: e.target.value }))}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          </div>
          <input placeholder="Motivo (opcional)" value={mov.motivo} onChange={(e) => setMov((m) => ({ ...m, motivo: e.target.value }))}
            style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          <button onClick={registrarMovimiento} style={{ width: "100%", background: "var(--h421-navy)", color: "#fff", padding: "10px 16px" }}>Registrar</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Movimientos recientes</h3>
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
      </div>
    </div>
  );
}
