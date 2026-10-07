import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { describirVigencia, promocionVigente, type Promocion } from "@hangar421/shared";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerOCrearSucursalIdLocal } from "../db/dispositivoLocal";
import type { ProductoLocal } from "../db/catalogoRepo";
import { alternarPromocion, crearPromocion, editarPromocion, listarPromociones } from "../db/promocionesRepo";
import { sincronizarPronto } from "../sync/syncEngine";
import { ModalPromocion } from "./ModalPromocion";
import type { DatosPromocion } from "../caja/promocion";

/** Admin → Catálogo → Promociones: lista, alta, edición y encendido/apagado de los precios
 *  especiales. Cualquiera con el permiso de Promociones puede usarla (por defecto, todos los roles). */
export function PromocionesAdmin({ productos, usuarioId }: { productos: ProductoLocal[]; usuarioId?: string }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [promociones, setPromociones] = useState<Promocion[]>([]);
  const [sucursalId, setSucursalId] = useState<string | null>(null);
  // undefined = cerrado, null = nueva, Promocion = editando.
  const [editando, setEditando] = useState<Promocion | null | undefined>(undefined);

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const [lista, suc] = await Promise.all([listarPromociones(db), obtenerOCrearSucursalIdLocal(db)]);
    setPromociones(lista);
    setSucursalId(suc);
  }
  useEffect(() => { cargar(); }, []);

  async function guardar(datos: DatosPromocion) {
    const db = await abrirBaseDeDatos();
    if (editando) await editarPromocion(db, editando.id, datos, editando.activo, usuarioId);
    else await crearPromocion(db, datos, usuarioId);
    setEditando(undefined);
    sincronizarPronto();
    await cargar();
  }

  async function alternar(p: Promocion) {
    const db = await abrirBaseDeDatos();
    await alternarPromocion(db, p, !p.activo, usuarioId);
    sincronizarPronto();
    await cargar();
  }

  const ahora = new Date();
  return (
    <View style={estilos.tarjeta}>
      <View style={estilos.encabezado}>
        <Text style={estilos.subtitulo}>🏷 Promociones</Text>
        <TouchableOpacity onPress={() => setEditando(null)} style={estilos.botonNueva} accessibilityLabel="Nueva promoción">
          <Text style={{ color: "#fff", fontWeight: "700" }}>+ Nueva promoción</Text>
        </TouchableOpacity>
      </View>
      {promociones.length === 0 && <Text style={estilos.ayuda}>Todavía no hay promociones. Crea una para dar un precio especial por día, horario o fechas.</Text>}
      {promociones.map((p) => {
        const vigente = promocionVigente(p, ahora, sucursalId);
        return (
          <View key={p.id} style={estilos.fila}>
            <View style={{ flex: 1 }}>
              <Text style={[estilos.nombre, !p.activo && { color: colores.textoSecundario }]} numberOfLines={1}>{p.nombre}</Text>
              <Text style={estilos.detalle} numberOfLines={2}>
                {p.tipo === "PRECIO" ? `Precio $${p.valor.toFixed(2)}` : `${p.valor}% de descuento`} · {p.productoIds.length} producto(s){p.sucursalId ? " · solo una sucursal" : ""}
              </Text>
              <Text style={estilos.detalle} numberOfLines={2}>{describirVigencia(p)}</Text>
              <Text style={{ fontSize: 12, fontWeight: "700", color: !p.activo ? colores.textoSecundario : vigente ? colores.green : colores.amber }}>
                {!p.activo ? "⏸ Apagada" : vigente ? "● Vigente ahora" : "◐ Activa, fuera de horario"}
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <TouchableOpacity onPress={() => setEditando(p)} style={[estilos.botonChico, { backgroundColor: colores.gray50 }]} accessibilityLabel={`Editar ${p.nombre}`}>
                <Text style={{ color: colores.texto, fontSize: 12, fontWeight: "700" }}>Editar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => alternar(p)} style={[estilos.botonChico, { backgroundColor: p.activo ? colores.amber + "26" : colores.green + "1A" }]} accessibilityLabel={`${p.activo ? "Apagar" : "Encender"} ${p.nombre}`}>
                <Text style={{ color: p.activo ? colores.amber : colores.green, fontSize: 12, fontWeight: "700" }}>{p.activo ? "Apagar" : "Encender"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {editando !== undefined && (
        <ModalPromocion inicial={editando ?? undefined} productos={productos} sucursalLocalId={sucursalId} onGuardar={guardar} onCancelar={() => setEditando(undefined)} />
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 12 },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto },
    botonNueva: { backgroundColor: colores.navy, borderRadius: 8, paddingHorizontal: 12, minHeight: 40, justifyContent: "center" },
    ayuda: { fontSize: 13, color: colores.textoSecundario, lineHeight: 18 },
    fila: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colores.borde },
    nombre: { fontSize: 15, fontWeight: "700", color: colores.texto },
    detalle: { fontSize: 12, color: colores.textoSecundario, marginTop: 2 },
    botonChico: { paddingHorizontal: 12, minHeight: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  });
}
