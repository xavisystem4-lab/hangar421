"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { NivelInventario, Sucursal } from "@hangar421/shared";
import { SECCIONES_INSUMO, UNIDADES_INSUMO, aUnidadBase, seccionDeInsumo, calcularNivelInventario, describirEnPaquetes, factorConversionUnidad, resumenSemaforoInventario, tienePresentacion } from "@hangar421/shared";
import { apiFetch } from "@/lib/api";
import { useAuthCrm } from "@/lib/authClient";
import { useSucursalActiva } from "@/store/sucursalActiva";
import { ReporteInventario, SEMAFORO } from "@/components/ReporteInventario";
import { PanelExistencias, type ExistenciaProducto } from "@/components/PanelExistencias";
import { OpcionesInsumo, PanelPreparaciones, etiquetaUnidad } from "@/components/PanelPreparaciones";

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
  /** Empaque con el que se compra ("Cartón") y cuántas unidades base trae (1000 ml). */
  presentacionNombre?: string | null;
  presentacionCantidad?: number | null;
  costoUnitario: string;
  precioVenta: string | null;
  proveedorId: string | null;
  proveedor: Proveedor | null;
  /** Preparación de la casa (cold foam): no tiene existencia, va en su propio panel. */
  esPreparacion?: boolean;
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

/** Pequeño overlay modal reutilizado por Movimientos/Historial/Traspasar/Hacer inventario —
 *  mismo patrón que ya usan los modales de pos-desktop (ModalNota, ModalDescuento, etc.). */
function Modal({ titulo, ancho = 520, onCerrar, children }: { titulo: string; ancho?: number; onCerrar: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div className="card" style={{ width: ancho, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{titulo}</h2>
          <button onClick={onCerrar} style={{ background: "none", fontSize: 20 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function InventarioPage() {
  const { contexto } = useAuthCrm();
  const { seleccion } = useSucursalActiva();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  /** Todos los insumos activos, incluidas las preparaciones (para sus recetas). */
  const [todosInsumos, setTodosInsumos] = useState<Insumo[]>([]);
  const [existenciasProducto, setExistenciasProducto] = useState<ExistenciaProducto[]>([]);
  const [actualizadoEn, setActualizadoEn] = useState<Date | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  /** Sección elegida en los botones de arriba de la tabla ("TODAS" = sin filtro). */
  const [seccion, setSeccion] = useState<string>("TODAS");
  /** Alta de insumos, preparaciones y proveedores: va hasta arriba y se puede plegar. */
  const [verAltas, setVerAltas] = useState(true);
  const [filtroNivel, setFiltroNivel] = useState<"TODOS" | NivelInventario>("TODOS");

  const [nuevoInsumo, setNuevoInsumo] = useState({
    nombre: "", unidadMedida: "pz", costoUnitario: "", precioVenta: "", proveedorId: "", minimo: "", maximo: "",
    presentacionNombre: "", presentacionCantidad: "",
  });

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [nuevoProveedor, setNuevoProveedor] = useState({ nombre: "", telefono: "" });

  const [editandoInsumoId, setEditandoInsumoId] = useState<string | null>(null);
  const [borradorInsumo, setBorradorInsumo] = useState({ nombre: "", unidadMedida: "pz", costoUnitario: "", precioVenta: "", proveedorId: "", minimo: "", maximo: "", presentacionNombre: "", presentacionCantidad: "" });

  // Movimientos: registrar uno nuevo (para un insumo puntual, botón "Movimiento" de la fila) y
  // ver los recientes de la sucursal (botón "Movimientos" del encabezado).
  const [modalMovimiento, setModalMovimiento] = useState<Insumo | null>(null);
  const [mov, setMov] = useState({ tipo: "ENTRADA", cantidad: "", motivo: "", empaques: "" });
  const [modalMovimientosRecientes, setModalMovimientosRecientes] = useState(false);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);

  // Historial: los mismos movimientos pero sin límite de 30 y filtrables por insumo — vista de
  // auditoría completa en vez de la operativa de arriba.
  const [modalReporte, setModalReporte] = useState(false);
  const [modalListaCompras, setModalListaCompras] = useState(false);

  const [modalHistorial, setModalHistorial] = useState(false);
  const [historialInsumoId, setHistorialInsumoId] = useState("");

  // Hacer inventario (conteo físico): se captura la cantidad contada de cada insumo y, al
  // guardar, solo se registran movimientos CONTEO para los que cambiaron (diferencia = contado -
  // existencia actual, respeta el signo — ver deltaExistenciaInventario en @hangar421/shared).
  const [modalConteo, setModalConteo] = useState(false);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  /** Empaques completos contados (cartones), cuando el insumo tiene presentación. */
  const [conteoEmpaques, setConteoEmpaques] = useState<Record<string, string>>({});
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

  // Traspasar a otra sucursal: solicitar + autorizar + enviar en un solo paso (quien lo usa ya es
  // admin/supervisor, así que no tiene sentido pedirle que autorice su propia solicitud aparte).
  // Queda en estado ENVIADO hasta que la sucursal destino lo reciba (ver "Traspasos pendientes").
  const [modalTraspaso, setModalTraspaso] = useState<Insumo | null>(null);
  const [traspaso, setTraspaso] = useState({ sucursalDestinoId: "", cantidad: "" });
  const [traspasosPendientes, setTraspasosPendientes] = useState<Traspaso[]>([]);

  async function cargar(suc: string) {
    if (!contexto || !suc) return;
    // Cada sucursal ve solo los insumos que maneja; el catálogo completo de la empresa se usa para
    // "Agregar uno que ya existe" y para las recetas de las preparaciones.
    const [ex, ins, catalogo, prods] = await Promise.all([
      apiFetch<Existencia[]>(`/inventario/existencias?sucursalId=${suc}`),
      apiFetch<Insumo[]>(`/inventario/insumos?empresaId=${contexto.usuario.empresaId}&sucursalId=${suc}`),
      apiFetch<Insumo[]>(`/inventario/insumos?empresaId=${contexto.usuario.empresaId}`),
      apiFetch<ExistenciaProducto[]>(`/inventario/productos-existencias?sucursalId=${suc}`).catch(() => [] as ExistenciaProducto[]),
    ]);
    setExistencias(ex);
    // Las preparaciones no se cuentan ni se compran: fuera de existencias, semáforo, conteo y
    // lista de compras. Se administran en su propio panel.
    setInsumos(ins.filter((i) => !i.esPreparacion));
    setTodosInsumos(catalogo);
    setExistenciasProducto(prods);
    setActualizadoEn(new Date());
    cargarTraspasosPendientes(suc);
  }

  function cargarSucursales() {
    if (!contexto) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${contexto.usuario.empresaId}`).then(setSucursales).catch(() => {});
  }

  function cargarProveedores() {
    if (!contexto) return;
    apiFetch<Proveedor[]>(`/proveedores?empresaId=${contexto.usuario.empresaId}`).then(setProveedores);
  }

  async function cargarMovimientosRecientes(suc: string) {
    const movs = await apiFetch<Movimiento[]>(`/inventario/movimientos?sucursalId=${suc}`);
    setMovimientos(movs);
  }

  async function cargarTraspasosPendientes(suc: string) {
    const todos = await apiFetch<Traspaso[]>(`/traspasos?sucursalId=${suc}`);
    setTraspasosPendientes(todos.filter((t) => t.sucursalDestinoId === suc && t.estado === "ENVIADO"));
  }

  // La sucursal viene del contexto global (cabecera), no de un selector propio.
  useEffect(() => {
    if (!contexto || !seleccion?.sucursalId) return;
    setSucursalId(seleccion.sucursalId);
    cargar(seleccion.sucursalId);
    cargarProveedores();
    cargarSucursales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto, seleccion?.sucursalId]);

  // La existencia es "la del momento": se refresca sola cada minuto y al volver a la pestaña,
  // para que lo que se ve en grande sea lo real y no lo de hace una hora.
  useEffect(() => {
    if (!sucursalId) return;
    const intervalo = setInterval(() => cargar(sucursalId), 60_000);
    const alVolver = () => { if (document.visibilityState === "visible") cargar(sucursalId); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(intervalo); document.removeEventListener("visibilitychange", alVolver); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalId]);

  // Filas combinadas (insumo + su existencia en la sucursal elegida) con búsqueda y filtro de
  // nivel aplicados — es la única tabla ahora, antes existían dos por separado.
  const filasSinSeccion = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return insumos
      .map((i) => {
        const ex = existencias.find((e) => e.insumoId === i.id);
        const existencia = ex ? Number(ex.existencia) : 0;
        const minimo = ex ? Number(ex.minimo) : 0;
        const maximo = ex?.maximo != null ? Number(ex.maximo) : null;
        const { porcentaje, nivel } = calcularNivelInventario(existencia, minimo, maximo);
        return { insumo: i, existencia, minimo, maximo, porcentaje, nivel, tieneExistencia: !!ex, seccion: seccionDeInsumo(i) };
      })
      .filter((f) => (texto ? f.insumo.nombre.toLowerCase().includes(texto) : true))
      .filter((f) => (filtroNivel === "TODOS" ? true : f.nivel === filtroNivel));
  }, [insumos, existencias, busqueda, filtroNivel]);

  // Cuántos hay por sección (con búsqueda y nivel aplicados) para los botones de sección.
  const conteoSecciones = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of filasSinSeccion) m.set(f.seccion, (m.get(f.seccion) ?? 0) + 1);
    return m;
  }, [filasSinSeccion]);

  // La tabla: la sección elegida o todas, agrupadas en el orden de SECCIONES_INSUMO.
  const filas = useMemo(() => {
    const orden = (s: string) => (SECCIONES_INSUMO as readonly string[]).indexOf(s);
    return filasSinSeccion
      .filter((f) => seccion === "TODAS" || f.seccion === seccion)
      .sort((a, b) => orden(a.seccion) - orden(b.seccion) || a.insumo.nombre.localeCompare(b.insumo.nombre, "es"));
  }, [filasSinSeccion, seccion]);

  /** Empaque del insumo, cuando lo tiene ("Cartón" de 1000 ml). */
  function presentacionDe(i: Insumo) {
    return i.presentacionNombre && i.presentacionCantidad
      ? { nombre: i.presentacionNombre, porPaquete: Number(i.presentacionCantidad) }
      : null;
  }

  // Semáforo de TODO el inventario de la sucursal (sin buscador ni filtro), para las tarjetas de arriba.
  const resumenSemaforo = useMemo(
    () => resumenSemaforoInventario(insumos.map((i) => {
      const ex = existencias.find((e) => e.insumoId === i.id);
      return calcularNivelInventario(ex ? Number(ex.existencia) : 0, ex ? Number(ex.minimo) : 0, ex?.maximo != null ? Number(ex.maximo) : null).nivel;
    })),
    [insumos, existencias],
  );

  async function crearInsumo() {
    if (!contexto || !nuevoInsumo.nombre.trim()) return;
    const creado = await apiFetch<{ id: string }>("/inventario/insumos", {
      method: "POST",
      body: JSON.stringify({
        empresaId: contexto.usuario.empresaId,
        // Solo en la sucursal elegida arriba; las demás no lo ven hasta que lo agreguen.
        sucursalId,
        nombre: nuevoInsumo.nombre,
        unidadMedida: nuevoInsumo.unidadMedida,
        costoUnitario: nuevoInsumo.costoUnitario ? Number(nuevoInsumo.costoUnitario) : undefined,
        precioVenta: nuevoInsumo.precioVenta ? Number(nuevoInsumo.precioVenta) : undefined,
        proveedorId: nuevoInsumo.proveedorId || undefined,
        minimo: nuevoInsumo.minimo ? Number(nuevoInsumo.minimo) : undefined,
        maximo: nuevoInsumo.maximo ? Number(nuevoInsumo.maximo) : undefined,
        presentacionNombre: nuevoInsumo.presentacionNombre.trim() || undefined,
        presentacionCantidad: nuevoInsumo.presentacionCantidad ? Number(nuevoInsumo.presentacionCantidad) : undefined,
      }),
    });
    setNuevoInsumo({ nombre: "", unidadMedida: "pz", costoUnitario: "", precioVenta: "", proveedorId: "", minimo: "", maximo: "", presentacionNombre: "", presentacionCantidad: "" });
    const yaExistia = todosInsumos.some((i) => i.id === creado?.id);
    setMensaje(yaExistia
      ? `"${nuevoInsumo.nombre}" ya existía en otra sucursal: se agregó a esta, sin duplicarlo.`
      : "Insumo creado en esta sucursal.");
    cargar(sucursalId);
  }

  /** La sucursal elegida empieza a manejar un insumo que ya existe en otra. */
  async function agregarExistente(insumoId: string) {
    if (!insumoId || !sucursalId) return;
    await apiFetch(`/inventario/insumos/${insumoId}/sucursales/${sucursalId}`, { method: "POST" });
    setMensaje(`"${todosInsumos.find((i) => i.id === insumoId)?.nombre ?? "Insumo"}" agregado a esta sucursal.`);
    cargar(sucursalId);
  }

  /** Deja de verse en esta sucursal (las demás lo conservan). Solo con existencia 0. */
  async function quitarDeSucursal(i: Insumo) {
    if (!confirm(`¿Quitar "${i.nombre}" de esta sucursal? Las demás sucursales lo conservan.`)) return;
    try {
      await apiFetch(`/inventario/insumos/${i.id}/sucursales/${sucursalId}`, { method: "DELETE" });
      setMensaje(`"${i.nombre}" ya no aparece en esta sucursal.`);
      cargar(sucursalId);
    } catch (e: any) {
      setMensaje(e?.message ?? "No se pudo quitar.");
    }
  }

  function empezarEdicionInsumo(f: (typeof filas)[number]) {
    setEditandoInsumoId(f.insumo.id);
    setBorradorInsumo({
      nombre: f.insumo.nombre, unidadMedida: f.insumo.unidadMedida, costoUnitario: f.insumo.costoUnitario,
      precioVenta: f.insumo.precioVenta ?? "", proveedorId: f.insumo.proveedorId ?? "",
      minimo: String(f.minimo), maximo: f.maximo != null ? String(f.maximo) : "",
      presentacionNombre: f.insumo.presentacionNombre ?? "",
      presentacionCantidad: f.insumo.presentacionCantidad != null ? String(f.insumo.presentacionCantidad) : "",
    });
  }

  async function guardarEdicionInsumo(id: string) {
    if (!borradorInsumo.nombre.trim()) return;
    // La unidad va por su propio endpoint: cambiarla reescala existencias, mínimos y recetas
    // (240 l pasan a 240 000 ml). Se pregunta antes, porque es irreversible desde la pantalla.
    const unidadAnterior = insumos.find((x) => x.id === id)?.unidadMedida ?? "";
    const unidadNueva = borradorInsumo.unidadMedida.trim();
    if (unidadNueva && unidadNueva !== unidadAnterior) {
      const factor = factorConversionUnidad(unidadAnterior, unidadNueva);
      let convertir = false;
      if (factor && factor !== 1) {
        convertir = confirm(
          `Vas a cambiar "${borradorInsumo.nombre}" de ${unidadAnterior} a ${unidadNueva}.\n\n` +
          `Aceptar: convierte las cantidades (×${factor}) — existencias, mínimos, máximos, el costo y las recetas.\n` +
          `Cancelar: solo cambia la etiqueta y las cantidades se quedan como están (tendrás que corregirlas a mano).`,
        );
      } else if (!confirm(
        `De "${unidadAnterior}" a "${unidadNueva}" no hay conversión automática.\n\n` +
        `Se cambia solo la etiqueta: revisa después las existencias y las recetas de este insumo.`,
      )) {
        return;
      }
      await apiFetch(`/inventario/insumos/${id}/unidad`, { method: "POST", body: JSON.stringify({ unidadMedida: unidadNueva, convertir }) });
    }
    await Promise.all([
      apiFetch(`/inventario/insumos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          nombre: borradorInsumo.nombre,
          presentacionNombre: borradorInsumo.presentacionNombre.trim() || null,
          presentacionCantidad: borradorInsumo.presentacionCantidad ? Number(borradorInsumo.presentacionCantidad) : null,
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
    if (!confirm(`¿Eliminar "${i.nombre}" en TODAS las sucursales? Deja de aparecer en inventario y en recetas nuevas (el historial ya registrado no se pierde).\n\nSi solo no lo usan en esta sucursal, mejor usa "Quitar de aquí".`)) return;
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
    if (!contexto || !modalMovimiento) return;
    // Con empaque se capturan cartones y sueltos; lo que se guarda siempre es la unidad base.
    const pres = presentacionDe(modalMovimiento);
    const cantidad = tienePresentacion(pres)
      ? aUnidadBase({ paquetes: Number(mov.empaques), sueltos: Number(mov.cantidad) }, pres.porPaquete)
      : Number(mov.cantidad);
    if (!(cantidad > 0)) return;
    await apiFetch("/inventario/movimientos", {
      method: "POST",
      body: JSON.stringify({
        sucursalId, insumoId: modalMovimiento.id, tipo: mov.tipo, cantidad,
        motivo: mov.motivo || undefined, usuarioId: contexto.usuario.id,
      }),
    });
    setMov({ tipo: "ENTRADA", cantidad: "", motivo: "", empaques: "" });
    setModalMovimiento(null);
    setMensaje("Movimiento registrado.");
    cargar(sucursalId);
  }

  /** Lo contado de un insumo, en unidad base: con empaque son dos casillas (cartones + sueltos). */
  function contadoDe(f: (typeof filas)[number]): number | null {
    const pres = presentacionDe(f.insumo);
    const sueltos = conteo[f.insumo.id];
    const empaques = conteoEmpaques[f.insumo.id];
    if (tienePresentacion(pres)) {
      if ((empaques === undefined || empaques === "") && (sueltos === undefined || sueltos === "")) return null;
      return aUnidadBase({ paquetes: Number(empaques), sueltos: Number(sueltos) }, pres.porPaquete);
    }
    if (sueltos === undefined || sueltos === "") return null;
    return Number(sueltos);
  }

  async function guardarConteo() {
    if (!contexto) return;
    const cambios = filas
      .map((f) => ({ fila: f, contado: contadoDe(f) }))
      .filter((x): x is { fila: (typeof filas)[number]; contado: number } => x.contado !== null && x.contado !== x.fila.existencia);
    if (cambios.length === 0) { setModalConteo(false); return; }
    setGuardandoConteo(true);
    try {
      await Promise.all(cambios.map(({ fila: f, contado }) =>
        apiFetch("/inventario/movimientos", {
          method: "POST",
          body: JSON.stringify({
            sucursalId, insumoId: f.insumo.id, tipo: "CONTEO",
            cantidad: contado - f.existencia,
            motivo: "Conteo físico de inventario", usuarioId: contexto.usuario.id,
          }),
        }),
      ));
      setMensaje(`Conteo guardado: ${cambios.length} insumo(s) ajustado(s).`);
      setConteo({});
      setConteoEmpaques({});
      setModalConteo(false);
      cargar(sucursalId);
    } finally {
      setGuardandoConteo(false);
    }
  }

  async function confirmarTraspaso() {
    if (!contexto || !modalTraspaso || !traspaso.sucursalDestinoId || !traspaso.cantidad) return;
    const cantidad = Number(traspaso.cantidad);
    const creado = await apiFetch<Traspaso>("/traspasos", {
      method: "POST",
      body: JSON.stringify({
        sucursalOrigenId: sucursalId,
        sucursalDestinoId: traspaso.sucursalDestinoId,
        usuarioSolicitaId: contexto.usuario.id,
        items: [{ insumoId: modalTraspaso.id, cantidadSolicitada: cantidad }],
      }),
    });
    await apiFetch(`/traspasos/${creado.id}/autorizar`, { method: "POST", body: JSON.stringify({ usuarioAutorizaId: contexto.usuario.id }) });
    await apiFetch(`/traspasos/${creado.id}/enviar`, {
      method: "POST",
      body: JSON.stringify({ usuarioEnviaId: contexto.usuario.id, items: creado.items.map((it) => ({ itemId: it.id, cantidad })) }),
    });
    setModalTraspaso(null);
    setTraspaso({ sucursalDestinoId: "", cantidad: "" });
    setMensaje("Traspaso enviado. Quedará reflejado en destino cuando lo reciban.");
    cargar(sucursalId);
  }

  async function recibirTraspaso(t: Traspaso) {
    if (!contexto) return;
    const items = t.items.map((it) => ({ itemId: it.id, cantidad: Number(it.cantidadEnviada ?? it.cantidadSolicitada) }));
    await apiFetch(`/traspasos/${t.id}/recibir`, { method: "POST", body: JSON.stringify({ usuarioRecibeId: contexto.usuario.id, items }) });
    await apiFetch(`/traspasos/${t.id}/validar`, { method: "POST" });
    setMensaje("Traspaso recibido y aplicado al inventario.");
    cargar(sucursalId);
  }

  const movimientosHistorial = historialInsumoId ? movimientos.filter((m) => m.insumoId === historialInsumoId) : movimientos;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginTop: 0 }}>Inventario</h1>
        {/* Sin selector propio: la sucursal la fija el contexto global de la cabecera. */}
      </div>

      {mensaje && <p style={{ color: "var(--h421-navy-texto)" }}>{mensaje}</p>}

      {/* Alta de insumos, preparaciones de la casa y proveedores: lo primero de la pantalla.
          Estilos en globals.css (.h421-altas): campos con etiqueta, misma altura y nada se sale
          de su tarjeta. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 12px" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Altas</h2>
        <button onClick={() => setVerAltas((v) => !v)} className="h421-boton-secundario">
          {verAltas ? "Ocultar" : "Mostrar insumos, preparaciones y proveedores"}
        </button>
      </div>
      {verAltas && (
        <div className="h421-altas">
          <div className="card">
            <div>
              <h3>Nuevo insumo</h3>
              <p className="h421-ayuda">Se crea solo en esta sucursal.</p>
            </div>
            {(() => {
              const deOtras = todosInsumos.filter((t) => !t.esPreparacion && !insumos.some((i) => i.id === t.id));
              return deOtras.length > 0 ? (
                <label className="h421-campo">
                  <span>¿Ya existe en otra sucursal?</span>
                  <select value="" onChange={(e) => agregarExistente(e.target.value)} className="h421-control">
                    <option value="">Elegir para agregarlo aquí…</option>
                    <OpcionesInsumo insumos={deOtras} />
                  </select>
                </label>
              ) : null;
            })()}
            <div className="h421-campos">
              <label className="h421-campo ancho">
                <span>Nombre</span>
                <input placeholder="Ej. Leche entera" value={nuevoInsumo.nombre} onChange={(e) => setNuevoInsumo((n) => ({ ...n, nombre: e.target.value }))} className="h421-control" />
              </label>
              <label className="h421-campo">
                <span>Unidad</span>
                <select value={nuevoInsumo.unidadMedida} onChange={(e) => setNuevoInsumo((n) => ({ ...n, unidadMedida: e.target.value }))} className="h421-control">
                  {UNIDADES_INSUMO.map((u) => <option key={u} value={u}>{etiquetaUnidad(u)}</option>)}
                </select>
              </label>
              <label className="h421-campo">
                <span>Proveedor</span>
                <select value={nuevoInsumo.proveedorId} onChange={(e) => setNuevoInsumo((n) => ({ ...n, proveedorId: e.target.value }))} className="h421-control">
                  <option value="">Sin proveedor</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>
              <label className="h421-campo">
                <span>Precio costo</span>
                <input type="number" placeholder="$0.00" value={nuevoInsumo.costoUnitario} onChange={(e) => setNuevoInsumo((n) => ({ ...n, costoUnitario: e.target.value }))} className="h421-control" />
              </label>
              <label className="h421-campo">
                <span>Precio venta <small>(opcional)</small></span>
                <input type="number" placeholder="$0.00" value={nuevoInsumo.precioVenta} onChange={(e) => setNuevoInsumo((n) => ({ ...n, precioVenta: e.target.value }))} className="h421-control" />
              </label>
              <label className="h421-campo">
                <span>Stock mínimo</span>
                <input type="number" placeholder="0" value={nuevoInsumo.minimo} onChange={(e) => setNuevoInsumo((n) => ({ ...n, minimo: e.target.value }))} className="h421-control" />
              </label>
              <label className="h421-campo">
                <span>Stock máximo</span>
                <input type="number" placeholder="0" value={nuevoInsumo.maximo} onChange={(e) => setNuevoInsumo((n) => ({ ...n, maximo: e.target.value }))} className="h421-control" />
              </label>
              <label className="h421-campo">
                <span>Se compra en <small>(opcional)</small></span>
                <input placeholder="Ej. Cartón" value={nuevoInsumo.presentacionNombre} onChange={(e) => setNuevoInsumo((n) => ({ ...n, presentacionNombre: e.target.value }))} className="h421-control" />
              </label>
              <label className="h421-campo">
                <span>Cada uno trae ({nuevoInsumo.unidadMedida})</span>
                <input type="number" placeholder="Ej. 1000" value={nuevoInsumo.presentacionCantidad} onChange={(e) => setNuevoInsumo((n) => ({ ...n, presentacionCantidad: e.target.value }))} className="h421-control" />
              </label>
            </div>
            <p className="h421-ayuda">
              Con el empaque podrás contar &quot;4 cartones&quot; o &quot;2 cartones y 300 ml&quot; sin sacar cuentas.
            </p>
            <button onClick={crearInsumo} className="h421-boton-primario">Crear insumo en esta sucursal</button>
          </div>

          {contexto && (
            <PanelPreparaciones empresaId={contexto.usuario.empresaId} insumos={todosInsumos} onCambio={() => cargar(sucursalId)} />
          )}

          <div className="card">
            <div>
              <h3>Proveedores</h3>
              <p className="h421-ayuda">Se usan en el alta de insumos y en la lista de compras.</p>
            </div>
            <div className="h421-campos">
              <label className="h421-campo ancho">
                <span>Nombre</span>
                <input placeholder="Ej. Lácteos del Norte" value={nuevoProveedor.nombre} onChange={(e) => setNuevoProveedor((p) => ({ ...p, nombre: e.target.value }))} className="h421-control" />
              </label>
              <label className="h421-campo ancho">
                <span>Teléfono <small>(opcional)</small></span>
                <input placeholder="Ej. 656 123 4567" value={nuevoProveedor.telefono} onChange={(e) => setNuevoProveedor((p) => ({ ...p, telefono: e.target.value }))} className="h421-control" />
              </label>
            </div>
            <button onClick={crearProveedor} disabled={!nuevoProveedor.nombre.trim()} className="h421-boton-primario">Agregar proveedor</button>
            <div className="h421-lista">
              {proveedores.length === 0 && <p className="h421-ayuda" style={{ padding: "8px 0" }}>Sin proveedores dados de alta todavía.</p>}
              {proveedores.map((p) => (
                <div key={p.id} className="h421-lista-fila">
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    <strong>{p.nombre}</strong>{p.telefono ? <span className="h421-ayuda"> · {p.telefono}</span> : null}
                  </span>
                  <button onClick={() => eliminarProveedor(p)} className="h421-boton-peligro">Eliminar</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {traspasosPendientes.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid var(--h421-blue)", marginBottom: 16 }}>
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

      <PanelExistencias
        filas={filas}
        productos={existenciasProducto}
        resumen={resumenSemaforo}
        filtroNivel={filtroNivel}
        onFiltroNivel={setFiltroNivel}
        busqueda={busqueda}
        actualizadoEn={actualizadoEn}
        onActualizar={() => cargar(sucursalId)}
        onListaCompras={() => setModalListaCompras(true)}
      />

      {/* Barra de herramientas: buscador + filtro de nivel + acciones — mismo layout que el
          módulo de inventario de referencia (buscar insumo / filtro de niveles / botones de
          acción a la derecha). */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <input placeholder="Buscar insumo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          style={{ flex: "1 1 220px", padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
        <select value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value as typeof filtroNivel)} style={{ padding: 10, borderRadius: 8 }}>
          <option value="TODOS">Todos los niveles</option>
          <option value="OPTIMO">Óptimo</option>
          <option value="BAJO">Bajo</option>
          <option value="CRITICO">Crítico</option>
        </select>
        <button onClick={() => setModalConteo(true)} style={{ background: "var(--h421-amber-bg)", color: "var(--h421-amber-texto)", border: "1px solid var(--h421-amber)", padding: "10px 14px", fontSize: 13 }}>📋 Hacer Inventario</button>
        <button onClick={() => setModalReporte(true)} style={{ background: "var(--h421-green-bg)", color: "var(--h421-green)", border: "1px solid var(--h421-green)", padding: "10px 14px", fontSize: 13 }}>📄 Generar Reporte</button>
        <button onClick={() => setModalListaCompras(true)} style={{ background: "var(--h421-green-bg)", color: "var(--h421-green)", border: "1px solid var(--h421-green)", padding: "10px 14px", fontSize: 13 }}>🛒 Lista de Compras</button>
        <button onClick={() => { setModalMovimientosRecientes(true); cargarMovimientosRecientes(sucursalId); }} style={{ background: "transparent", color: "var(--h421-blue)", border: "1px solid var(--h421-blue)", padding: "10px 14px", fontSize: 13 }}>🔄 Movimientos</button>
        <button onClick={() => { setModalHistorial(true); cargarMovimientosRecientes(sucursalId); }} style={{ background: "transparent", color: "#8b5cf6", border: "1px solid #8b5cf6", padding: "10px 14px", fontSize: 13 }}>🕘 Historial</button>
        {/* Secciones: salen del nombre del insumo ("Limpieza - Pinol" → Limpieza), ver categoriasInsumo.ts. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flexBasis: "100%" }}>
          {["TODAS", ...SECCIONES_INSUMO.filter((s) => conteoSecciones.has(s))].map((s) => {
            const activa = seccion === s;
            const n = s === "TODAS" ? filasSinSeccion.length : conteoSecciones.get(s) ?? 0;
            return (
              <button key={s} onClick={() => setSeccion(s)}
                style={{ background: activa ? "var(--h421-navy)" : "transparent", color: activa ? "#fff" : "var(--h421-navy-texto)", border: "1px solid var(--h421-gray-300)", borderRadius: 999, padding: "4px 12px", fontSize: 12, minHeight: 0 }}>
                {s === "TODAS" ? "Todas" : s} ({n})
              </button>
            );
          })}
        </div>
      </div>

      <div className="card h421-tabla-wrap" style={{ overflowX: "auto" }}>
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
            {filas.map((f, idx) => <Fragment key={f.insumo.id}>{seccion === "TODAS" && (idx === 0 || filas[idx - 1].seccion !== f.seccion) && (
              <tr style={{ background: "var(--h421-categoria-bg)" }}>
                <td colSpan={9} style={{ padding: "8px 8px 6px", fontWeight: 800, fontSize: 13, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--h421-categoria-texto)" }}>{f.seccion}</td>
              </tr>
            )}{(() => {
              const i = f.insumo;
              if (editandoInsumoId === i.id) {
                return (
                  <tr key={i.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                    <td style={{ padding: 8 }}>
                      <input value={borradorInsumo.nombre} onChange={(e) => setBorradorInsumo((b) => ({ ...b, nombre: e.target.value }))}
                        style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                      {/* Unidad editable: cambiarla de l a ml (o kg a g) convierte las cantidades. */}
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        <input value={borradorInsumo.presentacionNombre} onChange={(e) => setBorradorInsumo((b) => ({ ...b, presentacionNombre: e.target.value }))}
                          placeholder="Empaque" title="Se compra en (ej. Cartón)" style={{ width: 80, padding: 4, fontSize: 12, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                        <input value={borradorInsumo.presentacionCantidad} onChange={(e) => setBorradorInsumo((b) => ({ ...b, presentacionCantidad: e.target.value }))}
                          type="number" placeholder="trae" title={`Cuántos ${borradorInsumo.unidadMedida} trae el empaque`} style={{ width: 64, padding: 4, fontSize: 12, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                      </div>
                      <select value={borradorInsumo.unidadMedida} onChange={(e) => setBorradorInsumo((b) => ({ ...b, unidadMedida: e.target.value }))}
                        title="Unidad de medida" style={{ marginTop: 4, padding: 4, fontSize: 12 }}>
                        {!(UNIDADES_INSUMO as readonly string[]).includes(borradorInsumo.unidadMedida) && (
                          <option value={borradorInsumo.unidadMedida}>{borradorInsumo.unidadMedida} (actual)</option>
                        )}
                        {UNIDADES_INSUMO.map((u) => <option key={u} value={u}>{etiquetaUnidad(u)}</option>)}
                      </select>
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
                      <button onClick={() => guardarEdicionInsumo(i.id)} style={{ background: "var(--h421-green)", color: "#fff", padding: "4px 10px", fontSize: 12 }}>Guardar</button>
                      <button onClick={() => setEditandoInsumoId(null)} style={{ background: "var(--h421-gray-200)", padding: "4px 10px", fontSize: 12 }}>Cancelar</button>
                    </td>
                  </tr>
                );
              }
              const colores = COLOR_NIVEL[f.nivel];
              return (
                <tr key={i.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{i.nombre}</td>
                  <td style={{ padding: 8 }}>{i.proveedor?.nombre ?? "—"}</td>
                  <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: SEMAFORO[f.nivel].color, lineHeight: 1 }}>{f.existencia}</span>
                    <span style={{ fontSize: 12, marginLeft: 4, color: "var(--h421-gray-400)" }}>{i.unidadMedida}</span>
                    {tienePresentacion(presentacionDe(i)) && (
                      <div style={{ fontSize: 11, color: "var(--h421-gray-400)" }}>
                        = {describirEnPaquetes(f.existencia, presentacionDe(i), i.unidadMedida)}
                      </div>
                    )}
                  </td>
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
                    <button onClick={() => empezarEdicionInsumo(f)} style={{ background: "var(--h421-gray-50)", padding: "4px 10px", fontSize: 12 }}>✏️ Editar</button>
                    <button onClick={() => { setModalMovimiento(i); setMov({ tipo: "ENTRADA", cantidad: "", motivo: "", empaques: "" }); }} style={{ background: "transparent", color: "var(--h421-blue)", border: "1px solid var(--h421-blue)", padding: "4px 10px", fontSize: 12 }}>Menú</button>
                    <button onClick={() => { setModalTraspaso(i); setTraspaso({ sucursalDestinoId: "", cantidad: "" }); }} style={{ background: "transparent", color: "#8b5cf6", border: "1px solid #8b5cf6", padding: "4px 10px", fontSize: 12 }}>Traspasar</button>
                    <button onClick={() => quitarDeSucursal(i)} title="Deja de verse en esta sucursal; las demás lo conservan" style={{ background: "transparent", color: "var(--h421-gray-500)", border: "1px solid var(--h421-gray-200)", padding: "4px 10px", fontSize: 12 }}>Quitar de aquí</button>
                    <button onClick={() => eliminarInsumo(i)} title="Lo da de baja en TODAS las sucursales" style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "4px 10px", fontSize: 12 }}>Eliminar</button>
                  </td>
                </tr>
              );
            })()}</Fragment>)}
            {filas.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 16, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin insumos que coincidan.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalMovimiento && (
        <Modal titulo={`Movimiento — ${modalMovimiento.nombre}`} ancho={420} onCerrar={() => setModalMovimiento(null)}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={mov.tipo} onChange={(e) => setMov((m) => ({ ...m, tipo: e.target.value }))} style={{ flex: 1, padding: 10 }}>
              {TIPOS_MOVIMIENTO.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {tienePresentacion(presentacionDe(modalMovimiento)) ? (
              <>
                <input placeholder={presentacionDe(modalMovimiento)!.nombre} title={`${presentacionDe(modalMovimiento)!.nombre}s completos`} type="number" value={mov.empaques}
                  onChange={(e) => setMov((m) => ({ ...m, empaques: e.target.value }))}
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <input placeholder={modalMovimiento.unidadMedida} title={`Sueltos en ${modalMovimiento.unidadMedida}`} type="number" value={mov.cantidad}
                  onChange={(e) => setMov((m) => ({ ...m, cantidad: e.target.value }))}
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
              </>
            ) : (
              <input placeholder="Cantidad" type="number" value={mov.cantidad} onChange={(e) => setMov((m) => ({ ...m, cantidad: e.target.value }))}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
            )}
          </div>
          {tienePresentacion(presentacionDe(modalMovimiento)) && (
            <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "0 0 8px" }}>
              1 {presentacionDe(modalMovimiento)!.nombre} = {presentacionDe(modalMovimiento)!.porPaquete} {modalMovimiento.unidadMedida}
              {(mov.empaques || mov.cantidad) && (
                <> · se registran <strong>{aUnidadBase({ paquetes: Number(mov.empaques), sueltos: Number(mov.cantidad) }, presentacionDe(modalMovimiento)!.porPaquete)} {modalMovimiento.unidadMedida}</strong></>
              )}
            </p>
          )}
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
            <select value={historialInsumoId} onChange={(e) => setHistorialInsumoId(e.target.value)} style={{ padding: 8 }}>
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
              {filas.map((f, indice) => {
                const pres = presentacionDe(f.insumo);
                const conEmpaque = tienePresentacion(pres);
                return (
                <tr key={f.insumo.id} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <td style={{ padding: 8 }}>
                    {f.insumo.nombre}
                    {conEmpaque && <div style={{ fontSize: 11, color: "var(--h421-gray-400)" }}>1 {pres!.nombre} = {pres!.porPaquete} {f.insumo.unidadMedida}</div>}
                  </td>
                  <td style={{ padding: 8, color: "var(--h421-gray-400)" }}>
                    {f.existencia} {f.insumo.unidadMedida}
                    {conEmpaque && <div style={{ fontSize: 11 }}>{describirEnPaquetes(f.existencia, pres, f.insumo.unidadMedida)}</div>}
                  </td>
                  <td style={{ padding: 8 }}>
                    {conEmpaque ? (
                      // Se cuenta como está en el almacén: empaques cerrados + lo abierto.
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="number" inputMode="decimal" step="0.01" placeholder={pres!.nombre}
                          title={`${pres!.nombre}s completos`}
                          value={conteoEmpaques[f.insumo.id] ?? ""}
                          ref={(el) => { inputsConteoRef.current[indice] = el; }}
                          onChange={(e) => setConteoEmpaques((c) => ({ ...c, [f.insumo.id]: e.target.value }))}
                          onKeyDown={(e) => moverFocoConteo(e, indice)}
                          style={{ width: 70, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                        <span style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>+</span>
                        <input
                          type="number" inputMode="decimal" step="0.01" placeholder={f.insumo.unidadMedida}
                          title={`Sueltos en ${f.insumo.unidadMedida}`}
                          value={conteo[f.insumo.id] ?? ""}
                          onChange={(e) => setConteo((c) => ({ ...c, [f.insumo.id]: e.target.value }))}
                          style={{ width: 70, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                        <span style={{ fontSize: 11, color: "var(--h421-gray-400)", minWidth: 70 }}>
                          {(conteoEmpaques[f.insumo.id] || conteo[f.insumo.id])
                            ? `= ${aUnidadBase({ paquetes: Number(conteoEmpaques[f.insumo.id]), sueltos: Number(conteo[f.insumo.id]) }, pres!.porPaquete)} ${f.insumo.unidadMedida}`
                            : ""}
                        </span>
                      </div>
                    ) : (
                      <input
                        type="number" inputMode="decimal" step="0.01"
                        placeholder={String(f.existencia)} value={conteo[f.insumo.id] ?? ""}
                        ref={(el) => { inputsConteoRef.current[indice] = el; }}
                        onChange={(e) => setConteo((c) => ({ ...c, [f.insumo.id]: e.target.value }))}
                        onKeyDown={(e) => moverFocoConteo(e, indice)}
                        style={{ width: 90, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    )}
                  </td>
                </tr>
                );
              })}
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
            style={{ width: "100%", padding: 10, marginBottom: 8 }}>
            <option value="">Sucursal destino…</option>
            {sucursales.filter((s) => s.id !== sucursalId).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <input placeholder="Cantidad" type="number" value={traspaso.cantidad} onChange={(e) => setTraspaso((t) => ({ ...t, cantidad: e.target.value }))}
            style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
          <p style={{ fontSize: 12, color: "var(--h421-gray-400)" }}>Se descuenta de esta sucursal de inmediato y queda pendiente de recibir en destino.</p>
          <button onClick={confirmarTraspaso} disabled={!traspaso.sucursalDestinoId || !traspaso.cantidad} style={{ width: "100%", background: "#8b5cf6", color: "#fff", padding: "10px 16px" }}>Enviar traspaso</button>
        </Modal>
      )}

      {modalReporte && <ReporteInventario tipo="reporte" filas={filas} sucursalId={sucursalId} sucursalNombre={seleccion?.nombre} onCerrar={() => setModalReporte(false)} />}
      {modalListaCompras && <ReporteInventario tipo="compras" filas={filas} sucursalId={sucursalId} sucursalNombre={seleccion?.nombre} onCerrar={() => setModalListaCompras(false)} />}
    </div>
  );
}
