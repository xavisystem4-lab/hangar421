import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useCarritoStore } from "../store/carritoStore";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { sembrarCatalogoDemo } from "../db/catalogoSeed";
import { listarCategorias, listarProductos, type CategoriaLocal, type ProductoLocal } from "../db/catalogoRepo";

/** Catálogo + carrito — lee/escribe SQLite local, nunca la red (ver catalogoSeed.ts: en Fase 1
 *  el catálogo es de ejemplo; Fase 2a lo reemplaza por lo que traiga /sync/pull real). */
export function PosVentaScreen({ onCobrar }: { onCobrar: () => void }) {
  const { items, agregarItem, quitarItem, cambiarCantidad, totales } = useCarritoStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [categorias, setCategorias] = useState<CategoriaLocal[]>([]);
  const [productos, setProductos] = useState<ProductoLocal[]>([]);
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const db = await abrirBaseDeDatos();
      await sembrarCatalogoDemo(db);
      const [cats, prods] = await Promise.all([listarCategorias(db), listarProductos(db)]);
      setCategorias(cats);
      setProductos(prods);
      if (cats[0]) setCategoriaActiva(cats[0].id);
    })();
  }, []);

  const t = totales();
  const productosVisibles = categoriaActiva ? productos.filter((p) => p.categoriaId === categoriaActiva) : productos;

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={estilos.tabsCategoria} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
        {categorias.map((c) => (
          <TouchableOpacity key={c.id} onPress={() => setCategoriaActiva(c.id)} style={[estilos.chip, categoriaActiva === c.id && estilos.chipActivo]}>
            <Text style={{ color: categoriaActiva === c.id ? "#fff" : colores.texto, fontWeight: "700" }}>{c.nombre}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        <View style={estilos.grillaProductos}>
          {productosVisibles.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={estilos.tarjetaProducto}
              onPress={() => agregarItem({ productoId: p.id, nombreProducto: p.nombre, cantidad: 1, precioUnitario: p.precioBase })}
            >
              <Text style={estilos.nombreProducto} numberOfLines={2}>{p.nombre}</Text>
              <Text style={estilos.precioProducto}>${p.precioBase.toFixed(2)}</Text>
            </TouchableOpacity>
          ))}
          {productosVisibles.length === 0 && <Text style={estilos.ayuda}>Sin productos en esta categoría.</Text>}
        </View>
      </ScrollView>

      <View style={estilos.carrito}>
        <ScrollView style={{ maxHeight: 160 }}>
          {items.map((item) => (
            <View key={item.id} style={estilos.filaItem}>
              <Text style={{ color: colores.texto, flex: 1 }} numberOfLines={1}>{item.nombreProducto}</Text>
              <View style={estilos.controlesCantidad}>
                <TouchableOpacity onPress={() => cambiarCantidad(item.id, -1)} style={estilos.botonCantidad}><Text style={estilos.botonCantidadTexto}>−</Text></TouchableOpacity>
                <Text style={{ color: colores.texto, width: 24, textAlign: "center" }}>{item.cantidad}</Text>
                <TouchableOpacity onPress={() => cambiarCantidad(item.id, 1)} style={estilos.botonCantidad}><Text style={estilos.botonCantidadTexto}>+</Text></TouchableOpacity>
              </View>
              <Text style={{ color: colores.texto, width: 70, textAlign: "right" }}>${(item.precioUnitario * item.cantidad).toFixed(2)}</Text>
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
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    tabsCategoria: { flexGrow: 0, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde, backgroundColor: colores.superficie },
    chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colores.gray50 },
    chipActivo: { backgroundColor: colores.navy },
    grillaProductos: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tarjetaProducto: { width: "47%", backgroundColor: colores.superficie, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colores.borde },
    nombreProducto: { fontSize: 14, fontWeight: "700", color: colores.texto },
    precioProducto: { fontSize: 15, fontWeight: "800", color: colores.navyTexto, marginTop: 6 },
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
