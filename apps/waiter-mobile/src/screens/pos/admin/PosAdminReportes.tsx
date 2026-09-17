import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { Producto, Sucursal } from "@hangar421/shared";
import { apiFetch } from "../../../api/http";
import { useAuthStore } from "../../../store/authStore";
import { usarColores } from "../../../store/temaStore";

interface VentaPorProducto { productoId: string; _sum: { cantidad: number | null }; _count: number }
interface VentaPorMetodo { metodo: string; _sum: { monto: string | null }; _count: number }

const ETIQUETA_METODO: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", QR: "QR", OTRO: "Otro" };

function fechaISO(d: Date): string { return d.toISOString().slice(0, 10); }

/** Reportes de ventas — mismo módulo que AdminReportes.tsx del POS Windows. Sin
 *  react-native-svg instalado (decisión del plan, para no chocar con la rama de Expo SDK 57 en
 *  curso), la gráfica se reemplaza por barras horizontales simples (View con ancho en %). */
function BarraHorizontal({ datos, colores }: { datos: { etiqueta: string; valor: number }[]; colores: ReturnType<typeof usarColores> }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <View style={{ gap: 8 }}>
      {datos.map((d, i) => (
        <View key={i}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 12, color: colores.texto }} numberOfLines={1}>{d.etiqueta}</Text>
            <Text style={{ fontSize: 12, color: colores.textoSecundario }}>{d.valor}</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colores.gray200, marginTop: 3 }}>
            <View style={{ height: 8, borderRadius: 4, width: `${(d.valor / max) * 100}%`, backgroundColor: colores.navy }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function PosAdminReportes() {
  const { usuario } = useAuthStore();
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);

  const hoy = new Date();
  const hace7dias = new Date(hoy.getTime() - 7 * 86_400_000);
  const [desde, setDesde] = useState(fechaISO(hace7dias));
  const [hasta, setHasta] = useState(fechaISO(hoy));

  const [porProducto, setPorProducto] = useState<VentaPorProducto[]>([]);
  const [porMetodo, setPorMetodo] = useState<VentaPorMetodo[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!usuario) return;
    apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuario.empresaId}`).then((s) => {
      setSucursales(s);
      if (s[0]) setSucursalId(s[0].id);
    });
    apiFetch<Producto[]>(`/catalogo/productos?empresaId=${usuario.empresaId}`).then(setProductos).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  useEffect(() => {
    if (!usuario || !sucursalId) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario, sucursalId, desde, hasta]);

  async function cargar() {
    if (!usuario || !sucursalId) return;
    setCargando(true);
    const rangoDesde = new Date(`${desde}T00:00:00`).toISOString();
    const rangoHasta = new Date(`${hasta}T23:59:59`).toISOString();
    try {
      const [prod, met] = await Promise.all([
        apiFetch<VentaPorProducto[]>(`/reportes/ventas-por-producto?empresaId=${usuario.empresaId}&desde=${rangoDesde}&hasta=${rangoHasta}`),
        apiFetch<VentaPorMetodo[]>(`/reportes/ventas-por-metodo-pago?sucursalId=${sucursalId}&desde=${rangoDesde}&hasta=${rangoHasta}`),
      ]);
      setPorProducto(prod);
      setPorMetodo(met);
    } finally {
      setCargando(false);
    }
  }

  const nombreProducto = (id: string) => productos.find((p) => p.id === id)?.nombre ?? "—";
  const topProductos = [...porProducto].sort((a, b) => (b._sum.cantidad ?? 0) - (a._sum.cantidad ?? 0)).slice(0, 10);
  const totalVentas = porMetodo.reduce((s, m) => s + Number(m._sum.monto ?? 0), 0);
  const totalPagos = porMetodo.reduce((s, m) => s + m._count, 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <Text style={estilos.titulo}>Reportes de ventas</Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {sucursales.map((s) => (
          <TouchableOpacity key={s.id} onPress={() => setSucursalId(s.id)} style={[estilos.chip, sucursalId === s.id && estilos.chipActivo]}>
            <Text style={{ color: sucursalId === s.id ? "#fff" : colores.texto, fontSize: 13 }}>{s.nombre}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <TextInput placeholder="Desde AAAA-MM-DD" placeholderTextColor={colores.textoSecundario} value={desde} onChangeText={setDesde} style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
        <TextInput placeholder="Hasta AAAA-MM-DD" placeholderTextColor={colores.textoSecundario} value={hasta} onChangeText={setHasta} style={[estilos.input, { flex: 1, marginBottom: 0 }]} />
      </View>

      {cargando && <Text style={estilos.ayuda}>Cargando…</Text>}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <View style={[estilos.stat, { borderColor: colores.green }]}><Text style={estilos.statValor}>${totalVentas.toFixed(2)}</Text><Text style={estilos.ayuda}>Ventas en el rango</Text></View>
        <View style={[estilos.stat, { borderColor: colores.blue }]}><Text style={estilos.statValor}>{totalPagos}</Text><Text style={estilos.ayuda}>Pagos registrados</Text></View>
        <View style={[estilos.stat, { borderColor: colores.amber }]}><Text style={estilos.statValor}>{porProducto.length}</Text><Text style={estilos.ayuda}>Productos distintos vendidos</Text></View>
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Top productos (por unidades vendidas)</Text>
        {topProductos.length > 0 ? (
          <>
            <BarraHorizontal colores={colores} datos={topProductos.map((p) => ({ etiqueta: nombreProducto(p.productoId), valor: p._sum.cantidad ?? 0 }))} />
          </>
        ) : <Text style={estilos.ayuda}>Sin ventas en este rango.</Text>}
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.subtitulo}>Ventas por método de pago</Text>
        {porMetodo.length > 0 ? (
          <BarraHorizontal colores={colores} datos={porMetodo.map((m) => ({ etiqueta: `${ETIQUETA_METODO[m.metodo] ?? m.metodo} (${m._count})`, valor: Number(m._sum.monto ?? 0) }))} />
        ) : <Text style={estilos.ayuda}>Sin pagos en este rango.</Text>}
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto, marginBottom: 14 },
    subtitulo: { fontSize: 16, fontWeight: "800", color: colores.texto, marginBottom: 10 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, marginTop: 4 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colores.gray50, borderWidth: 1, borderColor: colores.borde },
    chipActivo: { backgroundColor: colores.navy, borderColor: colores.navy },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, padding: 10, marginBottom: 8, color: colores.texto },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 16, marginBottom: 14 },
    stat: { flex: 1, minWidth: 140, backgroundColor: colores.superficie, borderRadius: 12, borderLeftWidth: 4, padding: 12 },
    statValor: { fontSize: 20, fontWeight: "800", color: colores.texto },
  });
}
