import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import type { ModificadorLocal } from "../db/catalogoRepo";
import type { ModificadorNuevo } from "../caja/nuevoModificador";
import { ModalModificador } from "./ModalModificador";

/** Elegir qué modificadores pregunta un producto (Admin → Catálogo): al darlo de alta o después.
 *  Además de elegir los que ya existen, se puede crear uno nuevo ahí mismo (onCrearModificador
 *  lo guarda y devuelve su id; el padre recarga la lista y aquí queda marcado).
 *  El orden en que se marcan es el orden en que se preguntarán al venderlo. Con alguno marcado el
 *  producto se vuelve "compuesto": tocarlo en Venta abre el modal de personalización. */
export function ModalModificadoresProducto({
  titulo,
  modificadores,
  seleccionInicial,
  onCancelar,
  onGuardar,
  onCrearModificador,
  onEditarModificador,
}: {
  titulo: string;
  modificadores: ModificadorLocal[];
  seleccionInicial: string[];
  onCancelar: () => void;
  onGuardar: (modificadorIds: string[]) => void;
  onCrearModificador: (modificador: ModificadorNuevo) => Promise<string>;
  /** Guarda los cambios de un grupo existente (nombre, opciones, precios). El padre recarga la lista. */
  onEditarModificador: (id: string, modificador: ModificadorNuevo) => Promise<void>;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [seleccion, setSeleccion] = useState<string[]>(seleccionInicial.filter((id) => modificadores.some((m) => m.id === id)));

  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<ModificadorLocal | null>(null);

  async function crearYMarcar(nuevo: ModificadorNuevo) {
    const id = await onCrearModificador(nuevo);
    setSeleccion((s) => (s.includes(id) ? s : [...s, id]));
    setCreando(false);
  }

  async function guardarEdicion(nuevo: ModificadorNuevo) {
    if (!editando) return;
    await onEditarModificador(editando.id, nuevo);
    setEditando(null);
  }

  function alternar(id: string) {
    setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={estilos.fondo}>
        <View style={estilos.tarjeta}>
          <Text style={estilos.titulo}>{titulo}</Text>
          <Text style={estilos.ayuda}>
            Marca lo que se debe preguntar al venderlo (tamaño, tipo de leche, jarabes…). Con ✎ Editar cambias las opciones y precios de un modificador (aplica a todos los productos que lo usan). Se pregunta en el orden en que lo marques.
            Sin nada marcado, el producto se agrega directo al carrito.
          </Text>

          <ScrollView style={{ maxHeight: 380 }}>
            {modificadores.length === 0 && (
              <Text style={estilos.ayuda}>Todavía no hay modificadores. Crea el primero con el botón de abajo.</Text>
            )}
            {modificadores.map((m) => {
              const posicion = seleccion.indexOf(m.id);
              const marcado = posicion >= 0;
              return (
                <TouchableOpacity key={m.id} onPress={() => alternar(m.id)} style={[estilos.fila, marcado && estilos.filaMarcada]} accessibilityLabel={`Modificador ${m.nombre}`}>
                  <View style={[estilos.casilla, marcado && estilos.casillaMarcada]}>
                    <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{marcado ? String(posicion + 1) : ""}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={estilos.nombre}>
                      {m.nombre}
                      <Text style={estilos.detalle}>  · {m.tipo === "MULTIPLE" ? "varias opciones" : "una opción"}{m.obligatorio ? " · obligatorio" : ""}</Text>
                    </Text>
                    <Text style={estilos.opciones} numberOfLines={2}>
                      {m.opciones.map((o) => (o.precioExtra > 0 ? `${o.nombre} +$${o.precioExtra}` : o.nombre)).join(" · ") || "Sin opciones"}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setEditando(m)} style={estilos.editar} accessibilityLabel={`Editar modificador ${m.nombre}`} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={{ color: colores.navyTexto, fontWeight: "700", fontSize: 12 }}>✎ Editar</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity onPress={() => setCreando(true)} style={estilos.crear} accessibilityLabel="Crear modificador nuevo">
            <Text style={{ color: colores.navyTexto, fontWeight: "800" }}>➕ Crear modificador nuevo</Text>
          </TouchableOpacity>

          <View style={estilos.botones}>
            <TouchableOpacity onPress={onCancelar} style={[estilos.boton, { backgroundColor: colores.gray50 }]}>
              <Text style={{ color: colores.texto, fontWeight: "700" }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onGuardar(seleccion)} style={[estilos.boton, { backgroundColor: colores.green }]} accessibilityLabel="Guardar modificadores">
              <Text style={{ color: "#fff", fontWeight: "700" }}>{seleccion.length > 0 ? `Guardar (${seleccion.length})` : "Guardar sin modificadores"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {creando && <ModalModificador nombresExistentes={modificadores.map((m) => m.nombre)} onGuardar={crearYMarcar} onCancelar={() => setCreando(false)} />}
      {editando && (
        <ModalModificador
          inicial={editando}
          nombresExistentes={modificadores.filter((m) => m.id !== editando.id).map((m) => m.nombre)}
          onGuardar={guardarEdicion}
          onCancelar={() => setEditando(null)}
        />
      )}
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 16 },
    tarjeta: { width: "100%", maxWidth: 560, backgroundColor: colores.superficie, borderRadius: 16, padding: 18 },
    titulo: { fontSize: 18, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 4, marginBottom: 12, lineHeight: 18 },
    fila: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: colores.borde, marginBottom: 8 },
    filaMarcada: { borderColor: colores.navy, backgroundColor: colores.navy + "12" },
    casilla: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colores.borde, alignItems: "center", justifyContent: "center" },
    casillaMarcada: { backgroundColor: colores.navy, borderColor: colores.navy },
    nombre: { fontSize: 15, fontWeight: "700", color: colores.texto },
    detalle: { fontSize: 12, fontWeight: "400", color: colores.textoSecundario },
    opciones: { fontSize: 12, color: colores.textoSecundario, marginTop: 2 },
    editar: { minHeight: 36, paddingHorizontal: 8, justifyContent: "center", borderRadius: 8, backgroundColor: colores.gray50 },
    crear: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: colores.navy, alignItems: "center", justifyContent: "center", marginTop: 10 },
    botones: { flexDirection: "row", gap: 10, marginTop: 12 },
    boton: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  });
}
