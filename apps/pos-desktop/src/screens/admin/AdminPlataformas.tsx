import { useEffect, useState } from "react";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";

type CodigoPlataforma = "didi" | "uber" | "rappi";
type Ambiente = "SANDBOX" | "PRODUCCION";
type EstadoConexion = "CONECTADA" | "DESCONECTADA" | "PENDIENTE_CONFIGURACION" | "ERROR";

interface PlataformaConfig {
  id: string | null;
  plataforma: string;
  nombreVisible: string;
  ambiente: Ambiente;
  activo: boolean;
  estadoConexion: EstadoConexion;
  identificadorTienda: string | null;
  credencialesUltimos4: string | null;
  clientSecretConfigurado: boolean;
  webhookUrl: string | null;
  ultimaSincronizacion: string | null;
  ultimoErrorMensaje: string | null;
  ultimoErrorEn: string | null;
  pedidosRecibidos: number;
  pedidosSincronizados: number;
}

interface ItemExterno {
  nombreExterno: string;
  cantidad: number;
  precioUnitario?: number;
  notas?: string;
}

interface PedidoEntrante {
  id: string;
  plataforma: string;
  nombreVisible: string;
  ordenExternaId: string;
  estado: string;
  clienteNombre: string | null;
  totalExterno: number | null;
  items: ItemExterno[];
  motivoError: string | null;
  pedidoId: string | null;
  createdAt: string;
}

interface ProductoCatalogo { id: string; nombre: string }
interface MapeoItem { productoId: string; cantidad: number; notas: string }

const ORDEN_PLATAFORMAS: CodigoPlataforma[] = ["didi", "uber", "rappi"];

// Mismo criterio que la página de Plataformas del CRM web (apps/crm-web) — sin cuenta de assets
// de cada marca, un emoji + color de acento alcanza para diferenciarlas. `campoPrincipal` debe
// coincidir con lo que cada adaptador del backend espera (ver
// apps/backend/src/plataformas/proveedores/*.adapter.ts -> validarConfiguracion()).
const INFO_PLATAFORMA: Record<CodigoPlataforma, { icono: string; acento: string; campoPrincipal: "apiKey" | "clientId"; etiquetaCampoPrincipal: string }> = {
  didi: { icono: "🛵", acento: "#FF7A00", campoPrincipal: "apiKey", etiquetaCampoPrincipal: "API Key / Client ID" },
  uber: { icono: "🚗", acento: "#06C167", campoPrincipal: "clientId", etiquetaCampoPrincipal: "Client ID" },
  rappi: { icono: "🐰", acento: "#FF441F", campoPrincipal: "clientId", etiquetaCampoPrincipal: "Client ID" },
};

const ETIQUETA_ESTADO: Record<EstadoConexion, { texto: string; color: string }> = {
  CONECTADA: { texto: "Conectada", color: "var(--h421-esmeralda)" },
  DESCONECTADA: { texto: "Desconectada", color: "var(--h421-gray-400)" },
  PENDIENTE_CONFIGURACION: { texto: "Pendiente de configuración", color: "var(--h421-amber-texto)" },
  ERROR: { texto: "Error", color: "var(--h421-red-texto)" },
};

const inputStyle = { width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" } as const;

function formatearFecha(iso: string | null): string {
  if (!iso) return "Sin sincronizar aún";
  return new Date(iso).toLocaleString("es-MX");
}

interface FormularioConfig {
  ambiente: Ambiente;
  identificadorTienda: string;
  activo: boolean;
  campoPrincipal: string;
  clientSecret: string;
}

function formularioVacio(): FormularioConfig {
  return { ambiente: "SANDBOX", identificadorTienda: "", activo: true, campoPrincipal: "", clientSecret: "" };
}

/** Administración > Plataformas: configuración de DiDi/Uber/Rappi (credenciales cifradas en el
 *  backend, nunca visibles aquí después de guardarlas) y bandeja de pedidos entrantes — mismos
 *  endpoints /plataformas/* que usa el CRM web (apps/crm-web/.../plataformas/page.tsx), solo que
 *  aquí la sucursal que acepta el pedido es siempre la de esta terminal (no hay selector: el POS
 *  ya sabe en qué sucursal está). */
export function AdminPlataformas() {
  const { usuario: usuarioSesion, sucursalId } = useAuthStore();
  const [plataformas, setPlataformas] = useState<PlataformaConfig[]>([]);
  const [cargando, setCargando] = useState(true);
  const [seleccionada, setSeleccionada] = useState<CodigoPlataforma>("didi");
  const [formulario, setFormulario] = useState<FormularioConfig>(formularioVacio());
  const [errores, setErrores] = useState<string[]>([]);
  const [mensaje, setMensaje] = useState<{ tipo: "exito" | "error"; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState<string | null>(null);
  const [desconectando, setDesconectando] = useState<string | null>(null);
  const [regenerando, setRegenerando] = useState<string | null>(null);

  const [pedidosEntrantes, setPedidosEntrantes] = useState<PedidoEntrante[]>([]);
  const [pedidoRevisando, setPedidoRevisando] = useState<PedidoEntrante | null>(null);
  const [productosSucursal, setProductosSucursal] = useState<ProductoCatalogo[]>([]);
  const [cargandoProductos, setCargandoProductos] = useState(false);
  const [mapeoItems, setMapeoItems] = useState<MapeoItem[]>([]);
  const [erroresPedido, setErroresPedido] = useState<string[]>([]);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [procesandoPedido, setProcesandoPedido] = useState(false);

  async function cargar() {
    if (!usuarioSesion) return;
    setCargando(true);
    try {
      const data = await apiFetch<PlataformaConfig[]>(`/plataformas/configuraciones?empresaId=${usuarioSesion.empresaId}`);
      setPlataformas(data);
    } catch (e: any) {
      setMensaje({ tipo: "error", texto: e.message ?? "No se pudieron cargar las plataformas" });
    } finally {
      setCargando(false);
    }
  }

  async function cargarPedidosEntrantes() {
    if (!usuarioSesion) return;
    try {
      const data = await apiFetch<PedidoEntrante[]>(`/plataformas/pedidos?empresaId=${usuarioSesion.empresaId}`);
      setPedidosEntrantes(data);
    } catch (e: any) {
      setMensaje({ tipo: "error", texto: e.message ?? "No se pudieron cargar los pedidos entrantes" });
    }
  }

  useEffect(() => {
    cargar();
    cargarPedidosEntrantes();
    if (sucursalId) cargarProductos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioSesion]);

  async function cargarProductos() {
    if (!usuarioSesion || !sucursalId) return;
    setCargandoProductos(true);
    try {
      const data = await apiFetch<ProductoCatalogo[]>(`/catalogo/productos?empresaId=${usuarioSesion.empresaId}&sucursalId=${sucursalId}`);
      setProductosSucursal(data);
    } catch {
      setProductosSucursal([]);
    } finally {
      setCargandoProductos(false);
    }
  }

  function config(codigo: CodigoPlataforma): PlataformaConfig | undefined {
    return plataformas.find((p) => p.plataforma === codigo);
  }

  function seleccionar(codigo: CodigoPlataforma) {
    setSeleccionada(codigo);
    setErrores([]);
    setMensaje(null);
    const actual = config(codigo);
    setFormulario({
      ambiente: actual?.ambiente ?? "SANDBOX",
      identificadorTienda: actual?.identificadorTienda ?? "",
      activo: actual?.activo ?? true,
      // Las credenciales nunca se pre-llenan desde un valor enmascarado — se vuelven a escribir
      // completas en cada guardado (evita sobrescribir el secreto real con la máscara).
      campoPrincipal: "",
      clientSecret: "",
    });
  }

  useEffect(() => { seleccionar(seleccionada); }, [plataformas]); // eslint-disable-line react-hooks/exhaustive-deps

  function validar(): string[] {
    const info = INFO_PLATAFORMA[seleccionada];
    const problemas: string[] = [];
    if (!formulario.identificadorTienda.trim()) problemas.push("Falta el id de tienda/restaurante/sucursal.");
    if (!formulario.campoPrincipal.trim()) problemas.push(`Falta ${info.etiquetaCampoPrincipal}.`);
    if (!formulario.clientSecret.trim()) problemas.push("Falta el Client Secret.");
    return problemas;
  }

  async function guardar() {
    const problemas = validar();
    setErrores(problemas);
    setMensaje(null);
    if (problemas.length > 0) return;

    const info = INFO_PLATAFORMA[seleccionada];
    setGuardando(true);
    try {
      await apiFetch(`/plataformas/configuraciones/${seleccionada}`, {
        method: "POST",
        body: JSON.stringify({
          ambiente: formulario.ambiente,
          identificadorTienda: formulario.identificadorTienda.trim(),
          activo: formulario.activo,
          credenciales: { [info.campoPrincipal]: formulario.campoPrincipal.trim(), clientSecret: formulario.clientSecret.trim() },
        }),
      });
      setMensaje({ tipo: "exito", texto: "Configuración guardada — las credenciales quedaron cifradas en el servidor." });
      await cargar();
    } catch (e: any) {
      setMensaje({ tipo: "error", texto: e.message ?? "No se pudo guardar la configuración" });
    } finally {
      setGuardando(false);
    }
  }

  async function probarConexion(id: string) {
    setProbando(id);
    setMensaje(null);
    try {
      const r = await apiFetch<{ ok: boolean; detalle: string }>(`/plataformas/configuraciones/${id}/probar-conexion`, { method: "POST" });
      setMensaje({ tipo: r.ok ? "exito" : "error", texto: r.detalle });
      await cargar();
    } catch (e: any) {
      setMensaje({ tipo: "error", texto: e.message ?? "No se pudo probar la conexión" });
    } finally {
      setProbando(null);
    }
  }

  async function reconectar(id: string) {
    setProbando(id);
    setMensaje(null);
    try {
      const r = await apiFetch<{ ok: boolean; detalle: string }>(`/plataformas/configuraciones/${id}/reconectar`, { method: "POST" });
      setMensaje({ tipo: r.ok ? "exito" : "error", texto: r.detalle });
      await cargar();
    } catch (e: any) {
      setMensaje({ tipo: "error", texto: e.message ?? "No se pudo reconectar" });
    } finally {
      setProbando(null);
    }
  }

  async function desconectar(id: string, nombre: string) {
    if (!confirm(`¿Desconectar "${nombre}"? Dejará de recibir pedidos de esta plataforma hasta que la reconectes. Las credenciales guardadas no se borran.`)) return;
    setDesconectando(id);
    setMensaje(null);
    try {
      await apiFetch(`/plataformas/configuraciones/${id}/desconectar`, { method: "POST" });
      setMensaje({ tipo: "exito", texto: `"${nombre}" desconectada.` });
      await cargar();
    } catch (e: any) {
      setMensaje({ tipo: "error", texto: e.message ?? "No se pudo desconectar" });
    } finally {
      setDesconectando(null);
    }
  }

  async function regenerarWebhook(id: string) {
    if (!confirm("¿Regenerar la URL de webhook? La URL anterior dejará de funcionar — tendrás que actualizarla en el panel de la plataforma.")) return;
    setRegenerando(id);
    setMensaje(null);
    try {
      await apiFetch(`/plataformas/configuraciones/${id}/regenerar-webhook`, { method: "POST" });
      setMensaje({ tipo: "exito", texto: "URL de webhook regenerada." });
      await cargar();
    } catch (e: any) {
      setMensaje({ tipo: "error", texto: e.message ?? "No se pudo regenerar la URL" });
    } finally {
      setRegenerando(null);
    }
  }

  async function copiarWebhook(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMensaje({ tipo: "exito", texto: "URL de webhook copiada al portapapeles." });
    } catch {
      setMensaje({ tipo: "error", texto: "No se pudo copiar automáticamente — selecciona y copia la URL a mano." });
    }
  }

  function abrirRevision(pedido: PedidoEntrante) {
    setPedidoRevisando(pedido);
    setErroresPedido([]);
    setMotivoRechazo("");
    setMensaje(null);
    setMapeoItems(pedido.items.map((it) => ({ productoId: "", cantidad: it.cantidad, notas: "" })));
  }

  function actualizarMapeo(indice: number, cambios: Partial<MapeoItem>) {
    setMapeoItems((items) => items.map((it, i) => (i === indice ? { ...it, ...cambios } : it)));
  }

  async function aceptarPedidoEntrante() {
    if (!pedidoRevisando) return;
    if (!sucursalId) {
      setErroresPedido(["Esta sesión no tiene una sucursal activa — vuelve a iniciar sesión."]);
      return;
    }
    const problemas: string[] = [];
    mapeoItems.forEach((it, i) => {
      if (!it.productoId) problemas.push(`Falta elegir el producto real para "${pedidoRevisando.items[i]?.nombreExterno}".`);
      if (!it.cantidad || it.cantidad < 1) problemas.push(`Cantidad inválida para "${pedidoRevisando.items[i]?.nombreExterno}".`);
    });
    setErroresPedido(problemas);
    if (problemas.length > 0) return;

    setProcesandoPedido(true);
    try {
      await apiFetch(`/plataformas/pedidos/${pedidoRevisando.id}/aceptar`, {
        method: "POST",
        body: JSON.stringify({
          sucursalId,
          items: mapeoItems.map((it) => ({ productoId: it.productoId, cantidad: it.cantidad, notas: it.notas || undefined })),
        }),
      });
      setMensaje({ tipo: "exito", texto: "Pedido aceptado — ya se mandó a cocina como un pedido normal." });
      setPedidoRevisando(null);
      await Promise.all([cargarPedidosEntrantes(), cargar()]);
    } catch (e: any) {
      setMensaje({ tipo: "error", texto: e.message ?? "No se pudo aceptar el pedido" });
    } finally {
      setProcesandoPedido(false);
    }
  }

  async function rechazarPedidoEntrante() {
    if (!pedidoRevisando) return;
    if (!motivoRechazo.trim()) {
      setErroresPedido(["Escribe el motivo del rechazo."]);
      return;
    }
    if (!confirm(`¿Rechazar el pedido de ${pedidoRevisando.nombreVisible}? El cliente no será notificado automáticamente — avísale por el canal de la plataforma si corresponde.`)) return;

    setProcesandoPedido(true);
    try {
      await apiFetch(`/plataformas/pedidos/${pedidoRevisando.id}/rechazar`, {
        method: "POST",
        body: JSON.stringify({ motivo: motivoRechazo.trim() }),
      });
      setMensaje({ tipo: "exito", texto: "Pedido rechazado." });
      setPedidoRevisando(null);
      await cargarPedidosEntrantes();
    } catch (e: any) {
      setMensaje({ tipo: "error", texto: e.message ?? "No se pudo rechazar el pedido" });
    } finally {
      setProcesandoPedido(false);
    }
  }

  const actual = config(seleccionada);
  const infoActual = INFO_PLATAFORMA[seleccionada];
  const enVuelo = probando === actual?.id || desconectando === actual?.id || regenerando === actual?.id;

  return (
    <div>
      {mensaje && <p style={{ color: mensaje.tipo === "exito" ? "var(--h421-esmeralda)" : "var(--h421-red-texto)" }}>{mensaje.texto}</p>}
      {cargando && <p style={{ color: "var(--h421-gray-400)" }}>Cargando plataformas…</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 20 }}>
        {ORDEN_PLATAFORMAS.map((codigo) => {
          const c = config(codigo);
          const info = INFO_PLATAFORMA[codigo];
          const estado = ETIQUETA_ESTADO[c?.estadoConexion ?? "PENDIENTE_CONFIGURACION"];
          const sinActividad = !c || (c.pedidosRecibidos === 0 && c.pedidosSincronizados === 0);
          return (
            <button
              key={codigo}
              onClick={() => seleccionar(codigo)}
              style={{
                textAlign: "left", padding: 0, background: "none", minHeight: 0,
                border: seleccionada === codigo ? `2px solid ${info.acento}` : "2px solid transparent",
                borderRadius: 16,
              }}
            >
              <div className="card" style={{ borderTop: `4px solid ${info.acento}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div><span style={{ fontSize: 20 }}>{info.icono}</span> <strong>{c?.nombreVisible ?? codigo}</strong></div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: estado.color }}>{estado.texto}</span>
                </div>
                <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "8px 0 4px" }}>Última sync: {formatearFecha(c?.ultimaSincronizacion ?? null)}</p>
                <p style={{ fontSize: 13, margin: 0 }}>{sinActividad ? "Sin actividad todavía" : `${c?.pedidosRecibidos ?? 0} recibidos · ${c?.pedidosSincronizados ?? 0} sincronizados`}</p>
                {c?.ultimoErrorMensaje && <p style={{ fontSize: 12, color: "var(--h421-red-texto)", margin: "6px 0 0" }}>Error: {c.ultimoErrorMensaje}</p>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {ORDEN_PLATAFORMAS.map((codigo) => (
            <button
              key={codigo}
              onClick={() => seleccionar(codigo)}
              style={{
                background: seleccionada === codigo ? "var(--h421-navy)" : "var(--h421-gray-50)",
                color: seleccionada === codigo ? "#fff" : "var(--h421-black)",
                padding: "8px 14px", fontSize: 13,
              }}
            >
              {INFO_PLATAFORMA[codigo].icono} {config(codigo)?.nombreVisible ?? codigo}
            </button>
          ))}
        </div>

        {errores.length > 0 && (
          <div style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>Revisa lo siguiente:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>{errores.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          <div>
            <select value={formulario.ambiente} onChange={(e) => setFormulario((f) => ({ ...f, ambiente: e.target.value as Ambiente }))} style={inputStyle}>
              <option value="SANDBOX">Sandbox / Pruebas</option>
              <option value="PRODUCCION">Producción</option>
            </select>
            <input placeholder="Id de tienda / restaurante / sucursal en la plataforma" value={formulario.identificadorTienda}
              onChange={(e) => setFormulario((f) => ({ ...f, identificadorTienda: e.target.value }))} style={inputStyle} />
            <input placeholder={infoActual.etiquetaCampoPrincipal} value={formulario.campoPrincipal}
              onChange={(e) => setFormulario((f) => ({ ...f, campoPrincipal: e.target.value }))} style={inputStyle} />
            {actual?.credencialesUltimos4 && (
              <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "-4px 0 8px" }}>
                Guardado actualmente: •••• {actual.credencialesUltimos4} — escribe uno nuevo para reemplazarlo.
              </p>
            )}
            <input type="password" placeholder="Client Secret" value={formulario.clientSecret}
              onChange={(e) => setFormulario((f) => ({ ...f, clientSecret: e.target.value }))} style={inputStyle} />
            {actual?.clientSecretConfigurado && (
              <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "-4px 0 8px" }}>Client Secret configurado ✓</p>
            )}
            <button
              onClick={() => setFormulario((f) => ({ ...f, activo: !f.activo }))}
              style={{ background: formulario.activo ? "var(--h421-esmeralda)" : "var(--h421-gray-200)", color: formulario.activo ? "#fff" : "var(--h421-black)", padding: "8px 14px", fontSize: 13, marginBottom: 12 }}
            >
              {formulario.activo ? "Integración activa" : "Integración desactivada"} — clic para cambiar
            </button>
            <button onClick={guardar} disabled={guardando} style={{ width: "100%", background: "var(--h421-green)", color: "#fff", padding: "10px 16px" }}>
              {guardando ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>

          <div>
            <h4 style={{ marginTop: 0 }}>Webhook</h4>
            {actual?.id && actual.webhookUrl ? (
              <>
                <input readOnly value={actual.webhookUrl} style={{ ...inputStyle, color: "var(--h421-gray-400)" }} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  <button onClick={() => copiarWebhook(actual.webhookUrl!)} style={{ background: "var(--h421-gray-50)", padding: "8px 12px", fontSize: 13 }}>Copiar URL</button>
                  <button onClick={() => regenerarWebhook(actual.id!)} disabled={enVuelo} style={{ background: "var(--h421-amber-bg)", color: "var(--h421-amber-texto)", padding: "8px 12px", fontSize: 13 }}>
                    {regenerando === actual.id ? "Regenerando…" : "Regenerar URL"}
                  </button>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Guarda la configuración primero para obtener la URL de webhook.</p>
            )}

            <h4>Acciones</h4>
            {!actual?.id ? (
              <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Sin configuración guardada.</p>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => probarConexion(actual.id!)} disabled={enVuelo} style={{ background: "var(--h421-navy)", color: "#fff", padding: "8px 12px", fontSize: 13 }}>
                  {probando === actual.id ? "Probando…" : "Probar conexión"}
                </button>
                {actual.estadoConexion !== "CONECTADA" && (
                  <button onClick={() => reconectar(actual.id!)} disabled={enVuelo} style={{ background: "var(--h421-blue)", color: "#fff", padding: "8px 12px", fontSize: 13 }}>
                    {probando === actual.id ? "Reconectando…" : "Reconectar"}
                  </button>
                )}
                {actual.activo && (
                  <button onClick={() => desconectar(actual.id!, actual.nombreVisible)} disabled={enVuelo} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "8px 12px", fontSize: 13 }}>
                    {desconectando === actual.id ? "Desconectando…" : "Desconectar"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Pedidos entrantes</h3>
        <p style={{ color: "var(--h421-gray-400)", fontSize: 13, marginTop: -8 }}>
          Pedidos recibidos por webhook, pendientes de revisión. Al aceptar uno, eliges qué producto real corresponde a cada
          item de la plataforma y se crea un pedido normal para esta sucursal (va directo a cocina).
        </p>

        {pedidosEntrantes.length === 0 && <p style={{ color: "var(--h421-gray-400)", fontSize: 13 }}>Sin pedidos pendientes de revisión.</p>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {pedidosEntrantes.map((p) => (
            <div key={p.id} className="card" style={{ borderTop: `4px solid ${INFO_PLATAFORMA[p.plataforma as CodigoPlataforma]?.acento ?? "var(--h421-navy)"}` }}>
              <strong style={{ fontSize: 14 }}>{INFO_PLATAFORMA[p.plataforma as CodigoPlataforma]?.icono} {p.nombreVisible}</strong>
              <p style={{ fontSize: 12, color: "var(--h421-gray-400)", margin: "6px 0" }}>Orden #{p.ordenExternaId}</p>
              <p style={{ fontSize: 13, margin: "0 0 4px" }}>{p.clienteNombre ?? "Cliente sin nombre"}</p>
              <p style={{ fontSize: 13, margin: "0 0 8px" }}>{p.items.length} producto(s){p.totalExterno ? ` · $${p.totalExterno.toFixed(2)}` : ""}</p>
              <button onClick={() => abrirRevision(p)} style={{ width: "100%", background: "var(--h421-navy)", color: "#fff", padding: "8px 12px", fontSize: 13 }}>Revisar pedido</button>
            </div>
          ))}
        </div>

        {pedidoRevisando && (
          <div className="card" style={{ marginTop: 16, border: "1px solid var(--h421-gray-200)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0 }}>{pedidoRevisando.nombreVisible} — Orden #{pedidoRevisando.ordenExternaId}</h4>
              <button onClick={() => setPedidoRevisando(null)} style={{ background: "none", color: "var(--h421-gray-400)", minHeight: 0 }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>
              {pedidoRevisando.clienteNombre ?? "Cliente sin nombre"}
              {pedidoRevisando.totalExterno ? ` · Total reportado: $${pedidoRevisando.totalExterno.toFixed(2)}` : ""}
            </p>

            {erroresPedido.length > 0 && (
              <div style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <strong style={{ fontSize: 13 }}>Revisa lo siguiente:</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>{erroresPedido.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--h421-gray-200)" }}>
                  <th style={{ padding: 6 }}>Como lo mandó {pedidoRevisando.nombreVisible}</th>
                  <th style={{ padding: 6 }}>Producto real</th>
                  <th style={{ padding: 6 }}>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {pedidoRevisando.items.map((item, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--h421-gray-200)" }}>
                    <td style={{ padding: 6 }}>{item.nombreExterno}</td>
                    <td style={{ padding: 6 }}>
                      <select value={mapeoItems[i]?.productoId ?? ""} onChange={(e) => actualizarMapeo(i, { productoId: e.target.value })}
                        disabled={cargandoProductos} style={{ padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)", width: "100%" }}>
                        <option value="">{cargandoProductos ? "Cargando catálogo…" : "Elige un producto…"}</option>
                        {productosSucursal.map((prod) => <option key={prod.id} value={prod.id}>{prod.nombre}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 6 }}>
                      <input type="number" min={1} value={mapeoItems[i]?.cantidad ?? 1}
                        onChange={(e) => actualizarMapeo(i, { cantidad: Number(e.target.value) })}
                        style={{ width: 64, padding: 6, borderRadius: 6, border: "1px solid var(--h421-gray-200)" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              <button onClick={aceptarPedidoEntrante} disabled={procesandoPedido} style={{ background: "var(--h421-green)", color: "#fff", padding: "8px 16px" }}>
                {procesandoPedido ? "Procesando…" : "Aceptar pedido y mandar a cocina"}
              </button>
            </div>

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--h421-gray-200)" }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Rechazar este pedido</label>
              <input placeholder="Motivo (ej. sin insumos suficientes)" value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} style={inputStyle} />
              <button onClick={rechazarPedidoEntrante} disabled={procesandoPedido} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "8px 16px" }}>
                Rechazar pedido
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
