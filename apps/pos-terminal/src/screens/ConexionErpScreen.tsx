import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { RolUsuario, TipoDispositivo, type AccesoSucursal, type JwtPayload, type LoginResponse } from "@hangar421/shared";
import { ErrorErp, erpFetch, guardarTokensErp, obtenerErpBaseUrl } from "../api/erpHttp";
import { decodificarJwt } from "../auth/jwt";
import { abrirBaseDeDatos } from "../db/database";
import { guardarSucursalErp, guardarEmpresaErp, obtenerOCrearDispositivoId } from "../db/dispositivoLocal";
import { refrescarCatalogo, ejecutarPull } from "../sync/pullEngine";
import { obtenerDatosFiscales } from "../db/configFiscalRepo";
import { usarColores } from "../store/temaStore";

interface SesionErp {
  empresaId: string;
  rol: RolUsuario | undefined;
  /** Sucursales a las que este usuario puede entrar, con nombre — lo que pinta el selector. */
  sucursales: AccesoSucursal[];
  /** true si ya hay tokens válidos: se cambia de sucursal con switch-sucursal en vez de
   *  reintentar el login (el caso de un ADMIN_CORPORATIVO, al que el backend le resuelve una
   *  sucursal por defecto sin preguntar). */
  conTokens: boolean;
}

/** Conexión opcional con el ERP — NUNCA se pide en el flujo de venta, solo aquí. Login real
 *  (email/contraseña, POST /auth/login). Si la cuenta tiene acceso a varias sucursales se
 *  muestra un selector con sus NOMBRES; antes había que teclear el UUID de la sucursal a mano,
 *  y para las cuentas no corporativas esa pantalla era además inalcanzable (el login fallaba
 *  con 400 antes de llegar a ella).
 *
 *  Hay dos caminos para llegar al selector, según lo que haga el backend:
 *   - Cuenta NO corporativa con varias sucursales: el login devuelve 400 SUCURSAL_REQUERIDA con
 *     la lista. No hay tokens todavía, así que al elegir se repite el login con `sucursalId`.
 *   - ADMIN_CORPORATIVO: el login sí entra y resuelve una sucursal por defecto. Se muestra igual
 *     el selector (esa elección por defecto es arbitraria y esta terminal tiene que quedar
 *     ligada a la sucursal correcta) y al elegir se usa POST /auth/switch-sucursal.
 *
 *  Además puede crear una sucursal NUEVA e independiente (POST /sucursales, solo
 *  ADMIN_CORPORATIVO), que es lo que registra este Punto de Venta como su propia sucursal. */
export function ConexionErpScreen({ onConectado, onCerrar }: { onConectado: () => void; onCerrar: () => void }) {
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [conectando, setConectando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sesion, setSesion] = useState<SesionErp | null>(null);
  const [nombreSucursalNueva, setNombreSucursalNueva] = useState("");
  const [tasaImpuestoNueva, setTasaImpuestoNueva] = useState("0.16");
  const [servidorErp, setServidorErp] = useState("");

  /** Código por defecto: es el camino normal para enlazar una terminal. El login con correo y
   *  contraseña queda como camino de administrador — hace falta para crear una sucursal nueva o
   *  para moverse entre sucursales, pero no debe ser lo primero que ve un cajero. */
  const [modo, setModo] = useState<"codigo" | "admin">("codigo");
  const [codigo, setCodigo] = useState("");

  useEffect(() => {
    obtenerErpBaseUrl().then(setServidorErp);
  }, []);

  async function finalizarConexion(sucursalId: string, empresaId: string, nombre?: string) {
    const db = await abrirBaseDeDatos();
    // Repunta a esta sucursal lo que se haya registrado antes de enlazar (ver dispositivoLocal).
    await guardarSucursalErp(db, sucursalId, nombre);
    await guardarEmpresaErp(db, empresaId);
    await refrescarCatalogo().catch(() => undefined); // best-effort, no bloquea la conexión
    await ejecutarPull().catch(() => undefined);
    onConectado();
  }

  /** Mensaje de error legible. Distingue explícitamente el fallo de red del de permisos: son dos
   *  problemas distintos y el usuario actúa distinto ante cada uno (esperar/revisar el wifi vs.
   *  pedirle acceso a un administrador). */
  function describirError(e: any, porDefecto: string): string {
    if (e instanceof ErrorErp) {
      // El backend responde lo mismo para código inexistente, ya usado y caducado (a propósito:
      // distinguirlos ayudaría a quien prueba códigos al azar). Aquí se traduce a algo que el
      // cajero pueda accionar sin saber cuál de los tres fue.
      if (e.status === 401 && modo === "codigo") {
        return "Ese código no sirve: puede haber caducado, o alguien ya lo usó. Pídele uno nuevo al administrador.";
      }
      if (e.status === 429) return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
      if (e.status === 401 || e.status === 403) return "Tu usuario no tiene acceso a esa sucursal. Pídeselo a un administrador.";
      return e.message;
    }
    if (typeof e?.message === "string" && /network|timeout|Network request failed/i.test(e.message)) {
      return "Sin conexión con el ERP. Revisa la red e inténtalo de nuevo — el Punto de Venta sigue funcionando sin esto.";
    }
    return e?.message ?? porDefecto;
  }

  /** Canjea el código de vinculación. Es el único camino que NO pide credenciales: el código lo
   *  genera un admin en el ERP, sirve una sola vez y caduca a los 15 minutos — por eso puede
   *  teclearlo un cajero sin que el dispositivo guarde jamás una contraseña. */
  async function vincularConCodigo() {
    const limpio = codigo.trim().toUpperCase().replace(/[\s-]/g, "");
    if (limpio.length < 8) return;
    setError(null);
    setConectando(true);
    try {
      const db = await abrirBaseDeDatos();
      const dispositivoId = await obtenerOCrearDispositivoId(db);
      const datosFiscales = await obtenerDatosFiscales(db);
      const resp = await erpFetch<{ sucursalId: string; sucursal: string; empresaId: string; accessToken: string; refreshToken: string }>(
        "/auth/vincular-dispositivo",
        {
          method: "POST",
          body: JSON.stringify({
            codigo: limpio,
            dispositivoId,
            nombreDispositivo: datosFiscales.nombreSucursalLocal || undefined,
          }),
        },
      );
      await guardarTokensErp(resp.accessToken, resp.refreshToken);
      await finalizarConexion(resp.sucursalId, resp.empresaId, resp.sucursal);
    } catch (e: any) {
      setError(describirError(e, "No se pudo enlazar la terminal"));
    } finally {
      setConectando(false);
    }
  }

  async function entrar(sucursalId?: string) {
    if (!email.trim() || !password) return;
    setError(null);
    setConectando(true);
    try {
      const db = await abrirBaseDeDatos();
      const dispositivoId = await obtenerOCrearDispositivoId(db);
      const resp = await erpFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password, dispositivoId, sucursalId }),
      });
      await guardarTokensErp(resp.accessToken, resp.refreshToken);
      const payload = decodificarJwt<JwtPayload>(resp.accessToken);
      const sucursales = resp.usuario.sucursales ?? [];

      // Con una sola sucursal no hay nada que elegir; con varias, la que resolvió el backend es
      // arbitraria y esta terminal debe quedar ligada a la correcta.
      if (payload.sucursalId && (sucursalId || sucursales.length <= 1)) {
        const activa = sucursales.find((s) => s.sucursalId === payload.sucursalId);
        await finalizarConexion(payload.sucursalId, resp.usuario.empresaId, activa?.nombre);
        return;
      }

      setSesion({ empresaId: resp.usuario.empresaId, rol: payload.rol, sucursales, conTokens: true });
    } catch (e: any) {
      // El backend no emite token cuando hay varias sucursales sin elegir, pero sí manda la
      // lista en el error — es la única forma de poblar el selector en ese punto.
      if (e instanceof ErrorErp && e.codigo === "SUCURSAL_REQUERIDA") {
        setSesion({ empresaId: "", rol: undefined, sucursales: e.cuerpo?.sucursales ?? [], conTokens: false });
        return;
      }
      setError(describirError(e, "No se pudo conectar con el ERP"));
    } finally {
      setConectando(false);
    }
  }

  async function elegirSucursal(acceso: AccesoSucursal) {
    setError(null);
    // Sin tokens todavía: se repite el login indicando ya la sucursal.
    if (!sesion?.conTokens) {
      await entrar(acceso.sucursalId);
      return;
    }
    setConectando(true);
    try {
      const resp = await erpFetch<LoginResponse>("/auth/switch-sucursal", {
        method: "POST",
        body: JSON.stringify({ sucursalId: acceso.sucursalId }),
      });
      await guardarTokensErp(resp.accessToken, resp.refreshToken);
      await finalizarConexion(acceso.sucursalId, resp.usuario.empresaId, acceso.nombre);
    } catch (e: any) {
      setError(describirError(e, "No se pudo cambiar de sucursal"));
    } finally {
      setConectando(false);
    }
  }

  async function crearSucursalNueva() {
    if (!sesion || !nombreSucursalNueva.trim()) return;
    setError(null);
    setConectando(true);
    try {
      const nueva = await erpFetch<{ id: string }>("/sucursales", {
        method: "POST",
        body: JSON.stringify({ empresaId: sesion.empresaId, nombre: nombreSucursalNueva.trim(), tasaImpuesto: Number(tasaImpuestoNueva) || 0.16 }),
      });
      const db = await abrirBaseDeDatos();
      const dispositivoId = await obtenerOCrearDispositivoId(db);
      const datosFiscales = await obtenerDatosFiscales(db);
      await erpFetch(`/sucursales/${nueva.id}/dispositivos`, {
        method: "POST",
        body: JSON.stringify({ nombre: datosFiscales.nombreSucursalLocal || "Punto de Venta", tipo: TipoDispositivo.POS_TERMINAL, identificador: dispositivoId }),
      }).catch(() => undefined); // el registro es informativo — no bloquea la conexión si falla

      // La sucursal recién creada no está en la sesión actual: hay que reemitir el token para
      // que quede como sucursal activa, o SucursalAccessGuard rechazaría todo lo que venga
      // después (el catálogo, el pull, el drenado del outbox).
      await elegirSucursal({ sucursalId: nueva.id, nombre: nombreSucursalNueva.trim(), rol: RolUsuario.ADMIN_CORPORATIVO });
    } catch (e: any) {
      setError(describirError(e, "No se pudo crear la sucursal"));
    } finally {
      setConectando(false);
    }
  }

  if (sesion) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 20 }}>
        <View style={estilos.encabezado}>
          <Text style={estilos.titulo}>Elegir sucursal</Text>
          <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
        </View>
        <Text style={estilos.ayuda}>
          Esta terminal quedará ligada a la sucursal que elijas: sus ventas, su caja y sus usuarios
          se guardan por separado de las demás.
        </Text>

        {sesion.sucursales.length === 0 ? (
          <Text style={estilos.ayuda}>Tu usuario no tiene ninguna sucursal asignada. Pídele a un administrador que te dé acceso.</Text>
        ) : (
          sesion.sucursales.map((s) => (
            <TouchableOpacity key={s.sucursalId} onPress={() => elegirSucursal(s)} disabled={conectando} style={estilos.tarjetaSucursal}>
              <View style={{ flex: 1 }}>
                <Text style={estilos.nombreSucursal}>{s.nombre || s.sucursalId}</Text>
                <Text style={estilos.rolSucursal}>{etiquetaRol(s.rol)}</Text>
              </View>
              <Text style={estilos.flecha}>›</Text>
            </TouchableOpacity>
          ))
        )}

        {sesion.rol === RolUsuario.ADMIN_CORPORATIVO && (
          <>
            <Text style={estilos.subtitulo}>O crear una sucursal nueva e independiente</Text>
            <TextInput placeholder="Nombre de la sucursal" placeholderTextColor={colores.textoSecundario} value={nombreSucursalNueva} onChangeText={setNombreSucursalNueva} style={estilos.input} />
            <TextInput placeholder="Tasa de impuesto (ej. 0.16)" placeholderTextColor={colores.textoSecundario} value={tasaImpuestoNueva} onChangeText={setTasaImpuestoNueva} keyboardType="decimal-pad" style={estilos.input} />
            <TouchableOpacity onPress={crearSucursalNueva} disabled={conectando || !nombreSucursalNueva.trim()} style={estilos.boton}>
              <Text style={estilos.botonTexto}>{conectando ? "Creando…" : "Crear y enlazar"}</Text>
            </TouchableOpacity>
          </>
        )}

        {error && <Text style={estilos.error}>{error}</Text>}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colores.fondo }} contentContainerStyle={{ padding: 20 }}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Conectar con el ERP</Text>
        <TouchableOpacity onPress={onCerrar}><Text style={estilos.cerrar}>✕</Text></TouchableOpacity>
      </View>
      <Text style={estilos.ayuda}>
        Opcional — el Punto de Venta funciona completo sin esto. Conectarlo permite traer el catálogo real y
        mandar las ventas/turnos ya guardados al ERP en cuanto haya conexión.
      </Text>
      <View style={estilos.servidorBox}>
        <Text style={estilos.servidorEtiqueta}>Servidor (ya configurado)</Text>
        <Text style={estilos.servidorTexto} numberOfLines={1}>{servidorErp}</Text>
      </View>

      {modo === "codigo" ? (
        <>
          <Text style={estilos.subtitulo}>Código de vinculación</Text>
          <Text style={estilos.ayudaModo}>
            Pídeselo a un administrador: lo genera desde el ERP y te lo dicta. Sirve una sola vez y
            caduca a los 15 minutos. Esta terminal nunca guarda tu contraseña.
          </Text>
          <TextInput
            placeholder="ABCD-2345"
            placeholderTextColor={colores.textoSecundario}
            value={codigo}
            onChangeText={setCodigo}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            style={estilos.inputCodigo}
            accessibilityLabel="Código de vinculación"
          />

          {error && <Text style={estilos.error}>{error}</Text>}

          <TouchableOpacity
            onPress={vincularConCodigo}
            disabled={conectando || codigo.trim().replace(/[\s-]/g, "").length < 8}
            style={[estilos.boton, (conectando || codigo.trim().replace(/[\s-]/g, "").length < 8) && { opacity: 0.5 }]}
          >
            <Text style={estilos.botonTexto}>{conectando ? "Enlazando…" : "Enlazar terminal"}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => { setModo("admin"); setError(null); }} style={estilos.enlaceModo}>
            <Text style={estilos.enlaceModoTexto}>Soy administrador — entrar con correo y contraseña</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={estilos.subtitulo}>Acceso de administrador</Text>
          <Text style={estilos.ayudaModo}>
            Hace falta solo para crear una sucursal nueva o para mover esta terminal a otra. Para
            enlazarla sin más, usa un código de vinculación.
          </Text>
          <TextInput placeholder="Correo" placeholderTextColor={colores.textoSecundario} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={estilos.input} />
          <TextInput placeholder="Contraseña" placeholderTextColor={colores.textoSecundario} value={password} onChangeText={setPassword} secureTextEntry style={estilos.input} />

          {error && <Text style={estilos.error}>{error}</Text>}

          <TouchableOpacity onPress={() => entrar()} disabled={conectando || !email.trim() || !password} style={estilos.boton}>
            <Text style={estilos.botonTexto}>{conectando ? "Enlazando…" : "Entrar"}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => { setModo("codigo"); setError(null); }} style={estilos.enlaceModo}>
            <Text style={estilos.enlaceModoTexto}>← Enlazar con un código</Text>
          </TouchableOpacity>
        </>
      )}
      <Text style={estilos.notaPersistencia}>Solo se pide una vez por dispositivo — después queda enlazado hasta que cierres la conexión.</Text>
    </ScrollView>
  );
}

/** El rol viene de UsuarioSucursal, así que es el rol EN ESA sucursal — se muestra junto al
 *  nombre porque el mismo empleado puede entrar con permisos distintos a cada una. */
function etiquetaRol(rol: RolUsuario): string {
  const etiquetas: Record<string, string> = {
    [RolUsuario.ADMIN_CORPORATIVO]: "Administrador corporativo",
    [RolUsuario.ADMIN_SUCURSAL]: "Administrador de sucursal",
    [RolUsuario.SUPERVISOR]: "Supervisor",
    [RolUsuario.CAJERO]: "Cajero",
    [RolUsuario.MESERO]: "Mesero",
    [RolUsuario.COCINA]: "Cocina",
  };
  return etiquetas[rol] ?? rol;
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    encabezado: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    titulo: { fontSize: 20, fontWeight: "800", color: colores.texto },
    cerrar: { color: colores.textoSecundario, fontSize: 20 },
    ayuda: { fontSize: 13, color: colores.textoSecundario, marginTop: 8, marginBottom: 16, lineHeight: 18 },
    servidorBox: { backgroundColor: colores.gray50, borderRadius: 10, padding: 12, marginBottom: 16 },
    servidorEtiqueta: { fontSize: 11, color: colores.textoSecundario, fontWeight: "700", textTransform: "uppercase" },
    servidorTexto: { fontSize: 13, color: colores.texto, marginTop: 2 },
    notaPersistencia: { fontSize: 12, color: colores.textoSecundario, textAlign: "center", marginTop: 10 },
    subtitulo: { fontSize: 15, fontWeight: "800", color: colores.texto, marginTop: 18, marginBottom: 8 },
    input: { borderWidth: 1, borderColor: colores.borde, borderRadius: 10, padding: 14, marginBottom: 10, fontSize: 15, color: colores.texto },
    ayudaModo: { fontSize: 12, color: colores.textoSecundario, marginBottom: 12, lineHeight: 17 },
    // Grande, centrado y con espaciado entre letras: se teclea una vez, a menudo dictado en voz
    // alta, y conviene poder releerlo de un vistazo antes de confirmar.
    inputCodigo: {
      borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingVertical: 16, marginBottom: 10,
      fontSize: 26, letterSpacing: 4, textAlign: "center", fontWeight: "800", color: colores.texto,
    },
    enlaceModo: { paddingVertical: 14, alignItems: "center" },
    enlaceModoTexto: { color: colores.navyTexto, fontSize: 13, fontWeight: "600" },
    error: { color: colores.red, marginTop: 8, marginBottom: 4 },
    // minHeight 64: la fila entera es el área táctil, no solo el texto — se toca una vez y
    // decide a qué sucursal queda ligada la terminal.
    tarjetaSucursal: {
      flexDirection: "row", alignItems: "center", backgroundColor: colores.superficie, borderRadius: 12,
      borderWidth: 1, borderColor: colores.borde, padding: 16, marginBottom: 10, minHeight: 64,
    },
    nombreSucursal: { fontSize: 16, fontWeight: "700", color: colores.texto },
    rolSucursal: { fontSize: 12, color: colores.textoSecundario, marginTop: 2 },
    flecha: { fontSize: 22, color: colores.textoSecundario, marginLeft: 8 },
    boton: { backgroundColor: colores.green, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 10, minHeight: 52, justifyContent: "center" },
    botonTexto: { color: "#fff", fontWeight: "700", fontSize: 16 },
  });
}
