import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { apiFetch } from "../../../api/http";
import { useAuthStore } from "../../../store/authStore";
import { usarColores } from "../../../store/temaStore";

interface TabletConectada {
  dispositivoId?: string;
  usuarioNombre?: string;
  tipoDispositivo?: string;
  socketId: string;
  appVersion?: string;
  ip: string;
  conectadoDesde: string;
  ultimoHeartbeat: string;
}

function etiquetaDispositivo(tipo?: string): { icono: string; texto: string } {
  if (tipo === "tablet") return { icono: "📟", texto: "Tablet" };
  if (tipo === "celular") return { icono: "📱", texto: "Celular" };
  return { icono: "❔", texto: "Dispositivo" };
}
function tiempoTranscurrido(iso: string): string {
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return "hace segundos";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `hace ${horas}h ${minutos % 60}min`;
}
function formatearHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour12: false });
}

/** Versión de solo lectura de AdminConexion.tsx del POS Windows — el concepto de "esta PC es un
 *  servidor local, aquí está su IP:puerto" no aplica a una tablet (siempre es cliente de una
 *  Estación, nunca la Estación en sí), así que se deja únicamente la lista de dispositivos
 *  conectados ahora mismo (decisión del plan, Fase 2f, opcional). */
export function PosAdminConexion() {
  const sucursalId = useAuthStore((s) => s.sucursalId);
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [tablets, setTablets] = useState<TabletConectada[] | null>(null);

  useEffect(() => {
    if (!sucursalId) return;
    let vivo = true;
    const cargar = () => {
      apiFetch<TabletConectada[]>(`/realtime/conectados?sucursalId=${sucursalId}`)
        .then((r) => vivo && setTablets(r))
        .catch(() => vivo && setTablets([]));
    };
    cargar();
    const t = setInterval(cargar, 10_000);
    return () => { vivo = false; clearInterval(t); };
  }, [sucursalId]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 16 }}>
      <Text style={estilos.titulo}>Conexión</Text>
      <Text style={estilos.ayuda}>
        Dispositivos de meseros con sesión real y viva contra esta Estación — se actualiza sola cada 10s. En
        cuanto se cierra la app, se pierde la red, o el POS Windows se apaga, el dispositivo desaparece solo.
      </Text>

      <View style={{ marginTop: 14 }}>
        {tablets === null && <Text style={estilos.ayuda}>Buscando…</Text>}
        {tablets && tablets.length === 0 && <Text style={estilos.ayuda}>Ningún dispositivo de mesero conectado ahora mismo.</Text>}
        {tablets?.map((t, i) => {
          const dispositivo = etiquetaDispositivo(t.tipoDispositivo);
          return (
            <View key={t.dispositivoId ?? i} style={estilos.tarjeta}>
              <View style={estilos.filaEncabezado}>
                <Text style={{ color: colores.texto, fontWeight: "800" }}>{dispositivo.icono} {t.usuarioNombre ?? "Mesero"}</Text>
                <Text style={{ color: colores.green, fontSize: 12, fontWeight: "700" }}>🟢 CONECTADO</Text>
              </View>
              <Text style={estilos.detalle}>{dispositivo.texto}{t.appVersion ? ` · APK v${t.appVersion}` : ""}</Text>
              <Text style={estilos.detalle}>IP: {t.ip} · Conectado {tiempoTranscurrido(t.conectadoDesde)}</Text>
              <Text style={estilos.detalle}>Último heartbeat: {formatearHora(t.ultimoHeartbeat)}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    titulo: { fontSize: 22, fontWeight: "800", color: colores.texto, marginBottom: 8 },
    ayuda: { fontSize: 12, color: colores.textoSecundario, lineHeight: 17 },
    filaEncabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    tarjeta: { backgroundColor: colores.superficie, borderRadius: 14, padding: 14, marginBottom: 10 },
    detalle: { fontSize: 12, color: colores.textoSecundario, marginTop: 4 },
  });
}
