import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { NivelInventario, Sucursal } from "@hangar421/shared";
import { calcularNivelInventario } from "@hangar421/shared";
import { apiFetch } from "../../../api/http";
import { useAuthStore } from "../../../store/authStore";
import { usarColores } from "../../../store/temaStore";

interface Existencia { insumoId: string; existencia: string; minimo: string; maximo: string | null; insumo: { nombre: string; unidadMedida: string } }
interface Proveedor { id: string; nombre: string; telefono: string | null; email: string | null }
interface Insumo { id: string; nombre: string; unidadMedida: string; costoUnitario: string; precioVenta: string | null; proveedorId: string | null; proveedor: Proveedor | null }
interface Movimiento { id: string; tipo: string; cantidad: string; motivo: string | null; createdAt: string; insumoId: string; insumo: { nombre: string; unidadMedida: string } }
interface TraspasoItem { id: string; insumoId: string; cantidadSolicitada: string; cantidadEnviada: string | null; cantidadRecibida: string | null; insumo: { nombre: string; unidadMedida: string } }
interface Traspaso { id: string; sucursalOrigenId: string; sucursalDestinoId: string; estado: string; items: TraspasoItem[] }

const TIPOS_MOVIMIENTO = ["ENTRADA", "SALIDA", "AJUSTE", "MERMA"];
const UNIDADES = ["pz", "g", "kg", "ml", "l"];
const ETIQUETA_NIVEL: Record<NivelInventario, string> = { OPTIMO: "Óptimo", BAJO: "Bajo", CRITICO: "Crítico" };

function calcularSugerido(existencia: number, minimo: number, maximo: number | null): number {
  const referencia = maximo ?? minimo * 2;
  return Math.max(0, Math.ceil(referencia - existencia));
}

/** Overlay simple reutilizado por los sub-diálogos de este módulo (mismo criterio de fondo
 *  oscuro + tarjeta que PosModalDescuento/PosModalCancelarPedido). */
function DialogoBase({ titulo, onCerrar, colores, children }: { titulo: string; onCerrar: () => void; colores: ReturnType<typeof usarColores>; children: React.ReactNode }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 16 }}>
        <View style={{ backgroundColor: colores.superficie, borderRadius: 16, padding: 18, maxHeight: "85%" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ fontSize: 17, fontWeight: "800", color: colores.texto }}>{titulo}</Text>
            <TouchableOpacity onPress={onCerrar}><Text style={{ color: colores.textoSecundario, fontSize: 20 }}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Inventario (existencias, insumos, niveles, movimientos, traspasos) — mismo módulo que
 *  AdminInventario.tsx del POS Windows. El reporte/lista de compras (allá PDF/Excel con vista
 *  previa hoja carta) se reemplaza por texto plano vía Share.share() — no hay jsPDF/xlsx
 *  instalados aquí ni diálogo nativo de guardar archivo (decisión del plan). */
export function PosAdminInventario() {
  const { usuario } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [filtroNivel, setFiltroNivel] = useState<"TODOS" | NivelInventario>("TODOS");

  const [nuevoInsumo, setNuevoInsumo] = useState({ nombre: "", unidadMedida: "pz", costoUnitario: "", precioVenta: "", proveedorId: "", minimo: "", maximo: "" });
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [nuevoProveedor, setNuevoProveedor] = useState({ nombre: "", telefono: "" });

  const [editandoInsumoId, setEditandoInsumoId] = useState<string | null>(null);
  const [borradorInsumo, setBorradorInsumo] = useState({ nombre: "", unidadMedida: "pz", costoUnitario: "", precioVenta: "", proveedorId: "", minimo: "", maximo: "" });

  const [modalMovimiento, setModalMovimiento] = useState<Insumo | null>(null);
  const [mov, setMov] = useState({ tipo: "ENTRADA", cantidad: "", motivo: "" });
  const [modalMovimientosRecientes, setModalMovimientosRecientes] = useState(false);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);

  const [modalHistorial, setModalHistorial] = useState(false);
  const [historialInsumoId, setHistorialInsumoId] = useState("");

  const [modalConteo, setModalConteo] = useState(false);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [guardandoConteo, setGuardandoConteo] = useState(false);

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
    setMovimientos(await apiFetch<Movimiento[]>(`/inventario/movimientos?sucursalId=${suc}`));
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
        return { insumo: i, existencia, minimo, maximo, porcentaje, nivel };
      })
      .filter((f) => (texto ? f.insumo.nombre.toLowerCase().includes(texto) : true))
      .filter((f) => (filtroNivel === "TODOS" ? true : f.nivel === filtroNivel));
  }, [insumos, existencias, busqueda, filtroNivel]);

  async function crearInsumo() {
    if (!usuario || !nuevoInsumo.nombre.trim()) return;
    await apiFetch("/inventario/insumos", {
      method: "POST",
      body: JSON.stringify({
        empresaId: usuario.empresaId, nombre: nuevoInsumo.nombre, unidadMedida: nuevoInsumo.unidadMedida,
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
      precioVenta: f.insumo.precioVenta ?? "", proveedorId: f.insumo.proveedorId ?? "", minimo: String(f.minimo), maximo: f.maximo != null ? String(f.maximo) : "",
    });
  }

  async function guardarEdicionInsumo(id: string) {
    if (!borradorInsumo.nombre.trim()) return;
    await Promise.all([
      apiFetch(`/inventario/insumos/${id}`, { method: "PATCH", body: JSON.stringify({ nombre: borradorInsumo.nombre, unidadMedida: borradorInsumo.unidadMedida, costoUnitario: Number(borradorInsumo.costoUnitario) || 0, precioVenta: borradorInsumo.precioVenta ? Number(borradorInsumo.precioVenta) : null, proveedorId: borradorInsumo.proveedorId || null }) }),
      apiFetch("/inventario/minimos", { method: "POST", body: JSON.stringify({ sucursalId, insumoId: id, minimo: Number(borradorInsumo.minimo) || 0, maximo: borradorInsumo.maximo ? Number(borradorInsumo.maximo) : undefined }) }),
    ]);
    setEditandoInsumoId(null);
    setMensaje("Insumo actualizado.");
    cargar(sucursalId);
  }

  function confirmarEliminarInsumo(i: Insumo) {
    Alert.alert("Eliminar insumo", `¿Eliminar "${i.nombre}"? Deja de aparecer en inventario y en recetas nuevas (el historial ya registrado no se pierde).`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => { await apiFetch(`/inventario/insumos/${i.id}`, { method: "PATCH", body: JSON.stringify({ activo: false }) }); setMensaje("Insumo eliminado."); cargar(sucursalId); } },
    ]);
  }

  async function crearProveedor() {
    if (!usuario || !nuevoProveedor.nombre.trim()) return;
    await apiFetch("/proveedores", { method: "POST", body: JSON.stringify({ empresaId: usuario.empresaId, nombre: nuevoProveedor.nombre, telefono: nuevoProveedor.telefono || undefined }) });
    setNuevoProveedor({ nombre: "", telefono: "" });
    cargarProveedores();
  }

  function confirmarEliminarProveedor(p: Proveedor) {
    Alert.alert("Eliminar proveedor", `¿Eliminar proveedor "${p.nombre}"? Los insumos que ya lo tienen asignado conservan la referencia.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => { await apiFetch(`/proveedores/${p.id}`, { method: "PATCH", body: JSON.stringify({ activo: false }) }); cargarProveedores(); } },
    ]);
  }

  async function registrarMovimiento() {
    if (!usuario || !modalMovimiento || !mov.cantidad) return;
    await apiFetch("/inventario/movimientos", { method: "POST", body: JSON.stringify({ sucursalId, insumoId: modalMovimiento.id, tipo: mov.tipo, cantidad: Number(mov.cantidad), motivo: mov.motivo || undefined, usuarioId: usuario.id }) });
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
      await Promise.all(cambios.map((f) => apiFetch("/inventario/movimientos", { method: "POST", body: JSON.stringify({ sucursalId, insumoId: f.insumo.id, tipo: "CONTEO", cantidad: Number(conteo[f.insumo.id]) - f.existencia, motivo: "Conteo físico de inventario", usuarioId: usuario.id }) })));
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
    const creado = await apiFetch<Traspaso>("/traspasos", { method: "POST", body: JSON.stringify({ sucursalOrigenId: sucursalId, sucursalDestinoId: traspaso.sucursalDestinoId, usuarioSolicitaId: usuario.id, items: [{ insumoId: modalTraspaso.id, cantidadSolicitada: cantidad }] }) });
    await apiFetch(`/traspasos/${creado.id}/autorizar`, { method: "POST", body: JSON.stringify({ usuarioAutorizaId: usuario.id }) });
    await apiFetch(`/traspasos/${creado.id}/enviar`, { method: "POST", body: JSON.stringify({ usuarioEnviaId: usuario.id, items: creado.items.map((it) => ({ itemId: it.id, cantidad })) }) });
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

  async function compartirReporte(tipo: "reporte" | "compras") {
    const base = tipo === "compras" ? filas.filter((f) => f.nivel !== "OPTIMO") : filas;
    if (base.length === 0) {
      Alert.alert(tipo === "compras" ? "Lista de compras" : "Reporte de inventario", "No hay insumos en nivel bajo o crítico — todo está en niveles óptimos.");
      return;
    }
    const titulo = tipo === "compras" ? "LISTA DE COMPRAS" : "REPORTE DE INVENTARIO";
    const lineas = base.map((f) =>
      tipo === "compras"
        ? `${f.insumo.nombre} — ${f.existencia} ${f.insumo.unidadMedida} (mín. ${f.minimo}) · ${f.insumo.proveedor?.nombre ?? "sin proveedor"} · sugerido: ${calcularSugerido(f.existencia, f.minimo, f.maximo)} ${f.insumo.unidadMedida}`
        : `${f.insumo.nombre} — ${f.existencia} ${f.insumo.unidadMedida} (mín. ${f.minimo}) · ${ETIQUETA_NIVEL[f.nivel]}`,
    );
    const texto = `HANGAR 421 — ${titulo}\nGenerado el ${new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}\n\n${lineas.join("\n")}`;
    try { await Share.share({ message: texto }); } catch { /* el usuario canceló el share sheet */ }
  }

  const movimientosHistorial = historialInsumoId ? movimientos.filter((m) => m.insumoId === historialInsumoId) : movimientos;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <Text style={estilos.titulo}>Inventario</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 10 }}>
        {sucursales.map((s) => (
          <TouchableOpacity key={s.id} onPress={() => { setSucursalId(s.id); cargar(s.id); }} style={[estilos.chip, sucursalId === s.id && estilos.chipActivo]}>
            <Text style={{ color: sucursalId === s.id ? "#fff" : colores.texto, fontSize: 13 }}>{s.nombre}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mensaje && <Text style={estilos.mensaje}>{mensaje}</Text>}

      {traspasosPendientes.length > 0 && (
        <View style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: colores.blue }]}>
          <Text style={{ color: colores.texto, fontWeight: "800" }}>📥 {traspasosPendientes.length} traspaso(s) por recibir</Text>
          {traspasosPendientes.map((t) => (
            <View key={t.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 8 }}>
              <Text style={{ color: colores.texto, fontSize: 13, flex: 1 }}>{t.items.map((it) => `${it.insumo.nombre} (${it.cantidadEnviada ?? it.cantidadSolicitada} ${it.insumo.unidadMedida})`).join(", ")}</Text>
              <TouchableOpacity onPress={() => recibirTraspaso(t)} style={[estilos.botonChico, { backgroundColor: colores.navy }]}><Text style={{ color: "#fff", fontSize: 12 }}>Recibir</Text></TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={estilos.tarjeta}>
        <TextInput placeholder="Buscar insumo…" placeholderTextColor={colores.textoSecundario} value={busqueda} onChangeText={setBusqueda} style={estilos.input} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {(["TODOS", "OPTIMO", "BAJO", "CRITICO"] as const).map((n) => (
            <TouchableOpacity key={n} onPress={() => setFiltroNivel(n)} style={[estilos.chip, filtroNivel === n && estilos.chipActivo]}>
              <Text style={{ color: filtroNivel === n ? "#fff" : colores.texto, fontSize: 12 }}>{n === "TODOS" ? "Todos los niveles" : ETIQUETA_NIVEL[n]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <TouchableOpacity onPress={() => setModalConteo(true)} style={[estilos.botonAccion, { backgroundColor: colores.amber + "22", borderColor: colores.amber }]}><Text style={{ color: colores.texto, fontSize: 12 }}>📋 Hacer inventario</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => compartirReporte("reporte")} style={[estilos.botonAccion, { backgroundColor: colores.green + "22", borderColor: colores.green }]}><Text style={{ color: colores.texto, fontSize: 12 }}>📄 Reporte</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => compartirReporte("compras")} style={[estilos.botonAccion, { backgroundColor: colores.green + "22", borderColor: colores.green }]}><Text style={{ color: colores.texto, fontSize: 12 }}>🛒 Lista de compras</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => { setModalMovimientosRecientes(true); cargarMovimientosRecientes(sucursalId); }} style={[estilos.botonAccion, { backgroundColor: "transparent", borderColor: colores.blue }]}><Text style={{ color: colores.blue, fontSize: 12 }}>🔄 Movimientos</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => { setModalHistorial(true); cargarMovimientosRecientes(sucursalId); }} style={[estilos.botonAccion, { backgroundColor: "transparent", borderColor: "#8b5cf6" }]}><Text style={{ color: "#8b5cf6", fontSize: 12 }}>🕘 Historial</Text></TouchableOpacity>
        </View>
      </View>

      {filas.map((f) => {
        const i = f.insumo;
        if (editandoInsumoId === i.id) {
          return (
            <View key={i.id} style={estilos.tarjeta}>
              <TextInput value={borradorInsumo.nombre} onChangeText={(v) => setBorradorInsumo((b) => ({ ...b, nombre: v }))} style={estilos.input} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput placeholder="Mínimo" placeholderTextColor={colores.textoSecundario} value={borradorInsumo.minimo} onChangeText={(v) => setBorradorInsumo((b) => ({ ...b, minimo: v }))} keyboardType="decimal-pad" style={[estilos.input, { flex: 1 }]} />
                <TextInput placeholder="Máximo" placeholderTextColor={colores.textoSecundario} value={borradorInsumo.maximo} onChangeText={(v) => setBorradorInsumo((b) => ({ ...b, maximo: v }))} keyboardType="decimal-pad" style={[estilos.input, { flex: 1 }]} />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput placeholder="Costo" placeholderTextColor={colores.textoSecundario} value={borradorInsumo.costoUnitario} onChangeText={(v) => setBorradorInsumo((b) => ({ ...b, costoUnitario: v }))} keyboardType="decimal-pad" style={[estilos.input, { flex: 1 }]} />
                <TextInput placeholder="Precio venta" placeholderTextColor={colores.textoSecundario} value={borradorInsumo.precioVenta} onChangeText={(v) => setBorradorInsumo((b) => ({ ...b, precioVenta: v }))} keyboardType="decimal-pad" style={[estilos.input, { flex: 1 }]} />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={() => guardarEdicionInsumo(i.id)} style={[estilos.botonChico, { backgroundColor: colores.green }]}><Text style={{ color: "#fff", fontWeight: "700" }}>Guardar</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setEditandoInsumoId(null)} style={[estilos.botonChico, { backgroundColor: colores.gray200 }]}><Text style={{ color: colores.texto }}>Cancelar</Text></TouchableOpacity>
              </View>
            </View>
          );
        }
        return (
          <View key={i.id} style={estilos.tarjeta}>
            <View style={estilos.filaEncabezado}>
              <Text style={estilos.nombre}>{i.nombre}</Text>
              <View style={[estilos.pildora, { backgroundColor: f.nivel === "OPTIMO" ? colores.green + "22" : f.nivel === "BAJO" ? colores.amber + "22" : colores.red + "22" }]}>
                <Text style={{ color: f.nivel === "OPTIMO" ? colores.green : f.nivel === "BAJO" ? colores.amber : colores.red, fontSize: 11, fontWeight: "700" }}>{ETIQUETA_NIVEL[f.nivel]}</Text>
              </View>
            </View>
            <Text style={estilos.detalle}>{f.existencia} {i.unidadMedida} · mín. {f.minimo} · {i.proveedor?.nombre ?? "sin proveedor"}</Text>
            <Text style={estilos.detalle}>Costo ${Number(i.costoUnitario).toFixed(2)}{i.precioVenta != null ? ` · Venta $${Number(i.precioVenta).toFixed(2)}` : ""}</Text>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colores.gray200, marginTop: 8 }}>
              <View style={{ height: 8, borderRadius: 4, width: `${f.porcentaje}%`, backgroundColor: f.nivel === "OPTIMO" ? colores.green : f.nivel === "BAJO" ? colores.amber : colores.red }} />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              <TouchableOpacity onPress={() => empezarEdicionInsumo(f)} style={[estilos.botonChico, { backgroundColor: colores.gray50 }]}><Text style={{ color: colores.texto, fontSize: 12 }}>✏️ Editar</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => { setModalMovimiento(i); setMov({ tipo: "ENTRADA", cantidad: "", motivo: "" }); }} style={[estilos.botonChico, { backgroundColor: "transparent", borderWidth: 1, borderColor: colores.blue }]}><Text style={{ color: colores.blue, fontSize: 12 }}>Movimiento</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => { setModalTraspaso(i); setTraspaso({ sucursalDestinoId: "", cantidad: "" }); }} style={[estilos.botonChico, { backgroundColor: "transparent", borderWidth: 1, borderColor: "#8b5cf6" }]}><Text style={{ color: "#8b5cf6", fontSize: 12 }}>Traspasar</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => confirmarEliminarInsumo(i)} style={[estilos.botonChico, { backgroundColor: colores.red + "22" }]}><Text style={{ color: colores.red, fontSize: 12 }}>Eliminar</Text></TouchableOpacity>
            </View>
          </View>
        );
      })}
      {filas.length === 0 && <Text style={estilos.detalle}>Sin insumos que coincidan.</Text>}

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Nuevo insumo</Text>
        <TextInput placeholder="Nombre (ej. Leche entera)" placeholderTextColor={colores.textoSecundario} value={nuevoInsumo.nombre} onChangeText={(v) => setNuevoInsumo((n) => ({ ...n, nombre: v }))} style={estilos.input} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {UNIDADES.map((u) => (
            <TouchableOpacity key={u} onPress={() => setNuevoInsumo((n) => ({ ...n, unidadMedida: u }))} style={[estilos.chip, nuevoInsumo.unidadMedida === u && estilos.chipActivo]}>
              <Text style={{ color: nuevoInsumo.unidadMedida === u ? "#fff" : colores.texto, fontSize: 12 }}>{u}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {proveedores.map((p) => (
            <TouchableOpacity key={p.id} onPress={() => setNuevoInsumo((n) => ({ ...n, proveedorId: n.proveedorId === p.id ? "" : p.id }))} style={[estilos.chip, nuevoInsumo.proveedorId === p.id && estilos.chipActivo]}>
              <Text style={{ color: nuevoInsumo.proveedorId === p.id ? "#fff" : colores.texto, fontSize: 12 }}>{p.nombre}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput placeholder="Precio costo" placeholderTextColor={colores.textoSecundario} value={nuevoInsumo.costoUnitario} onChangeText={(v) => setNuevoInsumo((n) => ({ ...n, costoUnitario: v }))} keyboardType="decimal-pad" style={[estilos.input, { flex: 1 }]} />
          <TextInput placeholder="Precio venta" placeholderTextColor={colores.textoSecundario} value={nuevoInsumo.precioVenta} onChangeText={(v) => setNuevoInsumo((n) => ({ ...n, precioVenta: v }))} keyboardType="decimal-pad" style={[estilos.input, { flex: 1 }]} />
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput placeholder="Stock mínimo" placeholderTextColor={colores.textoSecundario} value={nuevoInsumo.minimo} onChangeText={(v) => setNuevoInsumo((n) => ({ ...n, minimo: v }))} keyboardType="decimal-pad" style={[estilos.input, { flex: 1 }]} />
          <TextInput placeholder="Stock máximo" placeholderTextColor={colores.textoSecundario} value={nuevoInsumo.maximo} onChangeText={(v) => setNuevoInsumo((n) => ({ ...n, maximo: v }))} keyboardType="decimal-pad" style={[estilos.input, { flex: 1 }]} />
        </View>
        <TouchableOpacity onPress={crearInsumo} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Crear insumo</Text></TouchableOpacity>
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Proveedores</Text>
        {proveedores.length === 0 && <Text style={estilos.detalle}>Sin proveedores dados de alta todavía.</Text>}
        {proveedores.map((p) => (
          <View key={p.id} style={estilos.filaProveedor}>
            <Text style={{ color: colores.texto, fontSize: 14 }}>{p.nombre}{p.telefono ? ` · ${p.telefono}` : ""}</Text>
            <TouchableOpacity onPress={() => confirmarEliminarProveedor(p)}><Text style={{ color: colores.red, fontSize: 12 }}>Eliminar</Text></TouchableOpacity>
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <TextInput placeholder="Nombre del proveedor" placeholderTextColor={colores.textoSecundario} value={nuevoProveedor.nombre} onChangeText={(v) => setNuevoProveedor((p) => ({ ...p, nombre: v }))} style={[estilos.input, { flex: 2, marginBottom: 0 }]} />
          <TextInput placeholder="Teléfono" placeholderTextColor={colores.textoSecundario} value={nuevoProveedor.telefono} onChangeText={(v) => setNuevoProveedor((p) => ({ ...p, telefono: v }))} style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
          <TouchableOpacity onPress={crearProveedor} style={[estilos.botonChico, { backgroundColor: colores.navy }]}><Text style={{ color: "#fff", fontWeight: "700" }}>+</Text></TouchableOpacity>
        </View>
      </View>

      {modalMovimiento && (
        <DialogoBase titulo={`Movimiento — ${modalMovimiento.nombre}`} onCerrar={() => setModalMovimiento(null)} colores={colores}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {TIPOS_MOVIMIENTO.map((t) => (
              <TouchableOpacity key={t} onPress={() => setMov((m) => ({ ...m, tipo: t }))} style={[estilos.chip, mov.tipo === t && estilos.chipActivo]}>
                <Text style={{ color: mov.tipo === t ? "#fff" : colores.texto, fontSize: 12 }}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput placeholder="Cantidad" placeholderTextColor={colores.textoSecundario} value={mov.cantidad} onChangeText={(v) => setMov((m) => ({ ...m, cantidad: v }))} keyboardType="decimal-pad" style={estilos.input} />
          <TextInput placeholder="Motivo (opcional)" placeholderTextColor={colores.textoSecundario} value={mov.motivo} onChangeText={(v) => setMov((m) => ({ ...m, motivo: v }))} style={estilos.input} />
          <TouchableOpacity onPress={registrarMovimiento} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Registrar</Text></TouchableOpacity>
        </DialogoBase>
      )}

      {modalMovimientosRecientes && (
        <DialogoBase titulo="Movimientos recientes" onCerrar={() => setModalMovimientosRecientes(false)} colores={colores}>
          {movimientos.slice(0, 30).map((m) => (
            <View key={m.id} style={estilos.filaMovimiento}>
              <Text style={{ color: colores.texto, fontSize: 13 }}>{m.insumo.nombre} · {m.tipo} · {m.cantidad} {m.insumo.unidadMedida}</Text>
              <Text style={estilos.detalle}>{new Date(m.createdAt).toLocaleString("es-MX")}{m.motivo ? ` · ${m.motivo}` : ""}</Text>
            </View>
          ))}
          {movimientos.length === 0 && <Text style={estilos.detalle}>Sin movimientos todavía.</Text>}
        </DialogoBase>
      )}

      {modalHistorial && (
        <DialogoBase titulo="Historial de movimientos" onCerrar={() => setModalHistorial(false)} colores={colores}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            <TouchableOpacity onPress={() => setHistorialInsumoId("")} style={[estilos.chip, historialInsumoId === "" && estilos.chipActivo]}>
              <Text style={{ color: historialInsumoId === "" ? "#fff" : colores.texto, fontSize: 12 }}>Todos</Text>
            </TouchableOpacity>
            {insumos.map((i) => (
              <TouchableOpacity key={i.id} onPress={() => setHistorialInsumoId(i.id)} style={[estilos.chip, historialInsumoId === i.id && estilos.chipActivo]}>
                <Text style={{ color: historialInsumoId === i.id ? "#fff" : colores.texto, fontSize: 12 }}>{i.nombre}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {movimientosHistorial.map((m) => (
            <View key={m.id} style={estilos.filaMovimiento}>
              <Text style={{ color: colores.texto, fontSize: 13 }}>{m.insumo.nombre} · {m.tipo} · {m.cantidad} {m.insumo.unidadMedida}</Text>
              <Text style={estilos.detalle}>{new Date(m.createdAt).toLocaleString("es-MX")}{m.motivo ? ` · ${m.motivo}` : ""}</Text>
            </View>
          ))}
          {movimientosHistorial.length === 0 && <Text style={estilos.detalle}>Sin movimientos todavía.</Text>}
        </DialogoBase>
      )}

      {modalConteo && (
        <DialogoBase titulo="Hacer inventario (conteo físico)" onCerrar={() => setModalConteo(false)} colores={colores}>
          <Text style={estilos.detalle}>Captura la cantidad que contaste físicamente de cada insumo. Solo se ajustan los que dejes con un valor distinto al actual.</Text>
          {filas.map((f) => (
            <View key={f.insumo.id} style={estilos.filaConteo}>
              <Text style={{ color: colores.texto, fontSize: 13, flex: 1 }}>{f.insumo.nombre}</Text>
              <Text style={estilos.detalle}>{f.existencia} {f.insumo.unidadMedida}</Text>
              <TextInput placeholder={String(f.existencia)} placeholderTextColor={colores.textoSecundario} value={conteo[f.insumo.id] ?? ""} onChangeText={(v) => setConteo((c) => ({ ...c, [f.insumo.id]: v }))} keyboardType="decimal-pad" style={[estilos.input, { width: 90, marginBottom: 0 }]} />
            </View>
          ))}
          <TouchableOpacity onPress={guardarConteo} disabled={guardandoConteo} style={[estilos.botonPrincipal, { marginTop: 12 }]}><Text style={estilos.botonPrincipalTexto}>{guardandoConteo ? "Guardando…" : "Guardar conteo"}</Text></TouchableOpacity>
        </DialogoBase>
      )}

      {modalTraspaso && (
        <DialogoBase titulo={`Traspasar — ${modalTraspaso.nombre}`} onCerrar={() => setModalTraspaso(null)} colores={colores}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {sucursales.filter((s) => s.id !== sucursalId).map((s) => (
              <TouchableOpacity key={s.id} onPress={() => setTraspaso((t) => ({ ...t, sucursalDestinoId: s.id }))} style={[estilos.chip, traspaso.sucursalDestinoId === s.id && estilos.chipActivo]}>
                <Text style={{ color: traspaso.sucursalDestinoId === s.id ? "#fff" : colores.texto, fontSize: 12 }}>{s.nombre}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput placeholder="Cantidad" placeholderTextColor={colores.textoSecundario} value={traspaso.cantidad} onChangeText={(v) => setTraspaso((t) => ({ ...t, cantidad: v }))} keyboardType="decimal-pad" style={estilos.input} />
          <Text style={estilos.detalle}>Se descuenta de esta sucursal de inmediato y queda pendiente de recibir en destino.</Text>
          <TouchableOpacity onPress={confirmarTraspaso} disabled={!traspaso.sucursalDestinoId || !traspaso.cantidad} style={[estilos.botonPrincipal, { backgroundColor: "#8b5cf6", marginTop: 10 }]}><Text style={estilos.botonPrincipalTexto}>Enviar traspaso</Text></TouchableOpacity>
        </DialogoBase>
      )}
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto },
    subtitulo: { fontSize: 16, fontWeight: "800", color: colores.texto, marginBottom: 8 },
    detalle: { fontSize: 12, color: colores.textoSecundario, marginTop: 2 },
    mensaje: { color: colores.navyTexto, marginBottom: 10 },
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 12 },
    nombre: { fontSize: 15, fontWeight: "700", color: colores.texto },
    pildora: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonChico: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    botonAccion: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
    filaProveedor: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colores.borde },
    filaMovimiento: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colores.borde },
    filaConteo: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colores.borde },
  });
}
