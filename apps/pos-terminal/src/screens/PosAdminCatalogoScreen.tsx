import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { abrirBaseDeDatos } from "../db/database";
import { listarCategorias, listarModificadores, listarProductos, modificadoresPorProducto, type CategoriaLocal, type ModificadorLocal, type ProductoLocal } from "../db/catalogoRepo";
import { coincideBusqueda } from "../db/busqueda";
import { coloresPorCategoria, conOpacidad } from "../caja/coloresCategoria";
import {
  crearCategoria,
  editarCategoria,
  desactivarCategoria,
  crearProducto,
  editarProducto,
  alternarDisponibilidadProducto,
  contarCambiosSoloLocales,
  fijarModificadoresDeProducto,
  crearModificadorLocal,
  editarModificadorLocal,
} from "../db/catalogoAdminRepo";
import type { ModificadorNuevo } from "../caja/nuevoModificador";
import { PromocionesAdmin } from "../components/PromocionesAdmin";
import { PERMISOS_TERMINAL, tienePermiso } from "../auth/permisosTerminal";
import { ModalModificadoresProducto } from "../components/ModalModificadoresProducto";
import { sincronizarPronto } from "../sync/syncEngine";

/** Administración de catálogo. Editar un producto es completo: nombre, precio, categoría y
 *  modificadores (incluso las opciones y precios de cada grupo). Dar de alta un producto (con los modificadores que debe preguntar)
 *  y cambiar precio/disponibilidad/modificadores sí viajan al ERP (ver catalogoAdminRepo.ts);
 *  crear una categoría nueva sigue siendo local-only. */
export function PosAdminCatalogoScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const { usuario } = useAuthLocalStore();
  // Esta pantalla agrupa dos permisos: Catálogo (productos, categorías, modificadores) y
  // Promociones (precios especiales). Cada persona ve solo lo que le toca.
  const puedeCatalogo = tienePermiso(usuario, PERMISOS_TERMINAL.ADMIN_CATALOGO);
  const puedePromociones = tienePermiso(usuario, PERMISOS_TERMINAL.ADMIN_PROMOCIONES);
  const [categorias, setCategorias] = useState<CategoriaLocal[]>([]);
  const [productos, setProductos] = useState<ProductoLocal[]>([]);
  const [cambiosLocales, setCambiosLocales] = useState(0);
  const [modificadores, setModificadores] = useState<ModificadorLocal[]>([]);
  const [modsPorProducto, setModsPorProducto] = useState<Map<string, string[]>>(new Map());
  // Modificadores elegidos para el producto que se está dando de alta.
  const [modsNuevoProducto, setModsNuevoProducto] = useState<string[]>([]);
  // Qué selector está abierto: el del alta, o el de un producto existente.
  const [eligiendoMods, setEligiendoMods] = useState<{ productoId: string | null; nombre: string } | null>(null);

  const [nombreCategoria, setNombreCategoria] = useState("");
  const [categoriaEditando, setCategoriaEditando] = useState<string | null>(null);
  const [nombreCategoriaBorrador, setNombreCategoriaBorrador] = useState("");

  const [categoriaNuevoProducto, setCategoriaNuevoProducto] = useState<string | null>(null);
  const [nombreProducto, setNombreProducto] = useState("");
  const [precioProducto, setPrecioProducto] = useState("");
  const [productoEditando, setProductoEditando] = useState<string | null>(null);
  const [productoBorrador, setProductoBorrador] = useState({ nombre: "", precio: "", categoriaId: "" });

  // Buscador + botones de categoría sobre la lista de productos. Al entrar no se lista ninguna
  // categoría: aparece la que se toque (sus productos) o lo que coincida con la búsqueda, que
  // recorre todo el catálogo. Mismo criterio que el Catálogo del ERP.
  const [busquedaCatalogo, setBusquedaCatalogo] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState<string | null>(null);
  const buscandoCatalogo = busquedaCatalogo.trim().length > 0;
  const colorPorCategoria = useMemo(() => coloresPorCategoria(categorias), [categorias]);
  const categoriasVisibles = useMemo(() => {
    if (buscandoCatalogo) {
      const conCoincidencia = new Set(productos.filter((p) => coincideBusqueda(`${p.nombre} ${p.subcategoria ?? ""}`, busquedaCatalogo)).map((p) => p.categoriaId));
      return categorias.filter((c) => conCoincidencia.has(c.id) || coincideBusqueda(c.nombre, busquedaCatalogo));
    }
    return categoriaFiltro ? categorias.filter((c) => c.id === categoriaFiltro) : [];
  }, [categorias, productos, busquedaCatalogo, buscandoCatalogo, categoriaFiltro]);
  const productosDeCategoria = (categoriaId: string) =>
    productos.filter((p) => p.categoriaId === categoriaId && (!buscandoCatalogo || coincideBusqueda(`${p.nombre} ${p.subcategoria ?? ""}`, busquedaCatalogo) || coincideBusqueda(categorias.find((c) => c.id === categoriaId)?.nombre ?? "", busquedaCatalogo)));

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const [cats, prods, mods, porProducto] = await Promise.all([
      listarCategorias(db), listarProductos(db, { incluirStandby: true }), listarModificadores(db), modificadoresPorProducto(db),
    ]);
    setCategorias(cats);
    setProductos(prods);
    setModificadores(mods);
    setModsPorProducto(porProducto);
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
    await crearProducto(db, { categoriaId: categoriaNuevoProducto, nombre: nombreProducto.trim(), precioBase: Number(precioProducto) || 0, modificadorIds: modsNuevoProducto }, usuario?.id);
    setNombreProducto("");
    setPrecioProducto("");
    setModsNuevoProducto([]);
    // Al ERP en cuanto haya red: así el producto existe allá antes de la primera venta.
    sincronizarPronto();
    cargar();
  }

  async function guardarModificadores(ids: string[]) {
    if (!eligiendoMods) return;
    if (eligiendoMods.productoId === null) {
      setModsNuevoProducto(ids);
    } else {
      const db = await abrirBaseDeDatos();
      await fijarModificadoresDeProducto(db, eligiendoMods.productoId, ids, usuario?.id);
      sincronizarPronto();
      cargar();
    }
    setEligiendoMods(null);
  }

  /** Crea el grupo, lo sube al ERP (va antes que el producto en el outbox) y recarga la lista. */
  async function crearModificador(nuevo: ModificadorNuevo): Promise<string> {
    const db = await abrirBaseDeDatos();
    const id = await crearModificadorLocal(db, nuevo, usuario?.id);
    sincronizarPronto();
    await cargar();
    return id;
  }

  /** Guarda los cambios de un grupo (opciones, precios) y lo manda al ERP; afecta a todos los productos que lo usan. */
  async function editarModificador(id: string, cambios: ModificadorNuevo): Promise<void> {
    const db = await abrirBaseDeDatos();
    await editarModificadorLocal(db, id, cambios, usuario?.id);
    sincronizarPronto();
    await cargar();
  }

  const nombresMods = (ids: string[]) => ids.map((id) => modificadores.find((m) => m.id === id)?.nombre).filter(Boolean).join(", ");

  async function guardarProducto(id: string) {
    if (!productoBorrador.nombre.trim() || !usuario) return;
    const db = await abrirBaseDeDatos();
    await editarProducto(db, id, { nombre: productoBorrador.nombre.trim(), precioBase: Number(productoBorrador.precio) || 0, categoriaId: productoBorrador.categoriaId || undefined }, usuario.id);
    setProductoEditando(null);
    sincronizarPronto();
    cargar();
  }

  /** En standby el producto deja de salir en los botones de Venta y en la búsqueda, pero se
   *  queda aquí para volver a ponerlo en venta. Se confirma porque con un toque accidental el
   *  producto "desaparecía" del mostrador sin que nadie supiera por qué. */
  function alternarDisponibilidad(p: ProductoLocal) {
    if (!usuario) return;
    const aplicar = async () => {
      const db = await abrirBaseDeDatos();
      await alternarDisponibilidadProducto(db, p.id, !p.activo, usuario.id);
      cargar();
    };
    if (!p.activo) { aplicar(); return; }
    Alert.alert(
      "Poner en standby",
      `"${p.nombre}" dejará de aparecer en los botones de venta de esta sucursal. Puedes volver a ponerlo en venta desde aquí.`,
      [{ text: "Cancelar", style: "cancel" }, { text: "Poner en standby", onPress: aplicar }],
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Catálogo</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>

      {/* Promociones: primero, porque es lo que más se cambia día a día. */}
      {puedePromociones && <PromocionesAdmin productos={productos} usuarioId={usuario?.id} />}

      {puedeCatalogo && (
        <>
      {cambiosLocales > 0 && (
        <Text style={estilos.avisoLocal}>⚠ {cambiosLocales} cambio(s) pendientes de confirmar por el ERP: productos nuevos, precios, disponibilidad y modificadores se envían al conectar. Las categorías nuevas se quedan solo en este dispositivo.</Text>
      )}

      {/* El alta va primero: es lo que se viene a hacer aquí la mayoría de las veces, y al
          final de una lista larga de productos quedaba escondida. */}
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
        {/* Producto compuesto: qué preguntar al venderlo (tamaño, leche, jarabes…). */}
        <TouchableOpacity onPress={() => setEligiendoMods({ productoId: null, nombre: nombreProducto.trim() || "Nuevo producto" })} style={estilos.botonMods} accessibilityLabel="Elegir modificadores del producto nuevo">
          <Text style={{ color: colores.texto, fontWeight: "700" }}>⚙ Modificadores</Text>
          <Text style={{ color: modsNuevoProducto.length > 0 ? colores.navyTexto : colores.textoSecundario, fontSize: 12, flex: 1, textAlign: "right" }} numberOfLines={2}>
            {modsNuevoProducto.length > 0 ? nombresMods(modsNuevoProducto) : "Ninguno · se agrega directo al carrito"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={agregarProducto} style={estilos.botonPrincipal}><Text style={estilos.botonPrincipalTexto}>Crear producto</Text></TouchableOpacity>
        <Text style={estilos.notaAlta}>Queda en venta en esta sucursal y en standby en las demás; el ERP lo recibe al sincronizar.</Text>
      </View>

      {/* Buscador y botones de categoría: la lista de abajo muestra solo la categoría elegida
          (o las coincidencias de la búsqueda). */}
      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Productos por categoría</Text>
        <TextInput
          placeholder="Buscar producto en todo el catálogo…"
          placeholderTextColor={colores.textoSecundario}
          value={busquedaCatalogo}
          onChangeText={setBusquedaCatalogo}
          style={estilos.input}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {categorias.map((c) => {
            const color = colorPorCategoria.get(c.id);
            const activa = !buscandoCatalogo && categoriaFiltro === c.id;
            const cuantos = productos.filter((p) => p.categoriaId === c.id).length;
            return (
              <TouchableOpacity
                key={c.id}
                onPress={() => { setBusquedaCatalogo(""); setCategoriaFiltro(categoriaFiltro === c.id ? null : c.id); }}
                style={[estilos.chip, estilos.chipCategoriaCatalogo, { backgroundColor: activa ? color?.fondo : conOpacidad(color?.fondo ?? "#1565C0", 0.72), borderColor: activa ? "#fff" : "transparent" }]}
                accessibilityState={{ selected: activa }}
              >
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>{c.nombre} <Text style={{ fontWeight: "400", opacity: 0.85 }}>({cuantos})</Text></Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {!buscandoCatalogo && !categoriaFiltro && (
          <Text style={estilos.notaAlta}>Toca una categoría para ver y editar sus productos, o escribe arriba para buscar en todo el catálogo.</Text>
        )}
        {buscandoCatalogo && categoriasVisibles.length === 0 && (
          <Text style={estilos.notaAlta}>Ningún producto coincide con "{busquedaCatalogo.trim()}".</Text>
        )}
      </View>

      {categoriasVisibles.map((cat) => (
        <View key={cat.id} style={[estilos.tarjeta, { borderLeftWidth: 5, borderLeftColor: colorPorCategoria.get(cat.id)?.fondo ?? colores.navy }]}>
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

          {productosDeCategoria(cat.id).length === 0 && (
            <Text style={estilos.notaAlta}>Sin productos en esta categoría.</Text>
          )}
          {productosDeCategoria(cat.id).map((p) => (
            <View key={p.id} style={estilos.filaProducto}>
              {productoEditando === p.id ? (
                // Edición completa: nombre, precio, categoría y modificadores. Todo viaja al ERP.
                <View style={{ flex: 1 }}>
                  <TextInput value={productoBorrador.nombre} onChangeText={(v) => setProductoBorrador((b) => ({ ...b, nombre: v }))} placeholder="Nombre" placeholderTextColor={colores.textoSecundario} style={estilos.input} />
                  <TextInput value={productoBorrador.precio} onChangeText={(v) => setProductoBorrador((b) => ({ ...b, precio: v }))} keyboardType="decimal-pad" placeholder="Precio" placeholderTextColor={colores.textoSecundario} style={estilos.input} />
                  <Text style={estilos.etiquetaEdicion}>Categoría</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {categorias.map((c) => (
                      <TouchableOpacity key={c.id} onPress={() => setProductoBorrador((b) => ({ ...b, categoriaId: c.id }))} style={[estilos.chip, productoBorrador.categoriaId === c.id && estilos.chipActivo]}>
                        <Text style={{ color: productoBorrador.categoriaId === c.id ? "#fff" : colores.texto, fontSize: 12 }}>{c.nombre}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity onPress={() => setEligiendoMods({ productoId: p.id, nombre: p.nombre })} style={estilos.botonMods} accessibilityLabel={`Modificadores de ${p.nombre}`}>
                    <Text style={{ color: colores.texto, fontWeight: "700" }}>⚙ Modificadores</Text>
                    <Text style={{ color: (modsPorProducto.get(p.id)?.length ?? 0) > 0 ? colores.navyTexto : colores.textoSecundario, fontSize: 12, flex: 1, textAlign: "right" }} numberOfLines={2}>
                      {(modsPorProducto.get(p.id)?.length ?? 0) > 0 ? nombresMods(modsPorProducto.get(p.id) ?? []) : "Ninguno"}
                    </Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity onPress={() => setProductoEditando(null)} style={[estilos.botonChico, { backgroundColor: colores.gray50, flex: 1, alignItems: "center" }]}><Text style={{ color: colores.texto, fontWeight: "700" }}>Cancelar</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => guardarProducto(p.id)} style={[estilos.botonChico, { backgroundColor: colores.green, flex: 1, alignItems: "center" }]} accessibilityLabel="Guardar producto"><Text style={{ color: "#fff", fontWeight: "700" }}>Guardar</Text></TouchableOpacity>
                  </View>
                </View>
              ) : (
                <>
                  <Text style={{ color: p.activo ? colores.texto : colores.textoSecundario, flex: 1 }} numberOfLines={1}>
                    {p.nombre}{p.activo ? "" : " · standby"}
                  </Text>
                  <Text style={{ color: colores.textoSecundario, width: 60, textAlign: "right" }}>${p.precioBase.toFixed(2)}</Text>
                  {/* ⚙ n = cuántos modificadores pregunta; tocar para cambiarlos. */}
                  <TouchableOpacity onPress={() => setEligiendoMods({ productoId: p.id, nombre: p.nombre })} style={estilos.botonModsFila} accessibilityLabel={`Modificadores de ${p.nombre}`}>
                    <Text style={{ color: (modsPorProducto.get(p.id)?.length ?? 0) > 0 ? colores.navyTexto : colores.textoSecundario, fontSize: 12, fontWeight: "700" }}>
                      ⚙ {modsPorProducto.get(p.id)?.length ?? 0}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => alternarDisponibilidad(p)} style={[estilos.pildoraEstado, p.activo ? estilos.pildoraEnVenta : estilos.pildoraStandby]}>
                    <Text style={{ color: p.activo ? colores.green : colores.amber, fontSize: 12, fontWeight: "700" }}>{p.activo ? "● En venta" : "⏸ Standby"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setProductoEditando(p.id); setProductoBorrador({ nombre: p.nombre, precio: String(p.precioBase), categoriaId: p.categoriaId }); }}>
                    <Text style={{ color: colores.navyTexto, fontSize: 12, marginLeft: 10 }}>Editar</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ))}
        </View>
      ))}
        </>
      )}

      {eligiendoMods && (
        <ModalModificadoresProducto
          titulo={`Modificadores · ${eligiendoMods.nombre}`}
          modificadores={modificadores}
          seleccionInicial={eligiendoMods.productoId === null ? modsNuevoProducto : modsPorProducto.get(eligiendoMods.productoId) ?? []}
          onCancelar={() => setEligiendoMods(null)}
          onGuardar={guardarModificadores}
          onCrearModificador={crearModificador}
          onEditarModificador={editarModificador}
        />
      )}
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
    chipCategoriaCatalogo: { borderWidth: 2, minHeight: 40, justifyContent: "center" },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    botonChico: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 4 },
    botonMods: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderColor: colores.borde, borderRadius: 8, marginBottom: 8 },
    botonModsFila: { marginLeft: 8, paddingHorizontal: 8, minHeight: 32, justifyContent: "center", borderRadius: 8, backgroundColor: colores.gray50 },
    etiquetaEdicion: { fontSize: 12, fontWeight: "700", color: colores.textoSecundario, marginBottom: 6 },
    notaAlta: { fontSize: 11, color: colores.textoSecundario, marginTop: 8, lineHeight: 15 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
    pildoraEstado: { marginLeft: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, minHeight: 32, justifyContent: "center" },
    pildoraEnVenta: { backgroundColor: colores.green + "1A" },
    pildoraStandby: { backgroundColor: colores.amber + "26" },
  });
}
