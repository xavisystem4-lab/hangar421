import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { abrirBaseDeDatos } from "../db/database";
import { listarCategorias, listarProductos, type CategoriaLocal, type ProductoLocal } from "../db/catalogoRepo";
import {
  crearCategoria,
  editarCategoria,
  desactivarCategoria,
  crearProducto,
  editarProducto,
  alternarDisponibilidadProducto,
  contarCambiosSoloLocales,
} from "../db/catalogoAdminRepo";

/** Administración de catálogo — crear productos/categorías nuevos es local-only (ver
 *  catalogoAdminRepo.ts: sin ruta de sync para altas completas, gap de backend documentado);
 *  editar precio/disponibilidad de un producto YA sincronizado sí sale por sync. */
export function PosAdminCatalogoScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const { usuario } = useAuthLocalStore();
  const [categorias, setCategorias] = useState<CategoriaLocal[]>([]);
  const [productos, setProductos] = useState<ProductoLocal[]>([]);
  const [cambiosLocales, setCambiosLocales] = useState(0);

  const [nombreCategoria, setNombreCategoria] = useState("");
  const [categoriaEditando, setCategoriaEditando] = useState<string | null>(null);
  const [nombreCategoriaBorrador, setNombreCategoriaBorrador] = useState("");

  const [categoriaNuevoProducto, setCategoriaNuevoProducto] = useState<string | null>(null);
  const [nombreProducto, setNombreProducto] = useState("");
  const [precioProducto, setPrecioProducto] = useState("");
  const [productoEditando, setProductoEditando] = useState<string | null>(null);
  const [productoBorrador, setProductoBorrador] = useState({ nombre: "", precio: "" });

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const [cats, prods] = await Promise.all([listarCategorias(db), listarProductos(db)]);
    setCategorias(cats);
    setProductos(prods);
    setCambiosLocales(await contarCambiosSoloLocales(db));
    if (!categoriaNuevoProducto && cats[0]) setCategoriaNuevoProducto(cats[0].id);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function agregarCategoria() {
    if (!nombreCategoria.trim()) return;
    const db = await abrirBaseDeDatos();
    await crearCategoria(db, { nombre: nombreCategoria.trim(), orden: categorias.length + 1 });
    setNombreCategoria("");
    cargar();
  }

  async function guardarCategoria(id: string) {
    if (!nombreCategoriaBorrador.trim()) return;
    const db = await abrirBaseDeDatos();
    await editarCategoria(db, id, nombreCategoriaBorrador.trim());
    setCategoriaEditando(null);
    cargar();
  }

  async function eliminarCategoria(id: string) {
    const db = await abrirBaseDeDatos();
    await desactivarCategoria(db, id);
    cargar();
  }

  async function agregarProducto() {
    if (!categoriaNuevoProducto || !nombreProducto.trim() || !precioProducto) return;
    const db = await abrirBaseDeDatos();
    await crearProducto(db, { categoriaId: categoriaNuevoProducto, nombre: nombreProducto.trim(), precioBase: Number(precioProducto) || 0 });
    setNombreProducto("");
    setPrecioProducto("");
    cargar();
  }

  async function guardarProducto(id: string) {
    if (!productoBorrador.nombre.trim() || !usuario) return;
    const db = await abrirBaseDeDatos();
    await editarProducto(db, id, { nombre: productoBorrador.nombre.trim(), precioBase: Number(productoBorrador.precio) || 0 }, usuario.id);
    setProductoEditando(null);
    cargar();
  }

  async function alternarDisponibilidad(p: ProductoLocal) {
    if (!usuario) return;
    const db = await abrirBaseDeDatos();
    await alternarDisponibilidadProducto(db, p.id, !p.activo, usuario.id);
    cargar();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Catálogo</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>

      {cambiosLocales > 0 && (
        <Text style={estilos.avisoLocal}>⚠ {cambiosLocales} cambio(s) sin confirmar del ERP: los productos nuevos creados aquí se quedan solo en este dispositivo; los cambios de precio/disponibilidad de productos ya sincronizados sí se envían al conectar.</Text>
      )}

      {categorias.map((cat) => (
        <View key={cat.id} style={estilos.tarjeta}>
          {categoriaEditando === cat.id ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput value={nombreCategoriaBorrador} onChangeText={setNombreCategoriaBorrador} style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
              <TouchableOpacity onPress={() => guardarCategoria(cat.id)} style={[estilos.botonChico, { backgroundColor: colores.green }]}><Text style={{ color: "#fff" }}>Guardar</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setCategoriaEditando(null)} style={[estilos.botonChico, { backgroundColor: colores.gray200 }]}><Text style={{ color: colores.texto }}>Cancelar</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={estilos.filaEncabezado}>
              <Text style={estilos.nombreCategoria}>{cat.nombre}</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <TouchableOpacity onPress={() => { setCategoriaEditando(cat.id); setNombreCategoriaBorrador(cat.nombre); }} style={[estilos.botonChico, { backgroundColor: colores.gray50 }]}><Text style={{ color: colores.texto, fontSize: 12 }}>Editar</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => eliminarCategoria(cat.id)} style={[estilos.botonChico, { backgroundColor: colores.red + "22" }]}><Text style={{ color: colores.red, fontSize: 12 }}>Eliminar</Text></TouchableOpacity>
              </View>
            </View>
          )}

          {productos.filter((p) => p.categoriaId === cat.id).map((p) => (
            <View key={p.id} style={estilos.filaProducto}>
              {productoEditando === p.id ? (
                <>
                  <TextInput value={productoBorrador.nombre} onChangeText={(v) => setProductoBorrador((b) => ({ ...b, nombre: v }))} style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
                  <TextInput value={productoBorrador.precio} onChangeText={(v) => setProductoBorrador((b) => ({ ...b, precio: v }))} keyboardType="decimal-pad" style={[estilos.input, { width: 80, marginBottom: 0 }]} />
                  <TouchableOpacity onPress={() => guardarProducto(p.id)}><Text style={{ color: colores.green, fontSize: 12, fontWeight: "700" }}>Guardar</Text></TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={{ color: colores.texto, flex: 1 }} numberOfLines={1}>{p.nombre}</Text>
                  <Text style={{ color: colores.textoSecundario, width: 60, textAlign: "right" }}>${p.precioBase.toFixed(2)}</Text>
                  <TouchableOpacity onPress={() => alternarDisponibilidad(p)}>
                    <Text style={{ color: p.activo ? colores.green : colores.red, fontSize: 12, marginLeft: 10 }}>{p.activo ? "Disponible" : "Agotado"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setProductoEditando(p.id); setProductoBorrador({ nombre: p.nombre, precio: String(p.precioBase) }); }}>
                    <Text style={{ color: colores.navyTexto, fontSize: 12, marginLeft: 10 }}>Editar</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ))}
        </View>
      ))}

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Nueva categoría</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput placeholder="Nombre" placeholderTextColor={colores.textoSecundario} value={nombreCategoria} onChangeText={setNombreCategoria} style={[estilos.input, { flex: 1 }]} />
          <TouchableOpacity onPress={agregarCategoria} style={[estilos.botonChico, { backgroundColor: colores.navy }]}><Text style={{ color: "#fff" }}>+ Agregar</Text></TouchableOpacity>
        </View>
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Nuevo producto</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {categorias.map((c) => (
            <TouchableOpacity key={c.id} onPress={() => setCategoriaNuevoProducto(c.id)} style={[estilos.chip, categoriaNuevoProducto === c.id && estilos.chipActivo]}>
              <Text style={{ color: categoriaNuevoProducto === c.id ? "#fff" : colores.texto, fontSize: 12 }}>{c.nombre}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput placeholder="Nombre del producto" placeholderTextColor={colores.textoSecundario} value={nombreProducto} onChangeText={setNombreProducto} style={estilos.input} />
        <TextInput placeholder="Precio" placeholderTextColor={colores.textoSecundario} value={precioProducto} onChangeText={setPrecioProducto} keyboardType="decimal-pad" style={estilos.input} />
        <TouchableOpacity onPress={agregarProducto} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Crear producto</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    avisoLocal: { fontSize: 12, color: colores.amber, marginBottom: 14, lineHeight: 16 },
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    nombreCategoria: { fontSize: 16, fontWeight: "800", color: colores.texto },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginBottom: 8 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 12 },
    filaProducto: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: colores.borde, marginTop: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonChico: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
  });
}
