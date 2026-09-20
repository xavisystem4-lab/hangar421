import { createRef, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerNombreSucursal } from "../db/dispositivoLocal";
import { listarExistencias, listarMovimientosRecientes, registrarMovimiento, type MovimientoInventarioLocal } from "../db/inventarioRepo";
import { refrescarInventario } from "../sync/pullEngine";
import { coincideBusqueda } from "../db/busqueda";
import {
  ETIQUETA_NIVEL, agruparPorProveedor, diferenciaConteo, generarListaCompras, nivelDe, ordenarPorUrgencia,
  type ExistenciaInsumo, type NivelStock,
} from "../inventario/niveles";
import { exportarComprasExcel, exportarComprasPdf } from "../reportes/exportarCompras";

type Pestana = "existencias" | "conteo" | "compras";

export function PosAdminInventarioScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const { usuario } = useAuthLocalStore();

  const [pestana, setPestana] = useState<Pestana>("existencias");
  const [items, setItems] = useState<ExistenciaInsumo[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoInventarioLocal[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [sucursal, setSucursal] = useState("HANGAR 421");
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);
  /** Lo tecleado en el conteo físico, por insumo. Vacío = ese insumo no se contó. */
  const [conteo, setConteo] = useState<Record<string, string>>({});

  const COLOR_NIVEL: Record<NivelStock, string> = {
    agotado: colores.red,
    critico: colores.red,
    bajo: colores.amber,
    exceso: colores.blue,
    ok: colores.green,
  };

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const [existencias, movs] = await Promise.all([listarExistencias(db), listarMovimientosRecientes(db)]);
    setItems(existencias);
    setMovimientos(movs);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    abrirBaseDeDatos().then(obtenerNombreSucursal).then((n) => n && setSucursal(n)).catch(() => undefined);
  }, []);

  /** Trae del ERP. El saldo del ERP gana: él ya aplicó las ventas y los movimientos de TODAS las
   *  terminales, así que es la única foto completa del almacén. */
  async function sincronizar() {
    setSincronizando(true);
    try {
      await refrescarInventario();
      await cargar();
    } catch (e: any) {
      Alert.alert("Inventario", "No se pudo traer el inventario del ERP. Se sigue mostrando lo último que bajó a esta terminal.");
    } finally {
      setSincronizando(false);
    }
  }

  const visibles = useMemo(
    () => ordenarPorUrgencia(items).filter((i) => coincideBusqueda(`${i.nombre} ${i.proveedorNombre ?? ""}`, busqueda)),
    [items, busqueda],
  );
  const compras = useMemo(() => generarListaCompras(items), [items]);
  const porProveedor = useMemo(() => agruparPorProveedor(compras), [compras]);
  const costoTotal = useMemo(() => Math.round(compras.reduce((s, l) => s + l.costoEstimado, 0) * 100) / 100, [compras]);

  const resumenNiveles = useMemo(() => {
    const conteos: Record<NivelStock, number> = { agotado: 0, critico: 0, bajo: 0, ok: 0, exceso: 0 };
    for (const i of items) conteos[nivelDe(i)] += 1;
    return conteos;
  }, [items]);

  // Refs del conteo, para que Enter baje al siguiente insumo sin cerrar el teclado — igual que
  // en el desglose de caja. Se recalculan solo si cambia la lista visible.
  const refsConteo = useMemo(() => visibles.map(() => createRef<TextInput>()), [visibles.length]);

  async function guardarConteo() {
    if (!usuario) return;
    const aGuardar = visibles
      .map((i) => ({ item: i, valor: conteo[i.insumoId] }))
      .filter((x) => x.valor !== undefined && x.valor !== "" && !Number.isNaN(Number(x.valor)));

    if (aGuardar.length === 0) {
      Alert.alert("Conteo", "No has capturado ninguna cantidad.");
      return;
    }

    const conDiferencia = aGuardar.filter((x) => diferenciaConteo(Number(x.valor), x.item.existencia) !== 0);
    Alert.alert(
      "Guardar conteo físico",
      `Vas a fijar la existencia de ${aGuardar.length} insumo(s).\n` +
        `${conDiferencia.length} tienen diferencia con lo que el sistema creía tener.\n\n` +
        "El conteo FIJA la existencia al valor capturado, no la suma.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Guardar",
          onPress: async () => {
            const db = await abrirBaseDeDatos();
            for (const { item, valor } of aGuardar) {
              await registrarMovimiento(db, {
                insumoId: item.insumoId,
                tipo: "CONTEO",
                cantidad: Number(valor),
                motivo: "Conteo físico desde el Punto de Venta",
                usuarioId: usuario.id,
              });
            }
            setConteo({});
            await cargar();
            Alert.alert("Conteo", `Guardado. Se subirá al ERP en cuanto haya conexión.`);
          },
        },
      ],
    );
  }

  function ajustar(item: ExistenciaInsumo, tipo: "ENTRADA" | "MERMA") {
    if (!usuario) return;
    Alert.prompt?.(
      tipo === "ENTRADA" ? `Entrada de ${item.nombre}` : `Merma de ${item.nombre}`,
      `Cantidad en ${item.unidadMedida}`,
      async (texto) => {
        const cantidad = Number(texto);
        if (!cantidad || cantidad <= 0) return;
        const db = await abrirBaseDeDatos();
        await registrarMovimiento(db, {
          insumoId: item.insumoId,
          tipo,
          cantidad,
          motivo: tipo === "ENTRADA" ? "Recepción de mercancía" : "Merma registrada en el Punto de Venta",
          usuarioId: usuario.id,
        });
        await cargar();
      },
      "plain-text",
      "",
      "numeric",
    );
  }

  async function exportarCompras(formato: "pdf" | "excel") {
    setExportando(formato);
    try {
      const datos = { sucursal, fecha: new Date().toISOString(), grupos: porProveedor, costoTotal };
      if (formato === "pdf") await exportarComprasPdf(datos);
      else await exportarComprasExcel(datos);
    } catch (e: any) {
      Alert.alert("Exportar", e?.message ?? "No se pudo exportar la lista de compras.");
    } finally {
      setExportando(null);
    }
  }

  if (cargando) {
    return <View style={estilos.centro}><ActivityIndicator color={colores.navy} size="large" /></View>;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Inventario</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>

      {items.length === 0 ? (
        <View style={estilos.tarjeta}>
          <Text style={estilos.ayuda}>
            Todavía no hay insumos en esta terminal. Se dan de alta en el ERP y bajan aquí al sincronizar.
          </Text>
          <TouchableOpacity onPress={sincronizar} disabled={sincronizando} style={estilos.botonPrincipal}>
            {sincronizando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonPrincipalTexto}>Traer del ERP</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Semáforo del almacén: un vistazo dice si hay que actuar hoy. */}
          <View style={estilos.semaforo}>
            {(["agotado", "critico", "bajo", "ok"] as NivelStock[]).map((n) => (
              <View key={n} style={[estilos.pastilla, { borderColor: COLOR_NIVEL[n] }]}>
                <Text style={[estilos.pastillaValor, { color: COLOR_NIVEL[n] }]}>{resumenNiveles[n]}</Text>
                <Text style={estilos.pastillaEtiqueta} numberOfLines={1}>{ETIQUETA_NIVEL[n]}</Text>
              </View>
            ))}
          </View>

          <View style={estilos.pestanas}>
            {([["existencias", "Existencias"], ["conteo", "Conteo físico"], ["compras", `Compras (${compras.length})`]] as [Pestana, string][]).map(([id, etiqueta]) => (
              <TouchableOpacity key={id} onPress={() => setPestana(id)} style={[estilos.pestana, pestana === id && estilos.pestanaActiva]}>
                <Text style={[estilos.pestanaTexto, pestana === id && estilos.pestanaTextoActivo]}>{etiqueta}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {pestana !== "compras" && (
            <TextInput
              value={busqueda}
              onChangeText={setBusqueda}
              placeholder="Buscar insumo o proveedor…"
              placeholderTextColor={colores.textoSecundario}
              autoCapitalize="none"
              style={estilos.input}
            />
          )}

          {pestana === "existencias" && (
            <>
              <TouchableOpacity onPress={sincronizar} disabled={sincronizando} style={estilos.botonSecundario}>
                {sincronizando ? <ActivityIndicator color={colores.navyTexto} size="small" /> : <Text style={estilos.botonSecundarioTexto}>↻ Actualizar desde el ERP</Text>}
              </TouchableOpacity>

              {visibles.map((i) => {
                const nivel = nivelDe(i);
                return (
                  <View key={i.insumoId} style={[estilos.filaInsumo, { borderLeftColor: COLOR_NIVEL[nivel] }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={estilos.nombreInsumo}>{i.nombre}</Text>
                      <Text style={estilos.ayuda}>
                        {i.existencia} {i.unidadMedida} · mínimo {i.minimo} · {ETIQUETA_NIVEL[nivel]}
                      </Text>
                      {i.proveedorNombre ? <Text style={estilos.ayuda}>{i.proveedorNombre}</Text> : null}
                    </View>
                    <View style={{ gap: 6 }}>
                      <TouchableOpacity onPress={() => ajustar(i, "ENTRADA")} style={[estilos.botonMini, { backgroundColor: colores.green }]}>
                        <Text style={estilos.botonMiniTexto}>+ Entrada</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => ajustar(i, "MERMA")} style={[estilos.botonMini, { backgroundColor: colores.red }]}>
                        <Text style={estilos.botonMiniTexto}>− Merma</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {pestana === "conteo" && (
            <>
              <Text style={estilos.ayuda}>
                Captura lo que hay físicamente. Enter baja al siguiente insumo. El conteo FIJA la existencia, no la suma.
              </Text>
              {visibles.map((i, indice) => {
                const capturado = conteo[i.insumoId];
                const dif = capturado !== undefined && capturado !== "" ? diferenciaConteo(Number(capturado), i.existencia) : null;
                return (
                  <View key={i.insumoId} style={estilos.filaConteo}>
                    <View style={{ flex: 1 }}>
                      <Text style={estilos.nombreInsumo} numberOfLines={1}>{i.nombre}</Text>
                      <Text style={estilos.ayuda}>Sistema: {i.existencia} {i.unidadMedida}</Text>
                    </View>
                    <TextInput
                      ref={refsConteo[indice]}
                      value={capturado ?? ""}
                      onChangeText={(v) => setConteo((s) => ({ ...s, [i.insumoId]: v.replace(/[^0-9.]/g, "") }))}
                      onSubmitEditing={() => refsConteo[indice + 1]?.current?.focus()}
                      keyboardType="decimal-pad"
                      returnKeyType={indice === visibles.length - 1 ? "done" : "next"}
                      blurOnSubmit={false}
                      placeholder="—"
                      placeholderTextColor={colores.textoSecundario}
                      style={estilos.inputConteo}
                      accessibilityLabel={`Conteo de ${i.nombre}`}
                    />
                    <Text style={[estilos.difConteo, { color: dif === null ? colores.textoSecundario : dif === 0 ? colores.green : colores.red }]}>
                      {dif === null ? "" : dif === 0 ? "=" : `${dif > 0 ? "+" : ""}${dif}`}
                    </Text>
                  </View>
                );
              })}
              <TouchableOpacity onPress={guardarConteo} style={estilos.botonPrincipal}>
                <Text style={estilos.botonPrincipalTexto}>Guardar conteo</Text>
              </TouchableOpacity>
            </>
          )}

          {pestana === "compras" && (
            <>
              {compras.length === 0 ? (
                <View style={estilos.tarjeta}>
                  <Text style={estilos.ayuda}>Nada por comprar: ningún insumo está por debajo de su mínimo.</Text>
                </View>
              ) : (
                <>
                  <View style={estilos.tarjeta}>
                    <Text style={estilos.subtitulo}>Costo estimado: ${costoTotal.toFixed(2)}</Text>
                    <Text style={estilos.ayuda}>
                      Se propone reponer hasta el máximo, o al doble del mínimo si no hay máximo definido —
                      reponer justo hasta el mínimo dejaría el insumo otra vez en la lista mañana.
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
                    <TouchableOpacity onPress={() => exportarCompras("pdf")} disabled={exportando !== null} style={[estilos.botonExportar, { backgroundColor: colores.red }]}>
                      {exportando === "pdf" ? <ActivityIndicator color="#fff" size="small" /> : <Text style={estilos.botonMiniTexto}>📄 PDF</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => exportarCompras("excel")} disabled={exportando !== null} style={[estilos.botonExportar, { backgroundColor: colores.green }]}>
                      {exportando === "excel" ? <ActivityIndicator color="#fff" size="small" /> : <Text style={estilos.botonMiniTexto}>📊 Excel</Text>}
                    </TouchableOpacity>
                  </View>

                  {porProveedor.map((g) => (
                    <View key={g.proveedor} style={estilos.tarjeta}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                        <Text style={estilos.subtitulo}>{g.proveedor}</Text>
                        <Text style={estilos.subtitulo}>${g.costo.toFixed(2)}</Text>
                      </View>
                      {g.lineas.map((l) => (
                        <View key={l.insumoId} style={[estilos.filaCompra, { borderLeftColor: COLOR_NIVEL[l.nivel] }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={estilos.nombreInsumo}>{l.nombre}</Text>
                            <Text style={estilos.ayuda}>Hay {l.existencia} · mínimo {l.minimo} · {ETIQUETA_NIVEL[l.nivel]}</Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={estilos.cantidadCompra}>{l.sugerido} {l.unidadMedida}</Text>
                            <Text style={estilos.ayuda}>${l.costoEstimado.toFixed(2)}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ))}
                </>
              )}
            </>
          )}

          {movimientos.length > 0 && pestana === "existencias" && (
            <View style={estilos.tarjeta}>
              <Text style={estilos.subtitulo}>Movimientos recientes de esta terminal</Text>
              {movimientos.slice(0, 10).map((m) => (
                <View key={m.id} style={estilos.filaMovimiento}>
                  <Text style={{ color: colores.texto, fontSize: 12, flex: 1 }} numberOfLines={1}>
                    {m.tipo} · {m.nombreInsumo}
                  </Text>
                  <Text style={{ color: colores.textoSecundario, fontSize: 12 }}>{m.cantidad}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    centro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    subtitulo: { fontSize: 14, fontWeight: "800", color: colores.texto },
    ayuda: { fontSize: 12, color: colores.textoSecundario, lineHeight: 16 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 12, padding: 14, marginBottom: 12 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 12, minHeight: 44, color: colores.texto, marginBottom: 12 },
    semaforo: { flexDirection: "row", gap: 8, marginBottom: 14 },
    pastilla: { flex: 1, borderLeftWidth: 4, backgroundColor: colores.superficie, borderRadius: 8, padding: 8 },
    pastillaValor: { fontSize: 18, fontWeight: "800" },
    pastillaEtiqueta: { fontSize: 10, color: colores.textoSecundario },
    pestanas: { flexDirection: "row", gap: 8, marginBottom: 12 },
    pestana: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: colores.gray50, alignItems: "center", minHeight: 42, justifyContent: "center" },
    pestanaActiva: { backgroundColor: colores.navy },
    pestanaTexto: { fontSize: 12, fontWeight: "700", color: colores.texto },
    pestanaTextoActivo: { color: "#fff" },
    filaInsumo: {
      flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginBottom: 8,
      backgroundColor: colores.superficie, borderRadius: 10, borderLeftWidth: 5,
    },
    nombreInsumo: { fontSize: 14, fontWeight: "700", color: colores.texto },
    botonMini: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, minWidth: 82, alignItems: "center" },
    botonMiniTexto: { color: "#fff", fontSize: 12, fontWeight: "700" },
    filaConteo: {
      flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6,
      borderBottomWidth: 1, borderBottomColor: colores.borde,
    },
    // Mismo criterio que el desglose de caja: campo corto, solo para el número.
    inputConteo: {
      width: 68, minHeight: 40, borderWidth: 1, borderColor: colores.borde, borderRadius: 6,
      paddingHorizontal: 4, fontSize: 15, textAlign: "center", color: colores.texto,
    },
    difConteo: { width: 52, textAlign: "right", fontSize: 12, fontWeight: "700" },
    filaCompra: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingLeft: 10, borderLeftWidth: 4, marginBottom: 6 },
    cantidadCompra: { fontSize: 15, fontWeight: "800", color: colores.navyTexto },
    filaMovimiento: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
    botonPrincipal: { backgroundColor: colores.navy, borderRadius: 10, padding: 15, alignItems: "center", minHeight: 50, justifyContent: "center", marginTop: 12 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "800", fontSize: 15 },
    botonSecundario: { backgroundColor: colores.gray50, borderRadius: 8, padding: 12, alignItems: "center", minHeight: 44, justifyContent: "center", marginBottom: 12 },
    botonSecundarioTexto: { color: colores.navyTexto, fontWeight: "700", fontSize: 13 },
    botonExportar: { flex: 1, borderRadius: 10, padding: 13, alignItems: "center", minHeight: 46, justifyContent: "center" },
  });
}
