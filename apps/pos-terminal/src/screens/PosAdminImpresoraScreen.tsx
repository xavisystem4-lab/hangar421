import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { guardarConfig } from "../db/configLocalRepo";
import { CLAVE_COMANDA_ACTIVA, comandaActiva } from "../printing/imprimirComanda";
import { guardarDatosFiscales, obtenerDatosFiscales } from "../db/configFiscalRepo";
import { impresoraUsb, type ConfigImpresoraUsb, type DispositivoUsb } from "../../modules/hangar-usb-printer";

const CODIGOS_PAGINA: { valor: number; etiqueta: string }[] = [
  { valor: 16, etiqueta: "WPC1252 (16)" },
  { valor: 2, etiqueta: "PC850 (2)" },
  { valor: 0, etiqueta: "PC437 (0)" },
];

/** "0x0483 (1155)": el hex es como lo imprimen las hojas técnicas; el decimal, como lo pide Android. */
const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")} (${n})`;

const NOMBRE_CLASE: Record<number, string> = { 0: "compuesto", 3: "HID", 7: "impresora", 8: "almacenamiento", 9: "hub", 10: "CDC datos", 2: "CDC", 255: "propietaria" };

/**
 * Diagnóstico y ajustes de la impresora térmica USB de ESTA tablet.
 *
 * Sirve para lo que no se puede saber sin el hardware delante: qué ve Android en el puerto OTG
 * (vendorId/productId, clase de interfaz, si hay canal BULK de salida), dar el permiso USB y
 * probar el código de página hasta que los acentos salgan bien. Los ajustes de la impresora se
 * guardan en el lado nativo (por equipo); el ancho del papel es el de Configuración inicial.
 */
export function PosAdminImpresoraScreen({ onCerrar }: { onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [dispositivos, setDispositivos] = useState<DispositivoUsb[]>([]);
  const [config, setConfig] = useState<ConfigImpresoraUsb | null>(null);
  const [anchoMM, setAnchoMM] = useState<58 | 80>(80);
  const [comanda, setComanda] = useState(true);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  async function cargar() {
    if (!impresoraUsb.moduloDisponible) return;
    const [lista, cfg, fiscales] = await Promise.all([
      impresoraUsb.listarDispositivos(),
      impresoraUsb.obtenerConfig(),
      abrirBaseDeDatos().then(obtenerDatosFiscales),
    ]);
    setDispositivos(lista);
    setConfig(cfg);
    setAnchoMM(fiscales.anchoImpresoraMM);
    setComanda(await abrirBaseDeDatos().then(comandaActiva));
  }

  useEffect(() => {
    cargar().catch((e) => Alert.alert("Impresora", e?.message ?? String(e)));
  }, []);

  // La lista se actualiza sola mientras la pantalla está abierta: al conectar o desconectar la
  // impresora por OTG aparece o desaparece sin tocar "Actualizar". Solo relee los dispositivos
  // (barato y local); los ajustes no cambian solos.
  useEffect(() => {
    if (!impresoraUsb.moduloDisponible) return;
    const intervalo = setInterval(() => {
      impresoraUsb.listarDispositivos().then(setDispositivos).catch(() => undefined);
    }, 3000);
    return () => clearInterval(intervalo);
  }, []);

  async function ejecutar(etiqueta: string, accion: () => Promise<unknown>) {
    setTrabajando(etiqueta);
    try {
      await accion();
    } catch (e: any) {
      Alert.alert("Impresora", e?.message ?? String(e));
    } finally {
      setTrabajando(null);
      cargar().catch(() => undefined);
    }
  }

  async function cambiarConfig(cambios: Partial<ConfigImpresoraUsb>) {
    if (!config) return;
    const nueva = { ...config, ...cambios };
    setConfig(nueva);
    await impresoraUsb.guardarConfig(nueva).catch((e) => Alert.alert("Impresora", e?.message ?? String(e)));
    cargar().catch(() => undefined);
  }

  async function cambiarComanda(activa: boolean) {
    setComanda(activa);
    const db = await abrirBaseDeDatos();
    await guardarConfig(db, CLAVE_COMANDA_ACTIVA, activa ? "1" : "0");
  }

  async function cambiarAncho(ancho: 58 | 80) {
    setAnchoMM(ancho);
    const db = await abrirBaseDeDatos();
    const datos = await obtenerDatosFiscales(db);
    await guardarDatosFiscales(db, { ...datos, anchoImpresoraMM: ancho });
  }

  if (!impresoraUsb.moduloDisponible) {
    return (
      <View style={{ flex: 1, backgroundColor: colores.fondo, padding: 16 }}>
        <Encabezado estilos={estilos} onCerrar={onCerrar} />
        <View style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: colores.amber }]}>
          <Text style={estilos.subtitulo}>Módulo de impresora no incluido</Text>
          <Text style={estilos.ayuda}>Esta versión de la app no trae el módulo USB. Instala la versión más reciente del APK.</Text>
        </View>
      </View>
    );
  }

  const fijada = config?.vendorId != null && config?.productId != null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <Encabezado estilos={estilos} onCerrar={onCerrar} />

      <View style={estilos.filaEntre}>
        <Text style={estilos.seccion}>Dispositivos USB conectados</Text>
        <TouchableOpacity onPress={() => ejecutar("buscar", cargar)} style={estilos.botonSecundario}>
          <Text style={estilos.botonSecundarioTexto}>Actualizar</Text>
        </TouchableOpacity>
      </View>

      {dispositivos.length === 0 && (
        <View style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: colores.red }]}>
          <Text style={estilos.subtitulo}>No se detecta ningún dispositivo USB</Text>
          <Text style={estilos.ayuda}>
            Revisa que la impresora esté encendida, que el cable sea OTG (no solo de carga) y que la tablet tenga activado
            "OTG" en Ajustes si su fabricante lo pide.
          </Text>
        </View>
      )}

      {dispositivos.map((d) => (
        <View key={d.nombreSistema} style={[estilos.tarjeta, d.seleccionada && { borderLeftWidth: 4, borderLeftColor: colores.green }]}>
          <Text style={estilos.subtitulo}>
            {d.producto ?? (d.esClaseImpresora ? "Impresora USB" : "Dispositivo USB")}
            {d.seleccionada ? "  ·  en uso para tickets" : ""}
          </Text>
          {d.fabricante && <Text style={estilos.ayuda}>Fabricante: {d.fabricante}</Text>}
          <Text style={estilos.dato}>vendorId: {hex(d.vendorId)}</Text>
          <Text style={estilos.dato}>productId: {hex(d.productId)}</Text>
          <Text style={estilos.dato}>
            Interfaces: {d.clasesInterfaz.map((c) => `${c} ${NOMBRE_CLASE[c] ?? ""}`.trim()).join(", ") || "—"}
          </Text>
          <Text style={estilos.dato}>Canal de salida BULK: {d.tieneSalidaBulk ? "sí" : "no"}</Text>
          <Text style={[estilos.dato, { color: d.tienePermiso ? colores.green : colores.amber }]}>
            Permiso USB: {d.tienePermiso ? "concedido" : "pendiente"}
          </Text>
          <View style={estilos.filaBotones}>
            {!d.tienePermiso && (
              <TouchableOpacity
                onPress={() => ejecutar("permiso", async () => {
                  const ok = await impresoraUsb.solicitarPermiso(d.vendorId, d.productId);
                  if (!ok) Alert.alert("Permiso USB", "No se concedió el permiso.");
                })}
                style={estilos.botonSecundario}
              >
                <Text style={estilos.botonSecundarioTexto}>Dar permiso</Text>
              </TouchableOpacity>
            )}
            {!(fijada && config?.vendorId === d.vendorId && config?.productId === d.productId) && (
              <TouchableOpacity onPress={() => cambiarConfig({ vendorId: d.vendorId, productId: d.productId })} style={estilos.botonSecundario}>
                <Text style={estilos.botonSecundarioTexto}>Usar para tickets</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}

      {fijada && (
        <TouchableOpacity onPress={() => cambiarConfig({ vendorId: null, productId: null })}>
          <Text style={[estilos.ayuda, { marginBottom: 14 }]}>
            Impresora fijada: {hex(config!.vendorId!)} / {hex(config!.productId!)} · Tocar para volver a detección automática
          </Text>
        </TouchableOpacity>
      )}

      {config && (
        <>
          <Text style={estilos.seccion}>Ajustes</Text>
          <View style={estilos.tarjeta}>
            <Text style={estilos.etiqueta}>Ancho del papel</Text>
            <View style={estilos.filaBotones}>
              {([58, 80] as const).map((a) => (
                <TouchableOpacity key={a} onPress={() => cambiarAncho(a)} style={[estilos.chip, anchoMM === a && estilos.chipActivo]}>
                  <Text style={{ color: anchoMM === a ? "#fff" : colores.texto, fontWeight: "700" }}>{a} mm</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[estilos.etiqueta, { marginTop: 12 }]}>Código de página (acentos y ñ)</Text>
            <View style={estilos.filaBotones}>
              {CODIGOS_PAGINA.map((c) => (
                <TouchableOpacity key={c.valor} onPress={() => cambiarConfig({ codePage: c.valor })} style={[estilos.chip, config.codePage === c.valor && estilos.chipActivo]}>
                  <Text style={{ color: config.codePage === c.valor ? "#fff" : colores.texto, fontWeight: "700" }}>{c.etiqueta}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={estilos.ayuda}>Imprime la prueba con cada opción y deja la que muestre bien "áéíóú ñÑ ¡¿".</Text>

            <Interruptor estilos={estilos} etiqueta="Quitar acentos (si ningún código funciona)" valor={config.quitarAcentos} onCambio={(v) => cambiarConfig({ quitarAcentos: v })} />
            <Interruptor estilos={estilos} etiqueta="Imprimir logotipo" valor={config.imprimirLogo} onCambio={(v) => cambiarConfig({ imprimirLogo: v })} />
            <Interruptor estilos={estilos} etiqueta="Cortar papel al terminar" valor={config.cortarPapel} onCambio={(v) => cambiarConfig({ cortarPapel: v })} />
            <Interruptor estilos={estilos} etiqueta="Imprimir comanda de preparación al cobrar" valor={comanda} onCambio={cambiarComanda} />
            <Interruptor estilos={estilos} etiqueta="Abrir cajón de dinero con cada ticket" valor={config.abrirCajon} onCambio={(v) => cambiarConfig({ abrirCajon: v })} />
          </View>
        </>
      )}

      <TouchableOpacity
        onPress={() => ejecutar("prueba", () => impresoraUsb.imprimirPrueba(anchoMM))}
        disabled={trabajando != null}
        style={estilos.botonPrincipal}
      >
        {trabajando === "prueba"
          ? <ActivityIndicator color="#fff" />
          : <Text style={estilos.botonPrincipalTexto}>Imprimir ticket de prueba</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Encabezado({ estilos, onCerrar }: { estilos: ReturnType<typeof crearEstilos>; onCerrar: () => void }) {
  return (
    <View style={estilos.encabezado}>
      <Text style={estilos.titulo}>Impresora de tickets</Text>
      <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
    </View>
  );
}

function Interruptor({ estilos, etiqueta, valor, onCambio }: {
  estilos: ReturnType<typeof crearEstilos>;
  etiqueta: string;
  valor: boolean;
  onCambio: (v: boolean) => void;
}) {
  return (
    <View style={[estilos.filaEntre, { marginTop: 12 }]}>
      <Text style={[estilos.etiqueta, { flex: 1, marginRight: 8 }]}>{etiqueta}</Text>
      <Switch value={valor} onValueChange={onCambio} />
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    seccion: { fontSize: 15, fontWeight: "800", color: colores.texto, marginBottom: 8 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginBottom: 4 },
    etiqueta: { fontSize: 13, fontWeight: "700", color: colores.texto },
    ayuda: { fontSize: 12, color: colores.textoSecundario, lineHeight: 17, marginTop: 4 },
    dato: { fontSize: 13, color: colores.texto, fontFamily: "monospace", marginTop: 2 },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 12, padding: 14, marginBottom: 14 },
    filaEntre: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    filaBotones: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    chip: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colores.gray50 },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    botonSecundario: { borderWidth: 1, borderColor: colores.navy, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
    botonSecundarioTexto: { color: colores.navyTexto, fontWeight: "700" },
    botonPrincipal: { backgroundColor: colores.navy, borderRadius: 10, padding: 15, alignItems: "center", minHeight: 50, justifyContent: "center", marginBottom: 24 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "800", fontSize: 15 },
  });
}
