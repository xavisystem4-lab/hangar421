import { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { listarCategorias, listarProductos } from "../db/catalogoRepo";
import { coincideBusqueda } from "../db/busqueda";
import {
  emparejarConCatalogo, extraerLineasProducto, pedidoListoParaConfirmar, totalItems,
  type ItemPedidoDidi, type ProductoCatalogo,
} from "../plataformas/productosDidi";
import type { PedidoDetectado } from "../plataformas/useNotificacionesDidi";

/**
 * Lo que llegó de la app de DiDi, para revisarlo y confirmarlo.
 *
 * Se leen de la notificación el número, el cliente, el total y —cuando DiDi los manda— los
 * productos, emparejados con el menú (grupo DIDI primero). Lo que no se reconoce queda marcado
 * para elegirlo a mano, y siempre se pueden agregar, quitar o cambiar cantidades. Al confirmar,
 * el pedido pasa a la lista "DiDi en preparación" hasta que llegue el repartidor.
 */
export function ModalPedidoDidi({ pedido, onConfirmar, onCapturarAMano, onDescartar, onCerrar }: {
  pedido: PedidoDetectado;
  onConfirmar: (items: ItemPedidoDidi[]) => void;
  /** Como antes: abre Venta con el grupo DIDI y el nombre puesto. */
  onCapturarAMano: () => void;
  /** No era un pedido (o ya se atendió): sale de la bandeja. */
  onDescartar: () => void;
  onCerrar: () => void;
}) {
  const colores = usarColores();
  const e = crearEstilos(colores);
  const [catalogo, setCatalogo] = useState<ProductoCatalogo[]>([]);
  const [items, setItems] = useState<ItemPedidoDidi[]>([]);
  const [eligiendo, setEligiendo] = useState<number | "nuevo" | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [verOriginal, setVerOriginal] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await abrirBaseDeDatos();
      const [cats, prods] = await Promise.all([listarCategorias(db), listarProductos(db)]);
      const nombreCat = new Map(cats.map((c) => [c.id, c.nombre]));
      const lista = prods.map((p) => ({
        id: p.id, nombre: p.nombre, subcategoria: p.subcategoria, categoria: nombreCat.get(p.categoriaId) ?? null, precio: p.precioBase,
      }));
      setCatalogo(lista);
      setItems(emparejarConCatalogo(extraerLineasProducto(`${pedido.titulo}\n${pedido.texto}`), lista));
    })().catch(() => undefined);
  }, [pedido]);

  // Para elegir: primero los del grupo DIDI (precios de la plataforma).
  const opciones = useMemo(() => {
    const filtrados = catalogo.filter((p) => !busqueda.trim() || coincideBusqueda(`${p.nombre} ${p.subcategoria ?? ""}`, busqueda));
    return filtrados
      .sort((a, b) => Number(b.categoria?.toUpperCase() === "DIDI") - Number(a.categoria?.toUpperCase() === "DIDI") || a.nombre.localeCompare(b.nombre))
      .slice(0, 40);
  }, [catalogo, busqueda]);

  function elegir(p: ProductoCatalogo) {
    const elegido = { productoId: p.id, nombreProducto: p.nombre, precioUnitario: p.precio, categoria: p.categoria, coincidencia: "exacto" as const };
    if (eligiendo === "nuevo") setItems((l) => [...l, { leido: "", cantidad: 1, ...elegido }]);
    else if (typeof eligiendo === "number") setItems((l) => l.map((x, i) => (i === eligiendo ? { ...x, ...elegido } : x)));
    setEligiendo(null);
    setBusqueda("");
  }

  function cambiarCantidad(indice: number, delta: number) {
    setItems((l) => l.map((x, i) => (i === indice ? { ...x, cantidad: x.cantidad + delta } : x)).filter((x) => x.cantidad > 0));
  }

  const listo = pedidoListoParaConfirmar(items);
  const total = totalItems(items);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={e.fondo}>
        <View style={e.caja}>
          <View style={e.encabezado}>
            <Text style={e.titulo}>🛵 Pedido DiDi {pedido.numeroPedido ? `#${pedido.numeroPedido}` : ""}</Text>
            <TouchableOpacity onPress={onCerrar} accessibilityLabel="Cerrar"><Text style={e.cerrar}>✕</Text></TouchableOpacity>
          </View>
          <Text style={e.ayuda}>
            {[pedido.cliente, pedido.total != null ? `Total en DiDi $${pedido.total.toFixed(2)}` : null].filter(Boolean).join(" · ") || "Sin datos de cliente ni total en la notificación"}
          </Text>

          {eligiendo !== null ? (
            <View style={{ flex: 1, marginTop: 10 }}>
              <TextInput value={busqueda} onChangeText={setBusqueda} placeholder="Buscar producto…" placeholderTextColor={colores.textoSecundario}
                autoFocus style={e.input} />
              <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
                {opciones.map((p) => (
                  <TouchableOpacity key={p.id} onPress={() => elegir(p)} style={e.opcion}>
                    <Text style={e.nombre}>{p.nombre}</Text>
                    <Text style={e.ayuda}>{[p.categoria, p.subcategoria].filter(Boolean).join(" · ")} · ${p.precio.toFixed(2)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity onPress={() => { setEligiendo(null); setBusqueda(""); }} style={e.botonSecundario}>
                <Text style={e.botonSecundarioTexto}>Volver</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <ScrollView style={{ flex: 1, marginTop: 10 }}>
                {items.length === 0 && (
                  <Text style={[e.ayuda, { marginBottom: 8 }]}>
                    La notificación de DiDi no trae los productos. Agrégalos tal como aparecen en la app de DiDi.
                  </Text>
                )}
                {items.map((it, i) => (
                  <View key={i} style={[e.fila, { borderLeftColor: it.productoId ? (it.coincidencia === "exacto" ? colores.green : colores.amber) : colores.red }]}>
                    <View style={{ flex: 1 }}>
                      {it.productoId ? (
                        <Text style={e.nombre}>{it.nombreProducto} <Text style={e.ayuda}>${(it.precioUnitario ?? 0).toFixed(2)}</Text></Text>
                      ) : (
                        <Text style={[e.nombre, { color: colores.red }]}>Sin producto: elige cuál es</Text>
                      )}
                      {it.leido ? <Text style={e.ayuda}>DiDi dice: {it.leido}{it.coincidencia === "aproximado" ? " (revisa)" : ""}</Text> : null}
                      <TouchableOpacity onPress={() => setEligiendo(i)}><Text style={e.enlace}>{it.productoId ? "Cambiar producto" : "Elegir producto"}</Text></TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => cambiarCantidad(i, -1)} style={e.botonCantidad}><Text style={e.botonCantidadTexto}>−</Text></TouchableOpacity>
                    <Text style={e.cantidad}>{it.cantidad}</Text>
                    <TouchableOpacity onPress={() => cambiarCantidad(i, 1)} style={e.botonCantidad}><Text style={e.botonCantidadTexto}>+</Text></TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity onPress={() => setEligiendo("nuevo")} style={e.botonSecundario}>
                  <Text style={e.botonSecundarioTexto}>+ Agregar producto</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setVerOriginal((v) => !v)}>
                  <Text style={e.enlace}>{verOriginal ? "Ocultar" : "Ver"} lo que llegó de DiDi</Text>
                </TouchableOpacity>
                {verOriginal && <Text style={[e.ayuda, e.original]}>{[pedido.titulo, pedido.texto].filter(Boolean).join("\n")}</Text>}
              </ScrollView>

              <Text style={[e.nombre, { textAlign: "right", marginVertical: 8 }]}>
                Total del menú: ${total.toFixed(2)}
                {pedido.total != null && Math.abs(pedido.total - total) > 0.5 ? <Text style={{ color: colores.amber }}>  (DiDi: ${pedido.total.toFixed(2)})</Text> : null}
              </Text>
              <TouchableOpacity onPress={() => listo && onConfirmar(items)} disabled={!listo} style={[e.botonPrincipal, !listo && { opacity: 0.4 }]}>
                <Text style={e.botonPrincipalTexto}>✓ Confirmar pedido</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={onCapturarAMano} style={[e.botonSecundario, { flex: 1 }]}><Text style={e.botonSecundarioTexto}>Capturar en Venta</Text></TouchableOpacity>
                <TouchableOpacity onPress={onDescartar} style={[e.botonSecundario, { flex: 1 }]}><Text style={[e.botonSecundarioTexto, { color: colores.red }]}>No es un pedido</Text></TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function crearEstilos(c: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 16 },
    caja: { width: "100%", maxWidth: 560, height: "90%", backgroundColor: c.fondo, borderRadius: 14, padding: 16 },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 20, fontWeight: "800", color: c.texto },
    cerrar: { fontSize: 20, color: c.textoSecundario },
    ayuda: { fontSize: 12, color: c.textoSecundario, lineHeight: 17 },
    original: { backgroundColor: c.superficie, padding: 8, borderRadius: 8, marginTop: 6 },
    input: { borderWidth: 1, borderColor: c.borde, borderRadius: 8, padding: 10, color: c.texto, marginBottom: 8 },
    opcion: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borde },
    fila: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.superficie, borderRadius: 10, padding: 10, marginBottom: 8, borderLeftWidth: 4 },
    nombre: { fontSize: 15, fontWeight: "700", color: c.texto },
    enlace: { color: c.blue, fontWeight: "700", fontSize: 13, marginTop: 4 },
    botonCantidad: { width: 40, height: 40, borderRadius: 8, backgroundColor: c.navy, alignItems: "center", justifyContent: "center" },
    botonCantidadTexto: { color: "#fff", fontSize: 20, fontWeight: "800" },
    cantidad: { minWidth: 28, textAlign: "center", fontSize: 18, fontWeight: "800", color: c.texto },
    botonPrincipal: { backgroundColor: "#FF6A13", borderRadius: 10, padding: 15, alignItems: "center", marginBottom: 8 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "800", fontSize: 16 },
    botonSecundario: { borderWidth: 1, borderColor: c.borde, borderRadius: 10, padding: 12, alignItems: "center", marginVertical: 6 },
    botonSecundarioTexto: { color: c.texto, fontWeight: "700" },
  });
}
