import { useEffect, useState } from "react";
import { FlatList, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { CategoriaProducto, Producto } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import * as outbox from "../db/outbox";
import { useAuthStore } from "../store/authStore";
import { useOrderStore } from "../store/orderStore";
import { usarColores } from "../store/temaStore";
import { columnasProductos, useDispositivo } from "../hooks/useDispositivo";

export function TomaPedidoScreen({ mesaNombre, onEnviado }: { mesaNombre: string | null; onEnviado: () => void }) {
  const { usuario, sucursalId } = useAuthStore();
  const { items, agregarItem, cambiarCantidad, quitarItem, totales, enviarACocina } = useOrderStore();
  const colores = usarColores();
  const { ancho, esTablet, horizontal } = useDispositivo();
  const columnas = columnasProductos(ancho);
  const estilos = crearEstilos(colores, esTablet, horizontal);
  const [categorias, setCategorias] = useState<CategoriaProducto[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [productoModal, setProductoModal] = useState<Producto | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!usuario || !sucursalId) return;
    (async () => {
      try {
        const [cats, prods] = await Promise.all([
          apiFetch<CategoriaProducto[]>(`/catalogo/categorias?empresaId=${usuario.empresaId}`),
          apiFetch<Producto[]>(`/catalogo/productos?empresaId=${usuario.empresaId}&sucursalId=${sucursalId}`),
        ]);
        setCategorias(cats);
        setProductos(prods);
        await outbox.guardarEnCache("categorias", cats);
        await outbox.guardarEnCache("productos", prods);
      } catch {
        setCategorias(await outbox.leerCache<CategoriaProducto>("categorias"));
        setProductos(await outbox.leerCache<Producto>("productos"));
      }
    })();
  }, [usuario, sucursalId]);

  const filtrados = productos.filter((p) => {
    const porCategoria = !categoriaActiva || p.categoriaId === categoriaActiva;
    const porBusqueda = !busqueda.trim() || p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase());
    return porCategoria && porBusqueda;
  });
  const t = totales();

  async function manejarEnviar() {
    setAviso(null);
    setEnviando(true);
    try {
      await enviarACocina();
      setAviso("Pedido enviado ✔");
      setTimeout(onEnviado, 600);
    } catch (e: any) {
      setAviso(e.message);
    } finally {
      setEnviando(false);
    }
  }

  const listaProductos = (
    <FlatList
      key={`grid-${columnas}`}
      style={estilos.listaProductos}
      data={filtrados}
      keyExtractor={(p) => p.id}
      numColumns={columnas}
      columnWrapperStyle={estilos.filaProductos}
      contentContainerStyle={{ padding: 12 }}
      ListEmptyComponent={
        <Text style={estilos.sinResultados}>
          {busqueda ? `Sin resultados para "${busqueda}".` : "No hay productos en esta categoría."}
        </Text>
      }
      renderItem={({ item }) => {
        const disponible = item.disponibleSucursal !== false;
        return (
          <TouchableOpacity
            style={[estilos.producto, !disponible && estilos.productoAgotado]}
            disabled={!disponible}
            onPress={() => {
              if ((item.modificadores?.length ?? 0) > 0) setProductoModal(item);
              else agregarItem({ productoId: item.id, nombreProducto: item.nombre, cantidad: 1, precioUnitario: item.precioSucursal ?? item.precioBase, modificadores: [] });
            }}
          >
            <View style={estilos.productoFoto}>
              {item.imagenUrl ? (
                <Image source={{ uri: item.imagenUrl }} style={estilos.productoImagen} resizeMode="cover" />
              ) : (
                <Text style={estilos.productoFotoPlaceholder}>☕</Text>
              )}
              {!disponible && (
                <View style={estilos.badgeAgotado}>
                  <Text style={estilos.badgeAgotadoTexto}>AGOTADO</Text>
                </View>
              )}
            </View>
            <View style={estilos.productoInfo}>
              <Text style={estilos.productoNombre} numberOfLines={2}>{item.nombre}</Text>
              <Text style={estilos.productoPrecio}>${(item.precioSucursal ?? item.precioBase).toFixed(2)}</Text>
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );

  const panelResumen = (
    <View style={estilos.resumen}>
      <ScrollView style={estilos.resumenLista}>
        {items.map((i) => (
          <View key={i.id} style={estilos.filaItem}>
            <Text style={{ flex: 1, color: colores.texto }}>{i.cantidad}x {i.nombreProducto}</Text>
            <TouchableOpacity onPress={() => cambiarCantidad(i.id, -1)}><Text style={estilos.controlCantidad}>−</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => cambiarCantidad(i.id, 1)}><Text style={estilos.controlCantidad}>+</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => quitarItem(i.id)}><Text style={[estilos.controlCantidad, { color: colores.red }]}>🗑</Text></TouchableOpacity>
          </View>
        ))}
      </ScrollView>
      <Text style={estilos.total}>Total: ${t.total.toFixed(2)} ({items.length} items)</Text>
      {aviso && <Text style={{ color: colores.navyTexto, marginBottom: 4 }}>{aviso}</Text>}
      <TouchableOpacity style={estilos.botonEnviar} onPress={manejarEnviar} disabled={items.length === 0 || enviando}>
        <Text style={estilos.botonEnviarTexto}>📨 {enviando ? "Enviando…" : "Enviar pedido"}</Text>
      </TouchableOpacity>
    </View>
  );

  const categoriasYBuscador = (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={estilos.tabsCategoria} contentContainerStyle={estilos.tabsCategoriaContenido}>
        <TouchableOpacity onPress={() => setCategoriaActiva(null)} style={[estilos.tab, !categoriaActiva ? estilos.tabActivo : estilos.tabInactivo]}>
          <Text style={[estilos.tabTexto, !categoriaActiva && estilos.tabTextoActivo]}>Todas</Text>
        </TouchableOpacity>
        {categorias.map((c) => (
          <TouchableOpacity key={c.id} onPress={() => setCategoriaActiva(c.id)} style={[estilos.tab, categoriaActiva === c.id ? estilos.tabActivo : estilos.tabInactivo]}>
            <Text style={[estilos.tabTexto, categoriaActiva === c.id && estilos.tabTextoActivo]}>{c.nombre}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={estilos.buscadorContenedor}>
        <TextInput
          placeholder="🔍 Buscar producto…"
          placeholderTextColor={colores.textoSecundario}
          value={busqueda}
          onChangeText={setBusqueda}
          autoCorrect={false}
          style={estilos.buscadorInput}
        />
      </View>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <Text style={estilos.encabezado}>{mesaNombre ? `Mesa ${mesaNombre}` : "Pedido de mostrador"}</Text>

      {/* En horizontal (tablet apaisada) el resumen pasa a un panel FIJO a la derecha en vez de
          apilarse debajo de todo — apilado, la suma de encabezado+categorías+buscador+resumen
          (todos con altura fija) dejaba CERO espacio para la grilla de productos (flex:1): con
          la pantalla mucho más baja en horizontal, la grilla simplemente desaparecía. Con un
          panel lateral, la grilla tiene TODA la altura disponible para sí misma. */}
      {horizontal ? (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ flex: 1 }}>
            {categoriasYBuscador}
            {listaProductos}
          </View>
          {panelResumen}
        </View>
      ) : (
        <>
          {categoriasYBuscador}
          {listaProductos}
          {panelResumen}
        </>
      )}

      <Modal visible={!!productoModal} transparent animationType="fade">
        {productoModal && (
          <ModalModificadores
            producto={productoModal}
            onCancelar={() => setProductoModal(null)}
            onConfirmar={(seleccion, notas) => {
              agregarItem({ productoId: productoModal.id, nombreProducto: productoModal.nombre, cantidad: 1, precioUnitario: productoModal.precioSucursal ?? productoModal.precioBase, modificadores: seleccion, notas });
              setProductoModal(null);
            }}
          />
        )}
      </Modal>
    </View>
  );
}

function ModalModificadores({
  producto,
  onCancelar,
  onConfirmar,
}: {
  producto: Producto;
  onCancelar: () => void;
  onConfirmar: (seleccion: { opcionModificadorId: string; nombreOpcion: string; precioExtra: number }[], notas: string) => void;
}) {
  const colores = usarColores();
  const { esTablet, horizontal } = useDispositivo();
  const estilos = crearEstilos(colores, esTablet, horizontal);
  const [seleccion, setSeleccion] = useState<Record<string, { opcionModificadorId: string; nombreOpcion: string; precioExtra: number }>>({});
  const [notas, setNotas] = useState("");

  return (
    <View style={estilos.overlay}>
      <View style={estilos.modal}>
        <Text style={estilos.modalTitulo}>{producto.nombre}</Text>
        <ScrollView style={{ maxHeight: 300 }}>
          {(producto.modificadores ?? []).map((mod) => (
            <View key={mod.id} style={{ marginTop: 12 }}>
              <Text style={{ fontWeight: "700", color: colores.texto }}>{mod.nombre}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {mod.opciones.map((op) => {
                  const activa = seleccion[mod.id]?.opcionModificadorId === op.id;
                  return (
                    <TouchableOpacity
                      key={op.id}
                      onPress={() => setSeleccion((s) => ({ ...s, [mod.id]: { opcionModificadorId: op.id, nombreOpcion: op.nombre, precioExtra: op.precioExtra } }))}
                      style={[estilos.opcion, activa && estilos.opcionActiva]}
                    >
                      <Text style={{ color: activa ? "#fff" : colores.texto }}>{op.nombre}{op.precioExtra > 0 ? ` +$${op.precioExtra}` : ""}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
        <TextInput
          placeholder="Nota (opcional)"
          placeholderTextColor={colores.textoSecundario}
          value={notas}
          onChangeText={setNotas}
          style={estilos.notaInput}
        />
        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          <TouchableOpacity onPress={onCancelar} style={[estilos.botonModal, { backgroundColor: colores.gray200 }]}>
            <Text style={{ color: colores.texto }}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onConfirmar(Object.values(seleccion), notas)} style={[estilos.botonModal, { backgroundColor: colores.green }]}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Agregar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>, esTablet: boolean, horizontal: boolean) {
  const escala = esTablet ? 1.15 : 1;
  return StyleSheet.create({
    // flexShrink: 0 en encabezado/categorías/buscador — en horizontal (landscape) la tablet
    // tiene mucha menos altura disponible; sin esto, Yoga podía encoger la fila de categorías
    // hasta 0px para hacerle espacio al resto (el buscador terminaba pintado donde deberían
    // estar las categorías). Con height fijo (no maxHeight) + flexShrink:0 esa fila SIEMPRE
    // reserva su espacio real, y la lista de productos (flex:1 más abajo) es la única que cede.
    encabezado: { fontSize: 18 * escala, fontWeight: "800", padding: 12, color: colores.texto, flexShrink: 0 },
    // height + maxHeight (no solo height) + flexGrow:0 explícito — sin esto, la fila de
    // categorías medía ~575px en vez de 50 en un dispositivo real: al no fijar `alignItems` en
    // el contentContainerStyle, el default de flexbox ("stretch") hacía que cada pestaña se
    // estirara para llenar la altura del CONTENIDO scrolleable, y esa altura terminaba
    // determinada por el contenido en vez de por el contenedor — un clásico de ScrollView
    // horizontal en RN. El fix real está en `tabsCategoriaContenido.alignItems: "center"`.
    tabsCategoria: { height: 50 * escala, maxHeight: 50 * escala, flexShrink: 0, flexGrow: 0 },
    tabsCategoriaContenido: { paddingHorizontal: 10, alignItems: "center" },
    tab: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colores.gray50, borderRadius: 10, marginRight: 8, height: 36 * escala, justifyContent: "center" },
    // El fondo "gray50" de una pestaña inactiva es casi idéntico al fondo de la pantalla en modo
    // oscuro (ambos son variaciones muy oscuras) — sin un borde, la pestaña se veía invisible,
    // solo el texto flotando sin ninguna píldora alrededor.
    tabInactivo: { borderWidth: 1, borderColor: colores.borde },
    tabActivo: { backgroundColor: colores.navy },
    tabTexto: { color: colores.texto, fontSize: 14 * escala },
    tabTextoActivo: { color: "#fff" },
    buscadorContenedor: { paddingHorizontal: 12, paddingBottom: 10, flexShrink: 0 },
    listaProductos: { flex: 1 },
    buscadorInput: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 12, fontSize: 15 * escala, backgroundColor: colores.superficie, color: colores.texto },
    filaProductos: { gap: 10 },
    sinResultados: { textAlign: "center", color: colores.textoSecundario, marginTop: 30, fontSize: 13 },
    producto: {
      flex: 1, backgroundColor: colores.superficie, borderRadius: 12, marginBottom: 10, overflow: "hidden",
      borderWidth: 1, borderColor: colores.borde,
    },
    productoAgotado: { opacity: 0.55 },
    productoFoto: {
      height: 90 * escala, backgroundColor: colores.gray50, alignItems: "center", justifyContent: "center", position: "relative",
    },
    productoImagen: { width: "100%", height: "100%" },
    productoFotoPlaceholder: { fontSize: 30 },
    badgeAgotado: { position: "absolute", top: 6, right: 6, backgroundColor: colores.red, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    badgeAgotadoTexto: { color: "#fff", fontSize: 9, fontWeight: "800" },
    productoInfo: { padding: 10 },
    productoNombre: { fontSize: 13 * escala, fontWeight: "700", color: colores.texto, minHeight: 34 },
    productoPrecio: { fontWeight: "800", color: colores.navyTexto, marginTop: 4, fontSize: 15 * escala },
    // En horizontal es un panel lateral (ancho fijo, alto completo, borde a la izquierda en vez
    // de arriba); en vertical se apila abajo (ancho completo, alto fijo, borde arriba) — mismo
    // patrón que "panel de pedido" a la derecha en el POS de escritorio (ver POSHome.tsx).
    resumen: horizontal
      ? { backgroundColor: colores.superficie, padding: 12, borderLeftWidth: 1, borderLeftColor: colores.borde, width: esTablet ? 320 : 260 }
      : { backgroundColor: colores.superficie, padding: 12, borderTopWidth: 1, borderTopColor: colores.borde, flexShrink: 0 },
    resumenLista: horizontal ? { flex: 1 } : { maxHeight: 120 },
    filaItem: { flexDirection: "row", alignItems: "center", paddingVertical: 4, gap: 10 },
    controlCantidad: { fontSize: 18, paddingHorizontal: 8, color: colores.texto },
    total: { fontSize: 16 * escala, fontWeight: "800", marginTop: 6, color: colores.navyTexto },
    botonEnviar: { backgroundColor: colores.blue, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8, minHeight: 56, justifyContent: "center" },
    botonEnviarTexto: { color: "#fff", fontWeight: "700", fontSize: 16 * escala },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
    modal: { backgroundColor: colores.superficie, borderRadius: 16, padding: 20, width: "88%" },
    modalTitulo: { fontSize: 18, fontWeight: "800", color: colores.texto },
    opcion: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    opcionActiva: { backgroundColor: colores.navy },
    notaInput: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginTop: 12, color: colores.texto },
    botonModal: { flex: 1, padding: 14, borderRadius: 10, alignItems: "center" },
  });
}
