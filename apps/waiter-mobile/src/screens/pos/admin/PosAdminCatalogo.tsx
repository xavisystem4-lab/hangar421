import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { CategoriaProducto, Producto } from "@hangar421/shared";
import { apiFetch } from "../../../api/http";
import { useAuthStore } from "../../../store/authStore";
import { usarColores } from "../../../store/temaStore";

interface Insumo { id: string; nombre: string; unidadMedida: string }
interface RecetaItemDto { id: string; insumoId: string; cantidad: string; insumo: { nombre: string; unidadMedida: string } }

/** Alta, edición y baja de productos/categorías + receta — mismo módulo que AdminCatalogo.tsx
 *  del POS Windows. La receta se muestra como panel debajo del producto en vez de columna
 *  lateral fija (no hay ancho de escritorio en una tablet). */
export function PosAdminCatalogo() {
  const { usuario, sucursalId } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [categorias, setCategorias] = useState<CategoriaProducto[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [nuevo, setNuevo] = useState({ nombre: "", categoriaId: "", precioBase: "" });

  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [productoRecetaId, setProductoRecetaId] = useState<string | null>(null);
  const [receta, setReceta] = useState<RecetaItemDto[]>([]);
  const [insumoNuevo, setInsumoNuevo] = useState("");
  const [cantidadNueva, setCantidadNueva] = useState("");

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreBorrador, setNombreBorrador] = useState("");
  const [precioBorrador, setPrecioBorrador] = useState("");

  async function cargar() {
    if (!usuario || !sucursalId) return;
    const [cats, prods] = await Promise.all([
      apiFetch<CategoriaProducto[]>(`/catalogo/categorias?empresaId=${usuario.empresaId}`),
      apiFetch<Producto[]>(`/catalogo/productos?empresaId=${usuario.empresaId}&sucursalId=${sucursalId}`),
    ]);
    setCategorias(cats);
    setProductos(prods);
  }

  useEffect(() => {
    if (!usuario) return;
    cargar();
    apiFetch<Insumo[]>(`/inventario/insumos?empresaId=${usuario.empresaId}`).then((ins) => {
      setInsumos(ins);
      if (ins[0]) setInsumoNuevo(ins[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario, sucursalId]);

  async function crearProducto() {
    if (!usuario || !nuevo.nombre.trim() || !nuevo.categoriaId) return;
    await apiFetch("/catalogo/productos", { method: "POST", body: JSON.stringify({ empresaId: usuario.empresaId, categoriaId: nuevo.categoriaId, nombre: nuevo.nombre.trim(), precioBase: Number(nuevo.precioBase) || 0 }) });
    setNuevo({ nombre: "", categoriaId: "", precioBase: "" });
    cargar();
  }

  function empezarEdicion(p: Producto) {
    setEditandoId(p.id);
    setNombreBorrador(p.nombre);
    setPrecioBorrador(String(p.precioBase));
  }

  async function guardarEdicion(id: string) {
    if (!nombreBorrador.trim()) return;
    await apiFetch(`/catalogo/productos/${id}`, { method: "PATCH", body: JSON.stringify({ nombre: nombreBorrador.trim(), precioBase: Number(precioBorrador) || 0 }) });
    setEditandoId(null);
    cargar();
  }

  function confirmarEliminar(p: Producto) {
    Alert.alert("Eliminar producto", `¿Eliminar "${p.nombre}"? Ya no aparecerá en el catálogo (el historial de pedidos que ya lo usan no se pierde).`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => { await apiFetch(`/catalogo/productos/${p.id}`, { method: "PATCH", body: JSON.stringify({ activo: false }) }); cargar(); } },
    ]);
  }

  async function toggleDisponibilidad(p: Producto) {
    if (!sucursalId) return;
    await apiFetch(`/catalogo/productos/${p.id}/disponibilidad`, { method: "PATCH", body: JSON.stringify({ sucursalId, disponible: !p.disponibleSucursal }) });
    cargar();
  }

  async function abrirReceta(p: Producto) {
    setProductoRecetaId(p.id);
    setReceta(await apiFetch<RecetaItemDto[]>(`/inventario/productos/${p.id}/receta`));
  }

  async function agregarItemReceta() {
    if (!productoRecetaId || !insumoNuevo || !cantidadNueva) return;
    await apiFetch(`/inventario/productos/${productoRecetaId}/receta`, { method: "POST", body: JSON.stringify({ items: [{ insumoId: insumoNuevo, cantidad: Number(cantidadNueva) }] }) });
    setCantidadNueva("");
    setReceta(await apiFetch<RecetaItemDto[]>(`/inventario/productos/${productoRecetaId}/receta`));
  }

  async function quitarItemReceta(id: string) {
    await apiFetch(`/inventario/receta/${id}`, { method: "DELETE" });
    setReceta((r) => r.filter((x) => x.id !== id));
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <Text style={estilos.titulo}>Catálogo</Text>

      {categorias.map((cat) => (
        <View key={cat.id} style={{ marginBottom: 16 }}>
          <Text style={estilos.subtitulo}>{cat.nombre}</Text>
          {productos.filter((p) => p.categoriaId === cat.id).map((p) => (
            <View key={p.id} style={estilos.tarjeta}>
              {editandoId === p.id ? (
                <>
                  <TextInput value={nombreBorrador} onChangeText={setNombreBorrador} style={estilos.input} />
                  <TextInput value={precioBorrador} onChangeText={setPrecioBorrador} keyboardType="decimal-pad" style={estilos.input} />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity onPress={() => guardarEdicion(p.id)} style={[estilos.botonChico, { backgroundColor: colores.green }]}><Text style={{ color: "#fff", fontWeight: "700" }}>Guardar</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => setEditandoId(null)} style={[estilos.botonChico, { backgroundColor: colores.gray200 }]}><Text style={{ color: colores.texto }}>Cancelar</Text></TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <View style={estilos.filaEncabezado}>
                    <Text style={estilos.nombre}>{p.nombre}</Text>
                    <Text style={estilos.precio}>${(p.precioSucursal ?? p.precioBase).toFixed(2)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <TouchableOpacity onPress={() => toggleDisponibilidad(p)} style={[estilos.botonChico, { backgroundColor: p.disponibleSucursal !== false ? colores.green : colores.gray200 }]}>
                      <Text style={{ color: p.disponibleSucursal !== false ? "#fff" : colores.texto, fontSize: 12 }}>{p.disponibleSucursal !== false ? "Disponible" : "Agotado"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => abrirReceta(p)} style={[estilos.botonChico, { backgroundColor: colores.navy }]}><Text style={{ color: "#fff", fontSize: 12 }}>Receta</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => empezarEdicion(p)} style={[estilos.botonChico, { backgroundColor: colores.gray50 }]}><Text style={{ color: colores.texto, fontSize: 12 }}>Editar</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => confirmarEliminar(p)} style={[estilos.botonChico, { backgroundColor: colores.red + "22" }]}><Text style={{ color: colores.red, fontSize: 12 }}>Eliminar</Text></TouchableOpacity>
                  </View>

                  {productoRecetaId === p.id && (
                    <View style={estilos.panelReceta}>
                      <Text style={estilos.ayuda}>Las cantidades definidas aquí se descuentan solas del inventario cada vez que se vende este producto.</Text>
                      {receta.length === 0 && <Text style={estilos.ayuda}>Sin ingredientes definidos todavía.</Text>}
                      {receta.map((r) => (
                        <View key={r.id} style={estilos.filaReceta}>
                          <Text style={{ color: colores.texto, fontSize: 13 }}>{r.insumo.nombre} — {r.cantidad} {r.insumo.unidadMedida}</Text>
                          <TouchableOpacity onPress={() => quitarItemReceta(r.id)}><Text style={{ color: colores.red, fontSize: 12 }}>Quitar</Text></TouchableOpacity>
                        </View>
                      ))}
                      {insumos.length === 0 ? (
                        <Text style={estilos.ayuda}>No hay insumos dados de alta — créalos primero en Inventario.</Text>
                      ) : (
                        <>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {insumos.map((i) => (
                              <TouchableOpacity key={i.id} onPress={() => setInsumoNuevo(i.id)} style={[estilos.chip, insumoNuevo === i.id && estilos.chipActivo]}>
                                <Text style={{ color: insumoNuevo === i.id ? "#fff" : colores.texto, fontSize: 12 }}>{i.nombre}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                            <TextInput placeholder="Cantidad" placeholderTextColor={colores.textoSecundario} value={cantidadNueva} onChangeText={setCantidadNueva} keyboardType="decimal-pad" style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
                            <TouchableOpacity onPress={agregarItemReceta} style={[estilos.botonChico, { backgroundColor: colores.green }]}><Text style={{ color: "#fff", fontWeight: "700" }}>+</Text></TouchableOpacity>
                          </View>
                        </>
                      )}
                      <TouchableOpacity onPress={() => setProductoRecetaId(null)} style={{ marginTop: 10, alignSelf: "flex-start" }}><Text style={{ color: colores.textoSecundario, fontSize: 12 }}>Cerrar receta</Text></TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </View>
          ))}
        </View>
      ))}

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Nuevo producto</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {categorias.map((c) => (
            <TouchableOpacity key={c.id} onPress={() => setNuevo((n) => ({ ...n, categoriaId: c.id }))} style={[estilos.chip, nuevo.categoriaId === c.id && estilos.chipActivo]}>
              <Text style={{ color: nuevo.categoriaId === c.id ? "#fff" : colores.texto, fontSize: 12 }}>{c.nombre}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput placeholder="Nombre" placeholderTextColor={colores.textoSecundario} value={nuevo.nombre} onChangeText={(v) => setNuevo((n) => ({ ...n, nombre: v }))} style={estilos.input} />
        <TextInput placeholder="Precio base" placeholderTextColor={colores.textoSecundario} value={nuevo.precioBase} onChangeText={(v) => setNuevo((n) => ({ ...n, precioBase: v }))} keyboardType="decimal-pad" style={estilos.input} />
        <TouchableOpacity onPress={crearProducto} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Crear producto</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto, marginBottom: 14 },
    subtitulo: { fontSize: 16, fontWeight: "800", color: colores.texto, marginBottom: 8 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginTop: 4 },
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 12 },
    nombre: { fontSize: 15, fontWeight: "700", color: colores.texto },
    precio: { fontSize: 14, color: colores.textoSecundario },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonChico: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
    panelReceta: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colores.borde },
    filaReceta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colores.borde },
  });
}
