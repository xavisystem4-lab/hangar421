import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { listarInsumosLocales, type InsumoLocal } from "../db/inventarioRepo";
import { coincideBusqueda } from "../db/busqueda";
import {
  BORRADOR_VACIO, UNIDADES_INSUMO, normalizarNombre, validarInsumo, type BorradorInsumo,
} from "../inventario/altaInsumo";
import {
  actualizarInsumo, cambiarActivoInsumo, crearInsumo, listarProveedores, type ProveedorErp,
} from "../inventario/insumosApi";

/**
 * Pestaña "Insumos" del inventario: alta, edición y baja del catálogo de insumos desde la
 * terminal. Antes solo se podía hacer en el ERP web y la tablet decía "se dan de alta en el
 * ERP"; ahora se hace aquí mismo, contra el ERP, y baja al momento a Existencias y Conteo.
 *
 * Mientras se escribe el nombre se busca en la lista de inventario, para que se vea si el
 * insumo ya existe antes de duplicarlo.
 */
export function PanelInsumos({ onCambio }: { onCambio: () => Promise<void> | void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);

  const [insumos, setInsumos] = useState<InsumoLocal[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorErp[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [formularioAbierto, setFormularioAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<BorradorInsumo>(BORRADOR_VACIO);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const db = await abrirBaseDeDatos();
    setInsumos(await listarInsumosLocales(db));
  }

  useEffect(() => {
    cargar();
  }, []);

  // Los proveedores solo se piden al abrir el formulario y nunca bloquean: sin conexión o sin
  // proveedores se puede dar de alta igual, sin proveedor.
  useEffect(() => {
    if (!formularioAbierto || proveedores !== null) return;
    listarProveedores().then(setProveedores).catch(() => setProveedores([]));
  }, [formularioAbierto, proveedores]);

  const activos = insumos.filter((i) => i.activo).length;
  const visibles = useMemo(
    () => insumos
      .filter((i) => verInactivos || i.activo)
      .filter((i) => coincideBusqueda(`${i.nombre} ${i.proveedorNombre ?? ""}`, busqueda)),
    [insumos, busqueda, verInactivos],
  );

  // Búsqueda en vivo contra la lista de inventario mientras se teclea el nombre.
  const parecidos = useMemo(() => {
    const clave = normalizarNombre(borrador.nombre);
    if (clave.length < 3) return [];
    return insumos.filter((i) => i.id !== editandoId && normalizarNombre(i.nombre).includes(clave)).slice(0, 5);
  }, [borrador.nombre, insumos, editandoId]);

  function abrirNuevo() {
    setEditandoId(null);
    setBorrador(BORRADOR_VACIO);
    setFormularioAbierto(true);
  }

  function abrirEdicion(i: InsumoLocal) {
    setEditandoId(i.id);
    setBorrador({
      nombre: i.nombre,
      unidadMedida: (UNIDADES_INSUMO as readonly string[]).includes(i.unidadMedida) ? i.unidadMedida : "pz",
      costoUnitario: i.costoUnitario ? String(i.costoUnitario) : "",
      proveedorId: i.proveedorId ?? "",
      minimo: i.minimo ? String(i.minimo) : "",
      maximo: i.maximo != null ? String(i.maximo) : "",
    });
    setFormularioAbierto(true);
  }

  function cerrarFormulario() {
    setFormularioAbierto(false);
    setEditandoId(null);
    setBorrador(BORRADOR_VACIO);
  }

  async function guardar() {
    if (guardando) return;
    const r = validarInsumo(borrador, insumos, editandoId ?? undefined);
    if (!r.ok) {
      Alert.alert("Insumo", r.error);
      return;
    }
    setGuardando(true);
    try {
      if (editandoId) await actualizarInsumo(editandoId, r.datos);
      else await crearInsumo(r.datos);
      await cargar();
      await onCambio();
      Alert.alert("Insumo", editandoId ? `"${r.datos.nombre}" actualizado.` : `"${r.datos.nombre}" dado de alta en el inventario.`);
      cerrarFormulario();
    } catch (e: any) {
      Alert.alert("Insumo", `${e?.message ?? "No se pudo guardar"}.\nRevisa la conexión con el ERP e inténtalo de nuevo.`);
    } finally {
      setGuardando(false);
    }
  }

  function alternarActivo(i: InsumoLocal) {
    const ejecutar = async () => {
      try {
        await cambiarActivoInsumo(i.id, !i.activo);
        await cargar();
        await onCambio();
      } catch (e: any) {
        Alert.alert("Insumo", e?.message ?? "No se pudo actualizar el insumo.");
      }
    };
    if (!i.activo) {
      ejecutar();
      return;
    }
    Alert.alert(
      "Dar de baja",
      `"${i.nombre}" dejará de aparecer en Existencias, Conteo y Compras. Su historial se conserva y lo puedes reactivar después.`,
      [{ text: "Cancelar", style: "cancel" }, { text: "Dar de baja", style: "destructive", onPress: ejecutar }],
    );
  }

  const campo = (clave: keyof BorradorInsumo, etiqueta: string, opciones: Partial<ComponentProps<typeof TextInput>> = {}) => (
    <View style={{ flex: 1 }}>
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      <TextInput
        value={borrador[clave]}
        onChangeText={(v) => setBorrador((s) => ({ ...s, [clave]: v }))}
        placeholderTextColor={colores.textoSecundario}
        style={estilos.input}
        {...opciones}
      />
    </View>
  );

  return (
    <>
      {!formularioAbierto ? (
        <TouchableOpacity onPress={abrirNuevo} style={estilos.botonPrincipal}>
          <Text style={estilos.botonPrincipalTexto}>+ Dar de alta insumo</Text>
        </TouchableOpacity>
      ) : (
        <View style={estilos.tarjeta}>
          <Text style={estilos.subtitulo}>{editandoId ? "Editar insumo" : "Nuevo insumo"}</Text>

          {campo("nombre", "Nombre", { placeholder: "Ej. Leche entera, Vasos 12 oz…", autoCapitalize: "sentences" })}
          {parecidos.length > 0 && (
            <View style={estilos.avisoParecidos}>
              <Text style={estilos.ayuda}>Ya en inventario (toca para editarlo en vez de duplicarlo):</Text>
              {parecidos.map((p) => (
                <TouchableOpacity key={p.id} onPress={() => abrirEdicion(p)}>
                  <Text style={estilos.parecido}>
                    • {p.nombre} ({p.unidadMedida}){p.activo ? "" : " — dado de baja"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={estilos.etiqueta}>Unidad de medida</Text>
          <View style={estilos.chips}>
            {UNIDADES_INSUMO.map((u) => (
              <TouchableOpacity
                key={u}
                onPress={() => setBorrador((s) => ({ ...s, unidadMedida: u }))}
                style={[estilos.chip, borrador.unidadMedida === u && estilos.chipActivo]}
              >
                <Text style={[estilos.chipTexto, borrador.unidadMedida === u && estilos.chipTextoActivo]}>{u}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            {campo("costoUnitario", `Costo por ${borrador.unidadMedida} ($)`, { keyboardType: "decimal-pad", placeholder: "0.00" })}
            {campo("minimo", editandoId ? "Mínimo (esta sucursal)" : "Mínimo", { keyboardType: "decimal-pad", placeholder: "—" })}
            {campo("maximo", editandoId ? "Máximo (esta sucursal)" : "Máximo", { keyboardType: "decimal-pad", placeholder: "—" })}
          </View>

          <Text style={estilos.etiqueta}>Proveedor (opcional)</Text>
          {proveedores === null ? (
            <ActivityIndicator color={colores.navy} style={{ alignSelf: "flex-start", marginVertical: 6 }} />
          ) : (
            <View style={estilos.chips}>
              {[{ id: "", nombre: "Sin proveedor" }, ...proveedores].map((p) => (
                <TouchableOpacity
                  key={p.id || "ninguno"}
                  onPress={() => setBorrador((s) => ({ ...s, proveedorId: p.id }))}
                  style={[estilos.chip, borrador.proveedorId === p.id && estilos.chipActivo]}
                >
                  <Text style={[estilos.chipTexto, borrador.proveedorId === p.id && estilos.chipTextoActivo]}>{p.nombre}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {!editandoId && (
            <Text style={[estilos.ayuda, { marginTop: 6 }]}>
              Se crea en el ERP para todas las sucursales, con existencia 0. Después registra la primera entrada o haz el conteo físico.
            </Text>
          )}

          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <TouchableOpacity onPress={cerrarFormulario} disabled={guardando} style={[estilos.botonSecundario, { flex: 1 }]}>
              <Text style={estilos.botonSecundarioTexto}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={guardar} disabled={guardando} style={[estilos.botonGuardar, { flex: 2 }, guardando && { opacity: 0.6 }]}>
              {guardando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonPrincipalTexto}>{editandoId ? "Guardar cambios" : "Dar de alta"}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <TextInput
        value={busqueda}
        onChangeText={setBusqueda}
        placeholder="Buscar insumo o proveedor…"
        placeholderTextColor={colores.textoSecundario}
        autoCapitalize="none"
        style={[estilos.input, { marginBottom: 8 }]}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Text style={estilos.ayuda}>{activos} insumo(s) activos</Text>
        {insumos.length > activos && (
          <TouchableOpacity onPress={() => setVerInactivos((v) => !v)}>
            <Text style={estilos.enlace}>{verInactivos ? "Ocultar dados de baja" : `Ver dados de baja (${insumos.length - activos})`}</Text>
          </TouchableOpacity>
        )}
      </View>

      {visibles.length === 0 ? (
        <View style={estilos.tarjeta}>
          <Text style={estilos.ayuda}>
            {insumos.length === 0 ? "Todavía no hay insumos. Da de alta el primero con el botón de arriba." : "Ningún insumo coincide con la búsqueda."}
          </Text>
        </View>
      ) : (
        visibles.map((i) => (
          <View key={i.id} style={[estilos.fila, !i.activo && { opacity: 0.55 }]}>
            <View style={{ flex: 1 }}>
              <Text style={estilos.nombre}>{i.nombre}{i.activo ? "" : " (baja)"}</Text>
              <Text style={estilos.ayuda}>
                {i.unidadMedida} · ${i.costoUnitario.toFixed(2)} c/u · mínimo {i.minimo}{i.maximo != null ? ` · máximo ${i.maximo}` : ""}
              </Text>
              {i.proveedorNombre ? <Text style={estilos.ayuda}>{i.proveedorNombre}</Text> : null}
            </View>
            <View style={{ gap: 6 }}>
              <TouchableOpacity onPress={() => abrirEdicion(i)} style={[estilos.botonMini, { backgroundColor: colores.navy }]}>
                <Text style={estilos.botonMiniTexto}>✎ Editar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => alternarActivo(i)} style={[estilos.botonMini, { backgroundColor: i.activo ? colores.red : colores.green }]}>
                <Text style={estilos.botonMiniTexto}>{i.activo ? "Dar de baja" : "Reactivar"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 12, padding: 14, marginBottom: 12 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginBottom: 4 },
    etiqueta: { fontSize: 12, fontWeight: "700", color: colores.textoSecundario, marginTop: 8, marginBottom: 4 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, lineHeight: 16 },
    enlace: { fontSize: 12, fontWeight: "700", color: colores.navyTexto },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 12, minHeight: 44, color: colores.texto },
    avisoParecidos: { backgroundColor: colores.gray50, borderRadius: 8, padding: 8, marginTop: 6, borderLeftWidth: 4, borderLeftColor: colores.amber },
    parecido: { fontSize: 13, fontWeight: "700", color: colores.navyTexto, paddingVertical: 4 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: colores.gray50, minHeight: 38, justifyContent: "center" },
    chipActivo: { backgroundColor: colores.navy },
    chipTexto: { fontSize: 13, fontWeight: "700", color: colores.texto },
    chipTextoActivo: { color: "#fff" },
    fila: {
      flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginBottom: 8,
      backgroundColor: colores.superficie, borderRadius: 10, borderLeftWidth: 5, borderLeftColor: colores.navy,
    },
    nombre: { fontSize: 14, fontWeight: "700", color: colores.texto },
    botonMini: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, minWidth: 92, alignItems: "center" },
    botonMiniTexto: { color: "#fff", fontSize: 12, fontWeight: "700" },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", minHeight: 50, justifyContent: "center", marginBottom: 12 },
    botonGuardar: { backgroundColor: colores.navy, borderRadius: 10, padding: 14, alignItems: "center", minHeight: 48, justifyContent: "center" },
    botonPrincipalTexto: { color: "#fff", fontWeight: "800", fontSize: 15 },
    botonSecundario: { backgroundColor: colores.gray50, borderRadius: 10, padding: 14, alignItems: "center", minHeight: 48, justifyContent: "center" },
    botonSecundarioTexto: { color: colores.navyTexto, fontWeight: "700", fontSize: 14 },
  });
}
