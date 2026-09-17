import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AreaImpresion, ConfigTicket, Sucursal } from "@hangar421/shared";
import { CONFIG_TICKET_DEFAULT } from "@hangar421/shared";
import { apiFetch } from "../../../api/http";
import { useAuthStore } from "../../../store/authStore";
import { usarColores } from "../../../store/temaStore";

/** Versión reducida de AdminTicket.tsx del POS Windows — solo ancho de papel y áreas de
 *  impresión (CRUD real contra /areas-impresion). Decisión del plan (Fase 2e): la vista previa
 *  en vivo (iframe HTML) es un concepto exclusivo de web, y no hay SDK de impresora térmica
 *  ESC/POS (Bluetooth/USB) instalado en esta app ni forma de probarlo sin una tablet real y una
 *  impresora física — la edición de fuentes/estilos del ticket y el listado de impresoras
 *  (`window.hangar.impresion`, exclusivo de Electron) quedan fuera de esta pantalla. */
export function PosAdminTicket() {
  const { usuario } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [config, setConfig] = useState<ConfigTicket>(CONFIG_TICKET_DEFAULT);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [areas, setAreas] = useState<AreaImpresion[]>([]);
  const [nuevaArea, setNuevaArea] = useState("");

  async function cargarSucursal(id: string) {
    const s = await apiFetch<Sucursal & { configJson?: { ticket?: ConfigTicket } }>(`/sucursales/${id}`);
    setConfig({ ...CONFIG_TICKET_DEFAULT, ...s.configJson?.ticket });
  }
  async function cargarAreas(empresaId: string) {
    setAreas(await apiFetch<AreaImpresion[]>(`/areas-impresion?empresaId=${empresaId}`));
  }

  useEffect(() => {
    if (!usuario) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) { setSucursalId(s[0].id); cargarSucursal(s[0].id); }
    });
    cargarAreas(usuario.empresaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  async function guardar() {
    if (!sucursalId) return;
    setGuardando(true);
    setMensaje(null);
    try {
      await apiFetch(`/sucursales/${sucursalId}/config-ticket`, { method: "PUT", body: JSON.stringify(config) });
      setMensaje("Ancho de papel guardado.");
    } catch (e: any) {
      setMensaje(e.message ?? "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function agregarArea() {
    if (!usuario || !nuevaArea.trim()) return;
    await apiFetch("/areas-impresion", { method: "POST", body: JSON.stringify({ empresaId: usuario.empresaId, nombre: nuevaArea.trim() }) });
    setNuevaArea("");
    cargarAreas(usuario.empresaId);
  }

  async function eliminarArea(id: string) {
    await apiFetch(`/areas-impresion/${id}`, { method: "DELETE" });
    setAreas((a) => a.filter((x) => x.id !== id));
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <Text style={estilos.titulo}>Ticket</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 10 }}>
        {sucursales.map((s) => (
          <TouchableOpacity key={s.id} onPress={() => { setSucursalId(s.id); cargarSucursal(s.id); }} style={[estilos.chip, sucursalId === s.id && estilos.chipActivo]}>
            <Text style={{ color: sucursalId === s.id ? "#fff" : colores.texto, fontSize: 13 }}>{s.nombre}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mensaje && <Text style={estilos.mensaje}>{mensaje}</Text>}

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Ancho de impresora térmica</Text>
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 4 }}>
          <TouchableOpacity onPress={() => setConfig((c) => ({ ...c, anchoImpresoraMM: 58 }))} style={[estilos.toggle, config.anchoImpresoraMM === 58 && estilos.toggleActivo]}>
            <Text style={{ color: config.anchoImpresoraMM === 58 ? "#fff" : colores.texto, fontWeight: "700" }}>58 mm</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setConfig((c) => ({ ...c, anchoImpresoraMM: 80 }))} style={[estilos.toggle, config.anchoImpresoraMM === 80 && estilos.toggleActivo]}>
            <Text style={{ color: config.anchoImpresoraMM === 80 ? "#fff" : colores.texto, fontWeight: "700" }}>80 mm</Text>
          </TouchableOpacity>
        </View>
        <Text style={estilos.ayuda}>Se comparte con el ticket que ya arma el POS Windows — la plantilla completa (fuentes, logo, textos) solo se edita ahí por ahora.</Text>
        <TouchableOpacity onPress={guardar} disabled={guardando || !sucursalId} style={estilos.botonPrincipal}>
          <Text style={estilos.botonPrincipalTexto}>{guardando ? "Guardando…" : "Guardar ancho de papel"}</Text>
        </TouchableOpacity>
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Áreas de impresión</Text>
        <Text style={estilos.ayuda}>Estas áreas agrupan productos por estación (cocina, barra, etc.), solo para catalogar el menú.</Text>
        {areas.map((a) => (
          <View key={a.id} style={estilos.filaArea}>
            <Text style={{ color: colores.texto, fontWeight: "700" }}>{a.nombre}</Text>
            <TouchableOpacity onPress={() => eliminarArea(a.id)}><Text style={{ color: colores.red, fontSize: 12 }}>Eliminar</Text></TouchableOpacity>
          </View>
        ))}
        {areas.length === 0 && <Text style={estilos.ayuda}>Sin áreas dadas de alta todavía.</Text>}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <TextInput placeholder="Nombre del área (ej. Barra)" placeholderTextColor={colores.textoSecundario} value={nuevaArea} onChangeText={setNuevaArea} style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
          <TouchableOpacity onPress={agregarArea} style={[estilos.botonChico, { backgroundColor: colores.navy }]}><Text style={{ color: "#fff", fontWeight: "700" }}>+ Agregar</Text></TouchableOpacity>
        </View>
      </View>

      <View style={[estilos.tarjeta, { borderLeftWidth: 4, borderLeftColor: colores.amber }]}>
        <Text style={estilos.subtitulo}>Impresión real — pendiente</Text>
        <Text style={estilos.ayuda}>
          Esta tablet no puede imprimir tickets todavía: hace falta instalar un SDK de impresora térmica (ESC/POS por Bluetooth o USB), tener una
          impresora física emparejada y probarlo en el dispositivo real — nada de eso existe en este entorno de desarrollo. La plantilla completa
          (fuentes, logotipo, vista previa) y la selección de impresora por nombre siguen viviendo en el POS Windows mientras tanto.
        </Text>
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto },
    subtitulo: { fontSize: 16, fontWeight: "800", color: colores.texto, marginBottom: 8 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginTop: 4, lineHeight: 17 },
    mensaje: { color: colores.navyTexto, marginBottom: 10 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    toggle: { flex: 1, alignItems: "center", padding: 12, borderRadius: 10, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    toggleActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 14 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, color: colores.texto },
    botonChico: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
    botonPrincipal: { backgroundColor: colores.green, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 12 },
    botonPrincipalTexto: { color: "#fff", fontWeight: "700" },
    filaArea: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colores.borde },
  });
}
