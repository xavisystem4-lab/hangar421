import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { Promocion, TipoPromocion } from "@hangar421/shared";
import { usarColores } from "../store/temaStore";
import type { ProductoLocal } from "../db/catalogoRepo";
import { coincideBusqueda } from "../db/busqueda";
import { fechaATexto, validarPromocion, type DatosPromocion } from "../caja/promocion";

// Lunes primero (como se lee un calendario); el valor es el día JS (0 = domingo).
const DIAS: { valor: number; etiqueta: string }[] = [
  { valor: 1, etiqueta: "Lun" }, { valor: 2, etiqueta: "Mar" }, { valor: 3, etiqueta: "Mié" }, { valor: 4, etiqueta: "Jue" },
  { valor: 5, etiqueta: "Vie" }, { valor: 6, etiqueta: "Sáb" }, { valor: 0, etiqueta: "Dom" },
];
const MAX_FILAS = 40;

/** Crear o editar una promoción: precio especial (directo o %) para los productos que se elijan,
 *  con días, horario y fechas opcionales. Solo recoge y valida (caja/promocion.ts); guardar y
 *  sincronizar lo hace quien lo abre (onGuardar). */
export function ModalPromocion({
  inicial,
  productos,
  sucursalLocalId,
  onGuardar,
  onCancelar,
}: {
  inicial?: Promocion;
  productos: ProductoLocal[];
  sucursalLocalId: string | null;
  onGuardar: (datos: DatosPromocion) => Promise<void> | void;
  onCancelar: () => void;
}) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const editando = !!inicial;
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [tipo, setTipo] = useState<TipoPromocion>(inicial?.tipo ?? "PRECIO");
  const [valor, setValor] = useState(inicial ? String(inicial.valor) : "");
  const [productoIds, setProductoIds] = useState<string[]>(inicial?.productoIds ?? []);
  const [busqueda, setBusqueda] = useState("");
  const [dias, setDias] = useState<number[]>(inicial?.dias ?? []);
  const [horaInicio, setHoraInicio] = useState(inicial?.horaInicio ?? "");
  const [horaFin, setHoraFin] = useState(inicial?.horaFin ?? "");
  const [fechaInicio, setFechaInicio] = useState(fechaATexto(inicial?.fechaInicio));
  const [fechaFin, setFechaFin] = useState(fechaATexto(inicial?.fechaFin));
  const [soloEstaSucursal, setSoloEstaSucursal] = useState(!!inicial?.sucursalId);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const filas = useMemo(
    () => productos.filter((p) => coincideBusqueda(`${p.nombre} ${p.subcategoria ?? ""}`, busqueda)).slice(0, MAX_FILAS),
    [productos, busqueda],
  );

  const alternarProducto = (id: string) => setProductoIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const alternarDia = (d: number) => setDias((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]));
  const cambia = <T,>(set: (v: T) => void) => (v: T) => { set(v); setError(null); };

  // Aviso (no bloquea): un precio especial igual o mayor al de lista no se aplica.
  const numero = Number(valor.replace(",", ".").replace(/^\$/, ""));
  const noAplica = tipo === "PRECIO" && Number.isFinite(numero) && numero > 0
    ? productoIds.map((id) => porId.get(id)).filter((p): p is ProductoLocal => !!p && numero >= p.precioBase).map((p) => p.nombre)
    : [];

  async function guardar() {
    const r = validarPromocion(
      { nombre, tipo, valor, productoIds, dias, horaInicio, horaFin, fechaInicio, fechaFin, soloEstaSucursal },
      sucursalLocalId,
    );
    if (!r.ok) { setError(r.error); return; }
    setGuardando(true);
    try {
      await onGuardar(r.valor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la promoción.");
      setGuardando(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancelar}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={estilos.fondo}>
        <View style={estilos.tarjeta}>
          <Text style={estilos.titulo}>{editando ? "Editar promoción" : "Nueva promoción"}</Text>
          <Text style={estilos.ayuda}>Precio especial para los productos que elijas. Se aplica solo al agregarlos a la venta mientras esté vigente.</Text>

          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
            <TextInput placeholder="Nombre (Latte a $49, Martes de café…)" placeholderTextColor={colores.textoSecundario} value={nombre} onChangeText={cambia(setNombre)} style={estilos.input} accessibilityLabel="Nombre de la promoción" />

            <View style={estilos.fila}>
              {([["PRECIO", "Precio directo"], ["PORCENTAJE", "Porcentaje"]] as const).map(([v, t]) => (
                <TouchableOpacity key={v} onPress={() => cambia(setTipo)(v)} style={[estilos.chip, tipo === v && estilos.chipActivo]} accessibilityLabel={t}>
                  <Text style={{ color: tipo === v ? "#fff" : colores.texto, fontWeight: "700" }}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              placeholder={tipo === "PRECIO" ? "Precio especial en pesos (ej. 49)" : "Descuento en % (ej. 20)"}
              placeholderTextColor={colores.textoSecundario} value={valor} onChangeText={cambia(setValor)} keyboardType="decimal-pad" style={estilos.input}
              accessibilityLabel={tipo === "PRECIO" ? "Precio especial" : "Porcentaje de descuento"}
            />
            {noAplica.length > 0 && (
              <Text style={estilos.aviso}>⚠ Este precio no baja el de {noAplica.slice(0, 3).join(", ")}{noAplica.length > 3 ? "…" : ""}: en esos productos no se aplicará.</Text>
            )}

            <Text style={estilos.subtitulo}>Productos ({productoIds.length})</Text>
            {productoIds.length > 0 && (
              <View style={estilos.seleccionados}>
                {productoIds.map((id) => (
                  <TouchableOpacity key={id} onPress={() => alternarProducto(id)} style={estilos.etiqueta} accessibilityLabel={`Quitar ${porId.get(id)?.nombre ?? "producto"}`}>
                    <Text style={{ color: "#fff", fontSize: 12 }} numberOfLines={1}>{porId.get(id)?.nombre ?? "Producto"} ✕</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput placeholder="Buscar producto para agregar…" placeholderTextColor={colores.textoSecundario} value={busqueda} onChangeText={setBusqueda} style={estilos.input} accessibilityLabel="Buscar producto" />
            {filas.map((p) => {
              const marcado = productoIds.includes(p.id);
              return (
                <TouchableOpacity key={p.id} onPress={() => alternarProducto(p.id)} style={[estilos.filaProducto, marcado && estilos.filaMarcada]} accessibilityLabel={`Producto ${p.nombre}`}>
                  <Text style={{ color: colores.texto, flex: 1 }} numberOfLines={1}>{marcado ? "✓ " : ""}{p.nombre}</Text>
                  <Text style={{ color: colores.textoSecundario }}>${p.precioBase.toFixed(2)}</Text>
                </TouchableOpacity>
              );
            })}
            {filas.length === MAX_FILAS && <Text style={estilos.ayuda}>Mostrando los primeros {MAX_FILAS}: escribe en el buscador para acotar.</Text>}

            <Text style={estilos.subtitulo}>Días {dias.length === 0 ? "(todos)" : ""}</Text>
            <View style={estilos.fila}>
              {DIAS.map((d) => (
                <TouchableOpacity key={d.valor} onPress={() => cambia(alternarDia)(d.valor)} style={[estilos.chipDia, dias.includes(d.valor) && estilos.chipActivo]} accessibilityLabel={`Día ${d.etiqueta}`}>
                  <Text style={{ color: dias.includes(d.valor) ? "#fff" : colores.texto, fontWeight: "700", fontSize: 12 }}>{d.etiqueta}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={estilos.subtitulo}>Horario (opcional, 24 h)</Text>
            <View style={estilos.fila}>
              <TextInput placeholder="Desde 14:00" placeholderTextColor={colores.textoSecundario} value={horaInicio} onChangeText={cambia(setHoraInicio)} style={[estilos.input, estilos.mitad]} accessibilityLabel="Hora de inicio" />
              <TextInput placeholder="Hasta 17:00" placeholderTextColor={colores.textoSecundario} value={horaFin} onChangeText={cambia(setHoraFin)} style={[estilos.input, estilos.mitad]} accessibilityLabel="Hora de fin" />
            </View>

            <Text style={estilos.subtitulo}>Fechas (opcional, DD/MM/AAAA)</Text>
            <View style={estilos.fila}>
              <TextInput placeholder="Desde 01/10/2026" placeholderTextColor={colores.textoSecundario} value={fechaInicio} onChangeText={cambia(setFechaInicio)} style={[estilos.input, estilos.mitad]} accessibilityLabel="Fecha de inicio" />
              <TextInput placeholder="Hasta 31/10/2026" placeholderTextColor={colores.textoSecundario} value={fechaFin} onChangeText={cambia(setFechaFin)} style={[estilos.input, estilos.mitad]} accessibilityLabel="Fecha de fin" />
            </View>

            <Text style={estilos.subtitulo}>Dónde aplica</Text>
            <View style={estilos.fila}>
              {([[false, "Todas las sucursales"], [true, "Solo esta sucursal"]] as const).map(([v, t]) => (
                <TouchableOpacity key={t} onPress={() => setSoloEstaSucursal(v)} style={[estilos.chip, soloEstaSucursal === v && estilos.chipActivo]} accessibilityLabel={t}>
                  <Text style={{ color: soloEstaSucursal === v ? "#fff" : colores.texto, fontWeight: "700", fontSize: 12 }}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {error && <Text style={estilos.error}>{error}</Text>}

          <View style={estilos.botones}>
            <TouchableOpacity onPress={onCancelar} style={[estilos.boton, { backgroundColor: colores.gray50 }]}><Text style={{ color: colores.texto, fontWeight: "700" }}>Cancelar</Text></TouchableOpacity>
            <TouchableOpacity onPress={guardar} disabled={guardando} style={[estilos.boton, { backgroundColor: colores.green, opacity: guardando ? 0.6 : 1 }]} accessibilityLabel="Guardar promoción">
              <Text style={{ color: "#fff", fontWeight: "700" }}>{editando ? "Guardar cambios" : "Crear promoción"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 16 },
    tarjeta: { width: "100%", maxWidth: 600, backgroundColor: colores.superficie, borderRadius: 16, padding: 18 },
    titulo: { fontSize: 18, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 4, marginBottom: 10, lineHeight: 18 },
    subtitulo: { fontSize: 14, fontWeight: "800", color: colores.texto, marginTop: 14, marginBottom: 8 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 10, color: colores.texto, minHeight: 44 },
    mitad: { flex: 1, marginBottom: 0 },
    fila: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 8 },
    chip: { flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colores.borde, backgroundColor: colores.gray50, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
    chipDia: { flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colores.borde, backgroundColor: colores.gray50, alignItems: "center", justifyContent: "center" },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    seleccionados: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
    etiqueta: { backgroundColor: colores.navy, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 220 },
    filaProducto: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: colores.borde, marginBottom: 6 },
    filaMarcada: { borderColor: colores.navy, backgroundColor: colores.navy + "12" },
    aviso: { fontSize: 12, color: colores.amber, marginBottom: 8, lineHeight: 16 },
    error: { color: colores.red, fontSize: 13, marginTop: 8 },
    botones: { flexDirection: "row", gap: 10, marginTop: 12 },
    boton: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  });
}
