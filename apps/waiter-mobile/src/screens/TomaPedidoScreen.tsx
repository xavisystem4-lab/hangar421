import { useEffect, useState } from "react";
import { FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { CategoriaProducto, Producto } from "@hangar421/shared";
import { apiFetch } from "../api/http";
import * as outbox from "../db/outbox";
import { useAuthStore } from "../store/authStore";
import { useOrderStore } from "../store/orderStore";
import { colores } from "../theme";

export function TomaPedidoScreen({ mesaNombre, onEnviado }: { mesaNombre: string | null; onEnviado: () => void }) {
  const { usuario, sucursalId } = useAuthStore();
  const { items, agregarItem, cambiarCantidad, quitarItem, totales, enviarACocina } = useOrderStore();
  const [categorias, setCategorias] = useState<CategoriaProducto[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);
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

  const filtrados = productos.filter((p) => !categoriaActiva || p.categoriaId === categoriaActiva);
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

  return (
    <View style={{ flex: 1 }}>
      <Text style={estilos.encabezado}>{mesaNombre ? `Mesa ${mesaNombre}` : "Pedido de mostrador"}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={estilos.tabsCategoria} contentContainerStyle={{ paddingHorizontal: 10 }}>
        <TouchableOpacity onPress={() => setCategoriaActiva(null)} style={[estilos.tab, !categoriaActiva && estilos.tabActivo]}>
          <Text style={[estilos.tabTexto, !categoriaActiva && estilos.tabTextoActivo]}>Todas</Text>
        </TouchableOpacity>
        {categorias.map((c) => (
          <TouchableOpacity key={c.id} onPress={() => setCategoriaActiva(c.id)} style={[estilos.tab, categoriaActiva === c.id && estilos.tabActivo]}>
            <Text style={[estilos.tabTexto, categoriaActiva === c.id && estilos.tabTextoActivo]}>{c.nombre}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filtrados}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={estilos.producto}
            onPress={() => {
              if ((item.modificadores?.length ?? 0) > 0) setProductoModal(item);
              else agregarItem({ productoId: item.id, nombreProducto: item.nombre, cantidad: 1, precioUnitario: item.precioSucursal ?? item.precioBase, modificadores: [] });
            }}
          >
            <Text style={estilos.productoNombre}>{item.nombre}</Text>
            <Text style={estilos.productoPrecio}>${(item.precioSucursal ?? item.precioBase).toFixed(2)}</Text>
          </TouchableOpacity>
        )}
      />

      <View style={estilos.resumen}>
        <ScrollView style={{ maxHeight: 120 }}>
          {items.map((i) => (
            <View key={i.id} style={estilos.filaItem}>
              <Text style={{ flex: 1 }}>{i.cantidad}x {i.nombreProducto}</Text>
              <TouchableOpacity onPress={() => cambiarCantidad(i.id, -1)}><Text style={estilos.controlCantidad}>−</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => cambiarCantidad(i.id, 1)}><Text style={estilos.controlCantidad}>+</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => quitarItem(i.id)}><Text style={[estilos.controlCantidad, { color: colores.red }]}>🗑</Text></TouchableOpacity>
            </View>
          ))}
        </ScrollView>
        <Text style={estilos.total}>Total: ${t.total.toFixed(2)} ({items.length} items)</Text>
        {aviso && <Text style={{ color: colores.navy, marginBottom: 4 }}>{aviso}</Text>}
        <TouchableOpacity style={estilos.botonEnviar} onPress={manejarEnviar} disabled={items.length === 0 || enviando}>
          <Text style={estilos.botonEnviarTexto}>📨 {enviando ? "Enviando…" : "Enviar a cocina"}</Text>
        </TouchableOpacity>
      </View>

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
  const [seleccion, setSeleccion] = useState<Record<string, { opcionModificadorId: string; nombreOpcion: string; precioExtra: number }>>({});
  const [notas, setNotas] = useState("");

  return (
    <View style={estilos.overlay}>
      <View style={estilos.modal}>
        <Text style={estilos.modalTitulo}>{producto.nombre}</Text>
        <ScrollView style={{ maxHeight: 300 }}>
          {(producto.modificadores ?? []).map((mod) => (
            <View key={mod.id} style={{ marginTop: 12 }}>
              <Text style={{ fontWeight: "700" }}>{mod.nombre}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {mod.opciones.map((op) => {
                  const activa = seleccion[mod.id]?.opcionModificadorId === op.id;
                  return (
                    <TouchableOpacity
                      key={op.id}
                      onPress={() => setSeleccion((s) => ({ ...s, [mod.id]: { opcionModificadorId: op.id, nombreOpcion: op.nombre, precioExtra: op.precioExtra } }))}
                      style={[estilos.opcion, activa && estilos.opcionActiva]}
                    >
                      <Text style={{ color: activa ? "#fff" : "#000" }}>{op.nombre}{op.precioExtra > 0 ? ` +$${op.precioExtra}` : ""}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
        <TextInput placeholder="Nota (opcional)" value={notas} onChangeText={setNotas} style={estilos.notaInput} />
        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          <TouchableOpacity onPress={onCancelar} style={[estilos.botonModal, { backgroundColor: colores.gray200 }]}>
            <Text>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onConfirmar(Object.values(seleccion), notas)} style={[estilos.botonModal, { backgroundColor: colores.green }]}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Agregar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  encabezado: { fontSize: 18, fontWeight: "800", padding: 12 },
  tabsCategoria: { maxHeight: 50 },
  tab: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colores.gray50, borderRadius: 10, marginRight: 8, justifyContent: "center" },
  tabActivo: { backgroundColor: colores.navy },
  tabTexto: { color: "#000" },
  tabTextoActivo: { color: "#fff" },
  producto: { backgroundColor: "#fff", padding: 16, borderRadius: 12, marginBottom: 8, flexDirection: "row", justifyContent: "space-between", borderWidth: 1, borderColor: colores.gray200 },
  productoNombre: { fontSize: 15, fontWeight: "600" },
  productoPrecio: { fontWeight: "700", color: colores.navy },
  resumen: { backgroundColor: "#fff", padding: 12, borderTopWidth: 1, borderTopColor: colores.gray200 },
  filaItem: { flexDirection: "row", alignItems: "center", paddingVertical: 4, gap: 10 },
  controlCantidad: { fontSize: 18, paddingHorizontal: 8 },
  total: { fontSize: 16, fontWeight: "800", marginTop: 6, color: colores.navy },
  botonEnviar: { backgroundColor: colores.blue, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8, minHeight: 56, justifyContent: "center" },
  botonEnviarTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  modal: { backgroundColor: "#fff", borderRadius: 16, padding: 20, width: "88%" },
  modalTitulo: { fontSize: 18, fontWeight: "800" },
  opcion: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.gray200 },
  opcionActiva: { backgroundColor: colores.navy },
  notaInput: { borderWidth: 1, borderColor: colores.gray200, borderRadius: 8, padding: 10, marginTop: 12 },
  botonModal: { flex: 1, padding: 14, borderRadius: 10, alignItems: "center" },
});
