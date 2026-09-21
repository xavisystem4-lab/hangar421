"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { useSucursalActiva } from "@/store/sucursalActiva";
import { StatTile } from "@/components/StatTile";
import { IndicadorEnVivo } from "@/components/IndicadorEnVivo";
import { suscribirVentas } from "@/lib/realtime";
import { CanalOrigen } from "@hangar421/shared";

interface LineaVenta {
  id: string;
  nombre: string;
  cantidad: number;
  subtotal: number;
}

interface Venta {
  id: string;
  folio: string;
  fecha: string;
  estado: string;
  canalOrigen: string;
  total: number;
  subtotal: number;
  descuento: number;
  impuestos: number;
  sucursal: { id: string; nombre: string } | null;
  mesero: { id: string; nombre: string } | null;
  cajero: { id: string; nombre: string } | null;
  dispositivo: { id: string; nombre: string; tipo: string } | null;
  turno: { id: string; estado: string; fechaApertura: string; fechaCierre: string | null } | null;
  numItems: number;
  items: LineaVenta[];
  pagos: { metodo: string; monto: number }[];
}

interface RespuestaVentas {
  rango: { desde: string; hasta: string; zona: string };
  resumen: {
    totalVendido: number;
    numTickets: number;
    ticketPromedio: number;
    porEstado: { estado: string; cantidad: number; total: number }[];
  };
  desglose: {
    porCanal: GrupoDesglose[];
    porUsuario: GrupoDesglose[];
    porDispositivo: GrupoDesglose[];
  };
  paginacion: { total: number; limite: number; offset: number };
  items: Venta[];
}

interface GrupoDesglose {
  clave: string;
  nombre: string;
  numTickets: number;
  total: number;
}

interface OpcionesFiltro {
  usuarios: { id: string; nombre: string }[];
  dispositivos: { id: string; nombre: string; tipo: string; sucursal: string }[];
}

/** Filtros de trazabilidad: quién, desde qué plataforma y equipo, y en qué turno. */
interface FiltroOrigen {
  usuarioId: string;
  canalOrigen: string;
  dispositivoId: string;
  turnoId: string;
  estadoTurno: string;
}

const SIN_FILTRO_ORIGEN: FiltroOrigen = { usuarioId: "", canalOrigen: "", dispositivoId: "", turnoId: "", estadoTurno: "" };

/** Filtros que llegan en la URL — la pantalla de Turnos enlaza aquí con `?turnoId=…&desde=…`
 *  para ver las ventas de un turno. Se lee una sola vez al montar. */
function filtrosDeLaUrl(): Partial<FiltroOrigen> & { desde?: string; hasta?: string } {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const leer = (k: string) => q.get(k) ?? undefined;
  return {
    usuarioId: leer("usuarioId"),
    canalOrigen: leer("canalOrigen"),
    dispositivoId: leer("dispositivoId"),
    turnoId: leer("turnoId"),
    estadoTurno: leer("estadoTurno"),
    desde: leer("desde"),
    hasta: leer("hasta"),
  };
}

interface ProblemaSync {
  id: string;
  entidad: string;
  entidadId: string;
  operacion: string;
  intentos: number;
  ultimoError: string | null;
  createdAt: string;
  terminal: string;
  tipoTerminal: string;
  sucursal: { id: string; nombre: string } | null;
}

const POR_PAGINA = 50;

/** Colores por estado. Solo COBRADO cuenta como venta cerrada; el resto son tickets en curso o
 *  anulados y se marcan para que salten a la vista. */
const COLOR_ESTADO: Record<string, string> = {
  COBRADO: "var(--h421-green)",
  CANCELADO: "var(--h421-red)",
  ABIERTO: "var(--h421-amber)",
  ENVIADO: "var(--h421-amber)",
  EN_PREPARACION: "var(--h421-amber)",
  LISTO: "var(--h421-amber)",
  ENTREGADO: "var(--h421-amber)",
  POR_COBRAR: "var(--h421-amber)",
};

/** Debe coincidir con el enum `CanalOrigen` de @hangar421/shared. Estaba escrito a mano con dos
 *  valores inventados (`POS_ESCRITORIO`, `WEB`) que no existen: una venta del POS de Windows
 *  salía en la tabla como el texto crudo "POS_WINDOWS". */
const ETIQUETA_CANAL: Record<CanalOrigen, string> = {
  [CanalOrigen.APP_POS_MOVIL]: "APK Punto de Venta",
  [CanalOrigen.POS_WINDOWS]: "POS Windows",
  [CanalOrigen.APP_MESERO]: "Comandero",
  [CanalOrigen.CRM]: "ERP web",
  [CanalOrigen.PLATAFORMA_DELIVERY]: "Plataforma de reparto",
};

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function VentasPage() {
  const { contexto } = useAuthCrm();
  const { seleccion } = useSucursalActiva();

  const [deUrl] = useState(filtrosDeLaUrl);
  const [desde, setDesde] = useState(deUrl.desde ?? hoyLocal());
  const [hasta, setHasta] = useState(deUrl.hasta ?? deUrl.desde ?? hoyLocal());
  const [origen, setOrigen] = useState<FiltroOrigen>(() => ({
    ...SIN_FILTRO_ORIGEN,
    ...Object.fromEntries(Object.entries(deUrl).filter(([k, v]) => v && k in SIN_FILTRO_ORIGEN)),
  }));
  const [opciones, setOpciones] = useState<OpcionesFiltro>({ usuarios: [], dispositivos: [] });
  const [estado, setEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [pagina, setPagina] = useState(0);

  const [datos, setDatos] = useState<RespuestaVentas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [actualizadoEn, setActualizadoEn] = useState<Date | null>(null);
  const [problemas, setProblemas] = useState<ProblemaSync[]>([]);

  const cargar = useCallback(async () => {
    if (!contexto) return;
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde, hasta, limite: String(POR_PAGINA), offset: String(pagina * POR_PAGINA) });
      if (seleccion?.sucursalId) params.set("sucursalId", seleccion.sucursalId);
      if (estado) params.set("estado", estado);
      if (busquedaAplicada.trim()) params.set("busqueda", busquedaAplicada.trim());
      for (const [clave, valor] of Object.entries(origen)) if (valor) params.set(clave, valor);
      setDatos(await apiFetch<RespuestaVentas>(`/pedidos/ventas?${params}`));
      setActualizadoEn(new Date());

      // Aparte y sin bloquear la tabla: son operaciones que el ERP RECHAZÓ, así que por
      // definición no están entre las ventas de arriba. Si esta consulta falla, la pantalla
      // principal debe seguir funcionando.
      const paramsProblemas = new URLSearchParams();
      if (seleccion?.sucursalId) paramsProblemas.set("sucursalId", seleccion.sucursalId);
      apiFetch<ProblemaSync[]>(`/sync/problemas?${paramsProblemas}`)
        .then(setProblemas)
        .catch(() => setProblemas([]));
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar las ventas");
    } finally {
      setCargando(false);
    }
  }, [contexto, seleccion?.sucursalId, desde, hasta, estado, busquedaAplicada, pagina, origen]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Opciones de los selectores: solo cambian con la sucursal. Si fallan, los filtros quedan
  // vacíos pero la tabla sigue funcionando.
  useEffect(() => {
    if (!contexto) return;
    const params = new URLSearchParams();
    if (seleccion?.sucursalId) params.set("sucursalId", seleccion.sucursalId);
    apiFetch<OpcionesFiltro>(`/pedidos/ventas/opciones?${params}`)
      .then(setOpciones)
      .catch(() => setOpciones({ usuarios: [], dispositivos: [] }));
  }, [contexto, seleccion?.sucursalId]);

  function filtrarOrigen(cambio: Partial<FiltroOrigen>) {
    cambiarFiltro(() => setOrigen((o) => ({ ...o, ...cambio })));
  }

  // Una venta que entra por sincronización debe aparecer sin recargar: es justo lo que se está
  // mirando cuando se abre esta pantalla después de cobrar en la terminal.
  //
  // `cargar` se guarda en una ref y NO va en las dependencias: cambia con cada filtro, y si la
  // suscripción dependiera de ella el socket se re-suscribiría en cada tecla del buscador.
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;

  useEffect(() => {
    if (!contexto) return;
    return suscribirVentas(contexto.usuario.empresaId, seleccion?.sucursalId ?? null, () => cargarRef.current());
  }, [contexto, seleccion?.sucursalId]);

  // El buscador lanzaba una consulta por cada tecla: escribir "Latte" eran cinco peticiones al
  // ERP, de las que solo la última importa. Se espera a que el cajero deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => {
      setBusquedaAplicada(busqueda);
      setPagina(0);
    }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Cambiar cualquier filtro vuelve a la primera página: quedarse en la página 3 de un resultado
  // que ahora tiene 4 filas enseñaría una tabla vacía.
  function cambiarFiltro(aplicar: () => void) {
    aplicar();
    setPagina(0);
  }

  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.paginacion.total / POR_PAGINA)) : 1;
  const noCobradas = datos?.resumen.porEstado.filter((e) => e.estado !== "COBRADO" && e.estado !== "CANCELADO") ?? [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Ventas</h1>
        <IndicadorEnVivo actualizadoEn={actualizadoEn} />
      </div>
      <p style={{ color: "var(--h421-gray-400)", marginTop: -8 }}>
        Tickets de {seleccion?.nombre ?? "todas las sucursales"}. Solo consulta: cancelar un ticket o
        reabrir una cuenta se hace desde la terminal de la sucursal, con autorización.
      </p>

      <div className="card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={campo}>
          <span style={etiqueta}>Desde</span>
          <input type="date" value={desde} onChange={(e) => cambiarFiltro(() => setDesde(e.target.value))} style={entrada} />
        </label>
        <label style={campo}>
          <span style={etiqueta}>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => cambiarFiltro(() => setHasta(e.target.value))} style={entrada} />
        </label>
        <label style={campo}>
          <span style={etiqueta}>Estado</span>
          <select value={estado} onChange={(e) => cambiarFiltro(() => setEstado(e.target.value))} style={entrada}>
            <option value="">Todos</option>
            <option value="COBRADO">Cobradas</option>
            <option value="CANCELADO">Canceladas</option>
            <option value="ABIERTO">Abiertas</option>
            <option value="ENVIADO">Enviadas</option>
            <option value="POR_COBRAR">Por cobrar</option>
          </select>
        </label>
        <label style={{ ...campo, flex: 1, minWidth: 180 }}>
          <span style={etiqueta}>Buscar folio o producto</span>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Ej. 1042, Latte…"
            style={entrada}
          />
        </label>
        <button onClick={cargar} disabled={cargando} style={{ padding: "10px 18px", background: "var(--h421-navy)", color: "#fff" }}>
          {cargando ? "Cargando…" : "Actualizar"}
        </button>

        {/* Origen de la operación. El usuario es el criterio principal: el mismo tipo de equipo
            se usa en varias sucursales, así que la plataforma sola no dice quién vendió. */}
        <div style={{ flexBasis: "100%", height: 0 }} />
        <label style={campo}>
          <span style={etiqueta}>Usuario</span>
          <select value={origen.usuarioId} onChange={(e) => filtrarOrigen({ usuarioId: e.target.value })} style={entrada}>
            <option value="">Todos</option>
            {opciones.usuarios.map((u) => (
              <option key={u.id} value={u.id}>{u.nombre}</option>
            ))}
          </select>
        </label>
        <label style={campo}>
          <span style={etiqueta}>Plataforma</span>
          <select value={origen.canalOrigen} onChange={(e) => filtrarOrigen({ canalOrigen: e.target.value })} style={entrada}>
            <option value="">Todas</option>
            {Object.entries(ETIQUETA_CANAL).map(([valor, texto]) => (
              <option key={valor} value={valor}>{texto}</option>
            ))}
          </select>
        </label>
        <label style={campo}>
          <span style={etiqueta}>Dispositivo</span>
          <select value={origen.dispositivoId} onChange={(e) => filtrarOrigen({ dispositivoId: e.target.value })} style={entrada}>
            <option value="">Todos</option>
            {opciones.dispositivos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}{!seleccion?.sucursalId ? ` · ${d.sucursal}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label style={campo}>
          <span style={etiqueta}>Estado del turno</span>
          <select value={origen.estadoTurno} onChange={(e) => filtrarOrigen({ estadoTurno: e.target.value })} style={entrada}>
            <option value="">Todos</option>
            <option value="ABIERTO">Turno abierto</option>
            <option value="CERRADO">Turno cerrado</option>
            <option value="SIN_TURNO">Sin turno</option>
          </select>
        </label>
        {origen.turnoId && (
          <button onClick={() => filtrarOrigen({ turnoId: "" })} style={{ padding: "9px 12px", background: "var(--h421-gray-50)", border: "1px solid var(--h421-gray-200)" }}>
            Solo un turno ✕
          </button>
        )}
        {Object.values(origen).some(Boolean) && (
          <button onClick={() => cambiarFiltro(() => setOrigen(SIN_FILTRO_ORIGEN))} style={{ padding: "9px 12px", background: "transparent", textDecoration: "underline" }}>
            Quitar filtros de origen
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--h421-red)" }}>{error}</p>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
        <StatTile etiqueta="Total vendido" valor={`$${(datos?.resumen.totalVendido ?? 0).toFixed(2)}`} acento="var(--h421-green)" />
        <StatTile etiqueta="Tickets cobrados" valor={String(datos?.resumen.numTickets ?? 0)} acento="var(--h421-blue)" />
        <StatTile etiqueta="Ticket promedio" valor={`$${(datos?.resumen.ticketPromedio ?? 0).toFixed(2)}`} acento="var(--h421-amber)" />
      </div>

      {/* Reporte por origen de las ventas cobradas del rango (no solo de la página). Tocar una
          fila filtra por ella: así se pasa del total de "Tablet 1" a sus tickets. */}
      {datos && datos.resumen.numTickets > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 16 }}>
          <TablaDesglose
            titulo="Por plataforma"
            grupos={datos.desglose.porCanal}
            nombre={(g) => ETIQUETA_CANAL[g.clave as CanalOrigen] ?? g.nombre}
            activo={origen.canalOrigen}
            onElegir={(clave) => filtrarOrigen({ canalOrigen: clave })}
          />
          <TablaDesglose
            titulo="Por usuario"
            grupos={datos.desglose.porUsuario}
            activo={origen.usuarioId}
            onElegir={(clave) => (clave === "SIN_USUARIO" ? undefined : filtrarOrigen({ usuarioId: clave }))}
          />
          <TablaDesglose
            titulo="Por dispositivo"
            grupos={datos.desglose.porDispositivo}
            activo={origen.dispositivoId}
            onElegir={(clave) => (clave === "SIN_DISPOSITIVO" ? undefined : filtrarOrigen({ dispositivoId: clave }))}
          />
        </div>
      )}

      {/* Un ticket que llegó pero cuyo pago no se sincronizó se queda sin cobrar y no suma a
          ningún total. Antes desaparecía en silencio; aquí se avisa para poder repararlo. */}
      {noCobradas.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderLeft: "4px solid var(--h421-amber)" }}>
          <strong>Hay tickets sin cobrar en este rango.</strong>
          <p style={{ margin: "6px 0 0", fontSize: 14 }}>
            {noCobradas.map((e) => `${e.cantidad} en ${e.estado.toLowerCase()}`).join(", ")}. No suman al total vendido.
            Suele ser una venta que llegó a medias: el pedido se sincronizó pero su pago no. Revísalo en la terminal,
            en Sincronización.
          </p>
        </div>
      )}

      {/* Operaciones que el ERP rechazó. NO están en la tabla de abajo — por definición nunca
          llegaron a registrarse — así que esta es la única forma de enterarse de que faltan. */}
      {problemas.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderLeft: "4px solid var(--h421-red)" }}>
          <strong>{problemas.length} operación(es) rechazadas por el ERP.</strong>
          <p style={{ margin: "6px 0 10px", fontSize: 14 }}>
            No se registraron y no aparecen abajo. Siguen en la cola de su terminal: se reintentan solas, pero
            si el motivo no se corrige volverán a fallar.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {problemas.slice(0, 10).map((p) => (
              <li key={p.id} style={{ marginBottom: 4 }}>
                <strong>{p.entidad}</strong> · {p.terminal}
                {p.sucursal && !seleccion?.sucursalId && ` · ${p.sucursal.nombre}`}
                {" · "}
                {new Date(p.createdAt).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                {" · "}
                {p.intentos} intento(s)
                <div style={{ color: "var(--h421-red-texto)" }}>{p.ultimoError ?? "Sin detalle"}</div>
              </li>
            ))}
          </ul>
          {problemas.length > 10 && (
            <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "8px 0 0" }}>
              Y {problemas.length - 10} más.
            </p>
          )}
        </div>
      )}

      <div className="card h421-tabla-wrap" style={{ marginTop: 16, overflowX: "auto" }}>
        {!datos ? (
          <p>Cargando…</p>
        ) : datos.items.length === 0 ? (
          <p style={{ margin: 0, color: "var(--h421-gray-400)" }}>
            No hay ventas en este rango para {seleccion?.nombre ?? "la empresa"}.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                <th style={celdaEncabezado}>Folio</th>
                <th style={celdaEncabezado}>Hora</th>
                <th style={celdaEncabezado}>Estado</th>
                <th style={celdaEncabezado}>Origen</th>
                {!seleccion?.sucursalId && <th style={celdaEncabezado}>Sucursal</th>}
                <th style={celdaEncabezado}>Atendió</th>
                <th style={celdaEncabezado}>Dispositivo</th>
                <th style={celdaEncabezado}>Turno</th>
                <th style={celdaEncabezado}>Pago</th>
                <th style={{ ...celdaEncabezado, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.items.map((v) => (
                <>
                  <tr
                    key={v.id}
                    onClick={() => setAbierta(abierta === v.id ? null : v.id)}
                    style={{ borderBottom: "1px solid var(--h421-gray-200)", cursor: "pointer" }}
                  >
                    <td style={celda}>{abierta === v.id ? "▾" : "▸"} {v.folio}</td>
                    <td style={celda}>
                      {new Date(v.fecha).toLocaleString("es-MX", {
                        timeZone: datos.rango.zona,
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                    <td style={celda}>
                      <span style={{ color: COLOR_ESTADO[v.estado] ?? "var(--h421-gray-400)", fontWeight: 700 }}>
                        {v.estado}
                      </span>
                    </td>
                    <td style={celda}>{ETIQUETA_CANAL[v.canalOrigen as CanalOrigen] ?? v.canalOrigen}</td>
                    {!seleccion?.sucursalId && <td style={celda}>{v.sucursal?.nombre ?? "—"}</td>}
                    <td style={celda}>{v.cajero?.nombre ?? v.mesero?.nombre ?? "—"}</td>
                    <td style={celda}>{v.dispositivo?.nombre ?? "—"}</td>
                    <td style={celda}>
                      {v.turno ? (
                        <span style={{ color: v.turno.estado === "ABIERTO" ? "var(--h421-amber)" : "var(--h421-gray-400)" }}>
                          {v.turno.estado === "ABIERTO" ? "Abierto" : "Cerrado"} ·{" "}
                          {new Date(v.turno.fechaApertura).toLocaleDateString("es-MX", { timeZone: datos.rango.zona, day: "2-digit", month: "2-digit" })}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={celda}>{v.pagos.map((p) => p.metodo).join(", ") || "—"}</td>
                    <td style={{ ...celda, textAlign: "right", fontWeight: 700 }}>${v.total.toFixed(2)}</td>
                  </tr>
                  {abierta === v.id && (
                    <tr key={`${v.id}-detalle`}>
                      <td colSpan={seleccion?.sucursalId ? 9 : 10} style={{ padding: "10px 12px 18px", background: "var(--h421-gray-50)" }}>
                        <strong style={{ fontSize: 13 }}>Ticket {v.folio}</strong>
                        <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
                          {v.items.map((l) => (
                            <li key={l.id}>{l.cantidad}× {l.nombre} — ${l.subtotal.toFixed(2)}</li>
                          ))}
                        </ul>
                        <div style={{ fontSize: 13, display: "flex", gap: 20, flexWrap: "wrap" }}>
                          <span>Subtotal: ${v.subtotal.toFixed(2)}</span>
                          {v.descuento > 0 && <span>Descuento: −${v.descuento.toFixed(2)}</span>}
                          <span>Impuestos: ${v.impuestos.toFixed(2)}</span>
                          <strong>Total: ${v.total.toFixed(2)}</strong>
                        </div>
                        {v.pagos.length > 0 && (
                          <div style={{ fontSize: 13, marginTop: 6 }}>
                            Pagos: {v.pagos.map((p) => `${p.metodo} $${p.monto.toFixed(2)}`).join(" · ")}
                          </div>
                        )}
                        <div style={{ fontSize: 13, marginTop: 6, display: "flex", gap: 20, flexWrap: "wrap", color: "var(--h421-gray-400)" }}>
                          {v.mesero && <span>Tomó: {v.mesero.nombre}</span>}
                          {v.cajero && <span>Cobró: {v.cajero.nombre}</span>}
                          <span>Plataforma: {ETIQUETA_CANAL[v.canalOrigen as CanalOrigen] ?? v.canalOrigen}</span>
                          {v.dispositivo && <span>Dispositivo: {v.dispositivo.nombre}</span>}
                          {v.sucursal && <span>Sucursal: {v.sucursal.nombre}</span>}
                          {v.turno && (
                            <a href={`/ventas?turnoId=${v.turno.id}`} onClick={(e) => { e.preventDefault(); filtrarOrigen({ turnoId: v.turno!.id }); }}>
                              Ver ventas de este turno
                            </a>
                          )}
                        </div>
                        {!v.cajero && !v.mesero && (
                          <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "8px 0 0" }}>
                            Sin usuario asignado: es una venta anterior a que las terminales registraran a sus
                            usuarios en el ERP. La venta sí se guardó completa.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && datos.paginacion.total > POR_PAGINA && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
          <button onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0} style={{ padding: "8px 14px" }}>
            ‹ Anterior
          </button>
          <span style={{ fontSize: 14 }}>Página {pagina + 1} de {totalPaginas} · {datos.paginacion.total} tickets</span>
          <button onClick={() => setPagina((p) => p + 1)} disabled={pagina + 1 >= totalPaginas} style={{ padding: "8px 14px" }}>
            Siguiente ›
          </button>
        </div>
      )}
    </div>
  );
}

function TablaDesglose({
  titulo,
  grupos,
  nombre = (g) => g.nombre,
  activo,
  onElegir,
}: {
  titulo: string;
  grupos: GrupoDesglose[];
  nombre?: (g: GrupoDesglose) => string;
  activo: string;
  onElegir: (clave: string) => void;
}) {
  return (
    <div className="card" style={{ margin: 0 }}>
      <strong style={{ fontSize: 14 }}>{titulo}</strong>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
        <tbody>
          {grupos.map((g) => (
            <tr
              key={g.clave}
              onClick={() => onElegir(g.clave)}
              style={{ cursor: "pointer", borderTop: "1px solid var(--h421-gray-200)", fontWeight: activo === g.clave ? 700 : 400 }}
            >
              <td style={{ padding: "6px 4px" }}>{nombre(g)}</td>
              <td style={{ padding: "6px 4px", textAlign: "right", color: "var(--h421-gray-400)" }}>{g.numTickets}</td>
              <td style={{ padding: "6px 4px", textAlign: "right" }}>${g.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const etiqueta: React.CSSProperties = { fontSize: 12, color: "var(--h421-gray-400)", fontWeight: 700 };
const entrada: React.CSSProperties = { padding: "9px 10px", borderRadius: 8, border: "1px solid var(--h421-gray-200)" };
const celdaEncabezado: React.CSSProperties = { padding: "8px 12px", fontSize: 12, color: "var(--h421-gray-400)" };
const celda: React.CSSProperties = { padding: "10px 12px" };
