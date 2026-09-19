import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useCarritoStore } from "../store/carritoStore";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { coincideBusqueda } from "../db/busqueda";
import { listarCategorias, listarProductos, modificadoresDeProducto, type CategoriaLocal, type ModificadorLocal, type ProductoLocal } from "../db/catalogoRepo";
import { ModalModificadores } from "../components/ModalModificadores";

/** Catálogo + carrito — lee/escribe SQLite local, nunca la red. El catálogo de HANGAR 421 se
 *  siembra en la base local en el primer arranque (ver db/catalogoHangar.ts), así que la
 *  pantalla tiene los mismos productos que el POS de Windows sin depender de ninguna conexión;
 *  se puede editar desde Admin → Catálogo, y si se enlaza el ERP el catálogo real lo reemplaza
 *  (ver catalogoSyncRepo.upsertCatalogo). */
export function PosVentaScreen({ onCobrar }: { onCobrar: () => void }) {
  const { items, agregarItem, quitarItem, cambiarCantidad, totales } = useCarritoStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [categorias, setCategorias] = useState<CategoriaLocal[]>([]);
  const [productos, setProductos] = useState<ProductoLocal[]>([]);
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [personalizando, setPersonalizando] = useState<{ producto: ProductoLocal; modificadores: ModificadorLocal[] } | null>(null);

  /** Un producto compuesto (café, combo) abre el modal; el resto entra directo al carrito, que
   *  es lo que mantiene ágil el cobro en barra. Si el producto dice que se personaliza pero no
   *  tiene modificadores cargados (catálogo a medio sincronizar), se agrega directo en vez de
   *  abrir un modal vacío que bloquearía la venta. */
  async function tocarProducto(producto: ProductoLocal) {
    if (producto.requierePersonalizacion) {
      const db = await abrirBaseDeDatos();
      const modificadores = await modificadoresDeProducto(db, producto.id);
      if (modificadores.length > 0) {
        setPersonalizando({ producto, modificadores });
        return;
      }
    }
    agregarItem({
      productoId: producto.id,
      nombreProducto: producto.nombre,
      cantidad: 1,
      precioUnitario: producto.precioBase,
      modificadores: [],
    });
  }

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const [cats, prods] = await Promise.all([listarCategorias(db), listarProductos(db)]);
    setCategorias(cats);
    setProductos(prods);
  }

  useEffect(() => {
    cargar();
  }, []);

  const t = totales();
  const buscando = busqueda.trim().length > 0;
  const nombrePorCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.nombre])), [categorias]);

  // Al buscar se ignora la categoría activa y se recorre TODO el catálogo — mismo criterio que
  // el autocompletado del POS de Windows: el cajero debe encontrar un producto aunque esté
  // parado en otra pestaña. La subcategoría entra en la búsqueda para que "galletas" liste las
  // tres de Domingo.
  const productosVisibles = useMemo(() => {
    const ordenCategoria = new Map(categorias.map((c) => [c.id, c.orden]));
    const filtrados = productos.filter((p) =>
      buscando
        ? coincideBusqueda(`${p.nombre} ${p.subcategoria ?? ""}`, busqueda)
        : !categoriaActiva || p.categoriaId === categoriaActiva,
    );
    return filtrados.sort(
      (a, b) =>
        (ordenCategoria.get(a.categoriaId) ?? 99) - (ordenCategoria.get(b.categoriaId) ?? 99) ||
        a.orden - b.orden ||
        a.nombre.localeCompare(b.nombre),
    );
  }, [productos, categorias, categoriaActiva, busqueda, buscando]);

  /** El catálogo real repite nombres con precios distintos ("Latte" frío 85 / caliente 70,
   *  "Pistache" galleta 80 / rol 155). Mientras se ve una sola categoría el nombre basta; en
   *  "Todas" y en los resultados de búsqueda hace falta el contexto o no se distinguen. */
  function etiquetaContexto(p: ProductoLocal): string | null {
    if (p.subcategoria) return p.subcategoria;
    if (buscando || !categoriaActiva) return nombrePorCategoria.get(p.categoriaId) ?? null;
    return null;
  }

  const sinCatalogo = categorias.length === 0 && productos.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      {!sinCatalogo && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={estilos.tabsCategoria} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
            <TouchableOpacity onPress={() => setCategoriaActiva(null)} style={[estilos.chip, !categoriaActiva && estilos.chipActivo]}>
              <Text style={{ color: !categoriaActiva ? "#fff" : colores.texto, fontWeight: "700" }}>Todas</Text>
            </TouchableOpacity>
            {categorias.map((c) => (
              <TouchableOpacity key={c.id} onPress={() => setCategoriaActiva(c.id)} style={[estilos.chip, categoriaActiva === c.id && estilos.chipActivo]}>
                <Text style={{ color: categoriaActiva === c.id ? "#fff" : colores.texto, fontWeight: "700" }}>{c.nombre}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={estilos.barraBusqueda}>
            <Text style={estilos.lupa}>🔍</Text>
            <TextInput
              placeholder="Buscar producto…"
              placeholderTextColor={colores.textoSecundario}
              value={busqueda}
              onChangeText={setBusqueda}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={estilos.inputBusqueda}
              accessibilityLabel="Buscar producto"
            />
            {buscando && (
              <TouchableOpacity onPress={() => setBusqueda("")} style={estilos.botonLimpiar} accessibilityLabel="Limpiar búsqueda">
                <Text style={estilos.botonLimpiarTexto}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
        {sinCatalogo ? (
          <Text style={estilos.ayuda}>Todavía no hay catálogo — da de alta tus productos desde Admin → Catálogo, o conecta con el ERP para traerlo.</Text>
        ) : (
          <>
            {buscando && (
              <Text style={estilos.resumenBusqueda}>
                {productosVisibles.length === 0
                  ? `Sin resultados para "${busqueda.trim()}"`
                  : `${productosVisibles.length} resultado${productosVisibles.length === 1 ? "" : "s"} en todo el catálogo`}
              </Text>
            )}
            <View style={estilos.grillaProductos}>
              {productosVisibles.map((p) => {
                const contexto = etiquetaContexto(p);
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={estilos.tarjetaProducto}
                    onPress={() => tocarProducto(p)}
                  >
                    <Text style={estilos.nombreProducto} numberOfLines={2}>{p.nombre}</Text>
                    {contexto && <Text style={estilos.contextoProducto} numberOfLines={1}>{contexto}</Text>}
                    <Text style={estilos.precioProducto}>
                      ${p.precioBase.toFixed(2)}
                      {/* Avisa de que el precio puede subir con lo que se elija en el modal. */}
                      {p.requierePersonalizacion ? <Text style={estilos.marcaPersonaliza}>  ⚙</Text> : null}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {productosVisibles.length === 0 && !buscando && <Text style={estilos.ayuda}>Sin productos en esta categoría.</Text>}
          </>
        )}
      </ScrollView>

      <View style={estilos.carrito}>
        <ScrollView style={{ maxHeight: 160 }}>
          {items.map((item) => (
            <View key={item.id} style={estilos.filaItem}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colores.texto }} numberOfLines={1}>{item.nombreProducto}</Text>
                {/* Lo elegido en el modal, bajo el nombre: dos "Latte" con leches distintas
                    tienen que distinguirse en el carrito antes de cobrar. */}
                {item.modificadores.length > 0 && (
                  <Text style={estilos.modificadoresItem} numberOfLines={2}>
                    {item.modificadores.map((m) => m.nombreOpcion).join(" · ")}
                  </Text>
                )}
                {item.notas ? <Text style={estilos.modificadoresItem} numberOfLines={1}>✎ {item.notas}</Text> : null}
              </View>
              <View style={estilos.controlesCantidad}>
                <TouchableOpacity onPress={() => cambiarCantidad(item.id, -1)} style={estilos.botonCantidad}><Text style={estilos.botonCantidadTexto}>−</Text></TouchableOpacity>
                <Text style={{ color: colores.texto, width: 24, textAlign: "center" }}>{item.cantidad}</Text>
                <TouchableOpacity onPress={() => cambiarCantidad(item.id, 1)} style={estilos.botonCantidad}><Text style={estilos.botonCantidadTexto}>+</Text></TouchableOpacity>
              </View>
              {/* Incluye los extras: si no, la suma de las líneas no cuadraría con el total. */}
              <Text style={{ color: colores.texto, width: 70, textAlign: "right" }}>
                ${((item.precioUnitario + item.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * item.cantidad).toFixed(2)}
              </Text>
              <TouchableOpacity onPress={() => quitarItem(item.id)}><Text style={{ color: colores.red, marginLeft: 8 }}>🗑</Text></TouchableOpacity>
            </View>
          ))}
          {items.length === 0 && <Text style={estilos.ayuda}>Carrito vacío — toca un producto para agregarlo.</Text>}
        </ScrollView>

        <View style={estilos.filaTotal}>
          <Text style={estilos.totalTexto}>Total</Text>
          <Text style={estilos.totalTexto}>${t.total.toFixed(2)}</Text>
        </View>

        <TouchableOpacity onPress={onCobrar} disabled={items.length === 0} style={[estilos.botonCobrar, items.length === 0 && { opacity: 0.5 }]}>
          <Text style={estilos.botonCobrarTexto}>Cobrar ${t.total.toFixed(2)}</Text>
        </TouchableOpacity>
      </View>

      {personalizando && (
        <ModalModificadores
          producto={personalizando.producto}
          modificadores={personalizando.modificadores}
          onCancelar={() => setPersonalizando(null)}
          onConfirmar={(cantidad, seleccion, notas) => {
            agregarItem({
              productoId: personalizando.producto.id,
              nombreProducto: personalizando.producto.nombre,
              cantidad,
              precioUnitario: personalizando.producto.precioBase,
              notas: notas || undefined,
              modificadores: seleccion,
            });
            setPersonalizando(null);
          }}
        />
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    tabsCategoria: { flexGrow: 0, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde, backgroundColor: colores.superficie },
    chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colores.gray50 },
    chipActivo: { backgroundColor: colores.navy },
    barraBusqueda: {
      flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: colores.superficie, borderBottomWidth: 1, borderBottomColor: colores.borde,
    },
    lupa: { fontSize: 15 },
    // minHeight 44: mismo piso táctil que el resto de controles de la app (ver botones de la
    // barra inferior) — se teclea con el dedo, muchas veces con guantes de barra.
    inputBusqueda: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, color: colores.texto },
    botonLimpiar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colores.gray50, alignItems: "center", justifyContent: "center" },
    botonLimpiarTexto: { color: colores.textoSecundario, fontSize: 15, fontWeight: "700" },
    resumenBusqueda: { color: colores.textoSecundario, fontSize: 12, paddingHorizontal: 4, paddingBottom: 10 },
    grillaProductos: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tarjetaProducto: { width: "47%", backgroundColor: colores.superficie, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colores.borde },
    nombreProducto: { fontSize: 14, fontWeight: "700", color: colores.texto },
    contextoProducto: { fontSize: 11, color: colores.textoSecundario, marginTop: 2 },
    precioProducto: { fontSize: 15, fontWeight: "800", color: colores.navyTexto, marginTop: 6 },
    marcaPersonaliza: { fontSize: 11, color: colores.textoSecundario, fontWeight: "600" },
    modificadoresItem: { fontSize: 11, color: colores.textoSecundario, marginTop: 1 },
    ayuda: { color: colores.textoSecundario, fontSize: 13, padding: 8 },
    carrito: { backgroundColor: colores.superficie, borderTopWidth: 1, borderTopColor: colores.borde, padding: 12 },
    filaItem: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colores.borde },
    controlesCantidad: { flexDirection: "row", alignItems: "center", gap: 4, marginHorizontal: 8 },
    botonCantidad: { width: 26, height: 26, borderRadius: 6, backgroundColor: colores.gray50, alignItems: "center", justifyContent: "center" },
    botonCantidadTexto: { fontSize: 16, fontWeight: "700", color: colores.texto },
    filaTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
    totalTexto: { fontSize: 18, fontWeight: "800", color: colores.navyTexto },
    botonCobrar: { backgroundColor: colores.green, borderRadius: 12, padding: 16, alignItems: "center", minHeight: 52, justifyContent: "center" },
    botonCobrarTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
  });
}
