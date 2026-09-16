import { useEffect, useRef, useState } from "react";
import type { AreaImpresion, ConfigTicket, EstiloTexto, Sucursal } from "@hangar421/shared";
import { CONFIG_TICKET_DEFAULT } from "@hangar421/shared";
import { apiFetch } from "../../api/http";
import { useAuthStore } from "../../store/authStore";
import { generarHtmlComanda, generarHtmlTicketCliente, recorteTicket, type ItemTicket } from "../../lib/ticket";

const FUENTES = ["Courier New", "Trebuchet MS", "Arial", "Consolas", "Segoe UI", "Georgia"];

const ITEMS_DEMO: ItemTicket[] = [
  { cantidad: 2, nombre: "Tacos al pastor", precioTotal: 240 },
  { cantidad: 1, nombre: "Agua fresca", precioTotal: 35 },
  { cantidad: 2, nombre: "Churros", precioTotal: 100 },
];
const SUBTOTAL_DEMO = 375;
const IMPUESTO_DEMO = 60;
const TOTAL_DEMO = 435;

function BotonToggle({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: "10px 16px", background: activo ? "var(--h421-navy)" : "var(--h421-gray-50)", color: activo ? "#fff" : "var(--h421-black)" }}>
      {children}
    </button>
  );
}

/** Bloque de edición de un EstiloTexto (fuente + tamaño + negrita/cursiva/subrayado) — se repite
 *  idéntico para cada sección del ticket (encabezado, fecha/hora/mesa, cuerpo, totales, pie). */
function EditorEstilo({ titulo, estilo, onCambiar }: { titulo: string; estilo: EstiloTexto; onCambiar: (e: EstiloTexto) => void }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h4 style={{ marginTop: 0 }}>{titulo}</h4>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <select value={estilo.fuente} onChange={(e) => onCambiar({ ...estilo, fuente: e.target.value })}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
          {FUENTES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input type="range" min={9} max={28} value={estilo.tamano} onChange={(e) => onCambiar({ ...estilo, tamano: Number(e.target.value) })} style={{ width: 120 }} />
        <span style={{ fontSize: 13, color: "var(--h421-gray-400)", width: 34 }}>{estilo.tamano}px</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onCambiar({ ...estilo, negrita: !estilo.negrita })} style={{ fontWeight: 800, background: estilo.negrita ? "var(--h421-navy)" : "var(--h421-gray-50)", color: estilo.negrita ? "#fff" : "var(--h421-black)", width: 40 }}>B</button>
        <button onClick={() => onCambiar({ ...estilo, cursiva: !estilo.cursiva })} style={{ fontStyle: "italic", background: estilo.cursiva ? "var(--h421-navy)" : "var(--h421-gray-50)", color: estilo.cursiva ? "#fff" : "var(--h421-black)", width: 40 }}>I</button>
        <button onClick={() => onCambiar({ ...estilo, subrayado: !estilo.subrayado })} style={{ textDecoration: "underline", background: estilo.subrayado ? "var(--h421-navy)" : "var(--h421-gray-50)", color: estilo.subrayado ? "#fff" : "var(--h421-black)", width: 40 }}>U</button>
      </div>
    </div>
  );
}

export function AdminTicket() {
  const { usuario: usuarioSesion } = useAuthStore();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState("");
  const [empresa, setEmpresa] = useState<{ nombre: string; logoUrl: string | null } | null>(null);

  const [config, setConfig] = useState<ConfigTicket>(CONFIG_TICKET_DEFAULT);
  const [pestana, setPestana] = useState<"cliente" | "comanda">("cliente");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [impresoras, setImpresoras] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([]);
  const [impresoraRecibos, setImpresoraRecibos] = useState("");
  const [impresoraCocina, setImpresoraCocina] = useState("");

  const [areas, setAreas] = useState<AreaImpresion[]>([]);
  const [nuevaArea, setNuevaArea] = useState("");

  const inputLogoRef = useRef<HTMLInputElement>(null);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [logoDimensiones, setLogoDimensiones] = useState<{ ancho: number; alto: number } | null>(null);

  // El logotipo se sube en cualquier tamaño/proporción — el software lo ajusta solo (ver
  // .logo en lib/ticket.ts, con max-width/max-height y object-fit:contain) para que siempre
  // quepa arriba del ticket sin deformarse; aquí solo se informan sus medidas originales.
  useEffect(() => {
    if (!empresa?.logoUrl) { setLogoDimensiones(null); return; }
    const img = new Image();
    img.onload = () => setLogoDimensiones({ ancho: img.naturalWidth, alto: img.naturalHeight });
    img.onerror = () => setLogoDimensiones(null);
    img.src = empresa.logoUrl;
  }, [empresa?.logoUrl]);

  async function subirLogotipo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo || !usuarioSesion) return;
    setSubiendoLogo(true);
    setMensaje(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => resolve(lector.result as string);
        lector.onerror = () => reject(lector.error);
        lector.readAsDataURL(archivo);
      });
      await apiFetch(`/empresas/${usuarioSesion.empresaId}`, { method: "PUT", body: JSON.stringify({ logoUrl: dataUrl }) });
      setEmpresa((emp) => (emp ? { ...emp, logoUrl: dataUrl } : emp));
    } catch (e: any) {
      setMensaje(e.message ?? "No se pudo subir el logotipo");
    } finally {
      setSubiendoLogo(false);
    }
  }

  async function quitarLogotipo() {
    if (!usuarioSesion) return;
    await apiFetch(`/empresas/${usuarioSesion.empresaId}`, { method: "PUT", body: JSON.stringify({ logoUrl: null }) });
    setEmpresa((emp) => (emp ? { ...emp, logoUrl: null } : emp));
  }

  async function cargarImpresoras() {
    const lista = await window.hangar.impresion.listar();
    setImpresoras(lista);
  }

  async function cargarAreas(empresaId: string) {
    const lista = await apiFetch<AreaImpresion[]>(`/areas-impresion?empresaId=${empresaId}`);
    setAreas(lista);
  }

  async function cargarSucursal(id: string) {
    const s = await apiFetch<Sucursal & { configJson?: { ticket?: ConfigTicket } }>(`/sucursales/${id}`);
    setConfig({ ...CONFIG_TICKET_DEFAULT, ...s.configJson?.ticket });
  }

  useEffect(() => {
    if (!usuarioSesion) return;
    (async () => {
      const [s, emp] = await Promise.all([
        apiFetch<Sucursal[]>(`/sucursales?empresaId=${usuarioSesion.empresaId}`),
        apiFetch<{ nombre: string; logoUrl: string | null }>(`/empresas/${usuarioSesion.empresaId}`),
      ]);
      setSucursales(s);
      setEmpresa(emp);
      if (s[0]) { setSucursalId(s[0].id); cargarSucursal(s[0].id); }
      cargarAreas(usuarioSesion.empresaId);
      cargarImpresoras();
      setImpresoraRecibos((await window.hangar.config.obtener("impresora_recibos")) ?? "");
      setImpresoraCocina((await window.hangar.config.obtener("impresora_cocina")) ?? "");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioSesion]);

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    try {
      await apiFetch(`/sucursales/${sucursalId}/config-ticket`, { method: "PUT", body: JSON.stringify(config) });
      setMensaje("Plantilla guardada.");
    } catch (e: any) {
      setMensaje(e.message ?? "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function elegirImpresoraRecibos(nombre: string) {
    setImpresoraRecibos(nombre);
    await window.hangar.config.guardar("impresora_recibos", nombre);
  }

  async function elegirImpresoraCocina(nombre: string) {
    setImpresoraCocina(nombre);
    await window.hangar.config.guardar("impresora_cocina", nombre);
  }

  async function agregarArea() {
    if (!usuarioSesion || !nuevaArea.trim()) return;
    await apiFetch("/areas-impresion", { method: "POST", body: JSON.stringify({ empresaId: usuarioSesion.empresaId, nombre: nuevaArea.trim() }) });
    setNuevaArea("");
    cargarAreas(usuarioSesion.empresaId);
  }

  async function eliminarArea(id: string) {
    await apiFetch(`/areas-impresion/${id}`, { method: "DELETE" });
    setAreas((a) => a.filter((x) => x.id !== id));
  }

  const sucursalActual = sucursales.find((s) => s.id === sucursalId);
  // Ancho real de la vista previa — simula el papel físico (58/80mm), no el ancho de la
  // columna: antes el iframe se estiraba a "width:100%" del panel, viéndose como una hoja de
  // oficina en vez de un ticket angosto.
  const anchoPreviewPx = config.anchoImpresoraMM === 58 ? 260 : 340;

  const htmlCliente = generarHtmlTicketCliente(config, {
    empresaNombre: empresa?.nombre ?? "",
    sucursalNombre: sucursalActual?.nombre ?? "",
    logoUrl: empresa?.logoUrl,
    mesaNombre: "T4",
    meseroNombre: "Ana Torres",
    folio: "000842",
    fecha: new Date(),
    items: ITEMS_DEMO,
    subtotal: SUBTOTAL_DEMO,
    impuesto: IMPUESTO_DEMO,
    total: TOTAL_DEMO,
  });

  const htmlComanda = generarHtmlComanda(config, {
    mesaNombre: "T4",
    fecha: new Date(),
    items: ITEMS_DEMO,
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Ticket</h2>
        <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); cargarSucursal(e.target.value); }} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {mensaje && <p style={{ color: "var(--h421-navy-texto)" }}>{mensaje}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 20, marginTop: 12 }}>
        {/* --- Columna izquierda: controles --- */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h4 style={{ marginTop: 0 }}>Ancho de impresora</h4>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <BotonToggle activo={config.anchoImpresoraMM === 58} onClick={() => setConfig((c) => ({ ...c, anchoImpresoraMM: 58 }))}>58 mm</BotonToggle>
              <BotonToggle activo={config.anchoImpresoraMM === 80} onClick={() => setConfig((c) => ({ ...c, anchoImpresoraMM: 80 }))}>80 mm</BotonToggle>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, marginBottom: 14 }}>
              <input type="checkbox" checked={config.mostrarLogo} onChange={(e) => setConfig((c) => ({ ...c, mostrarLogo: e.target.checked }))} />
              Mostrar logotipo en el ticket
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: 8, border: "1px dashed var(--h421-gray-200)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                {empresa?.logoUrl
                  ? <img src={empresa.logoUrl} alt="Logotipo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
                  : <span style={{ fontSize: 11, color: "var(--h421-gray-400)", textAlign: "center" }}>Sin logo</span>}
              </div>
              <div>
                <input ref={inputLogoRef} type="file" accept="image/*" onChange={subirLogotipo} style={{ display: "none" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => inputLogoRef.current?.click()} disabled={subiendoLogo} style={{ background: "var(--h421-navy)", color: "#fff", padding: "8px 14px" }}>
                    {subiendoLogo ? "Subiendo…" : "Subir logotipo"}
                  </button>
                  {empresa?.logoUrl && (
                    <button onClick={quitarLogotipo} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "8px 14px" }}>Quitar</button>
                  )}
                </div>
                {logoDimensiones && (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--h421-gray-400)" }}>
                    Medidas originales: {logoDimensiones.ancho} × {logoDimensiones.alto} px — se ajusta solo al tamaño del ticket, sin deformarse.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h4 style={{ marginTop: 0 }}>¿Qué quieres modificar?</h4>
            <div style={{ display: "flex", gap: 10 }}>
              <BotonToggle activo={pestana === "cliente"} onClick={() => setPestana("cliente")}>Ticket cliente</BotonToggle>
              <BotonToggle activo={pestana === "comanda"} onClick={() => setPestana("comanda")}>Comanda</BotonToggle>
            </div>
          </div>

          {pestana === "cliente" ? (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ marginTop: 0 }}>Encabezado</h4>
                <input placeholder={empresa?.nombre || "Nombre del negocio"} value={config.cliente.encabezadoLinea1}
                  onChange={(e) => setConfig((c) => ({ ...c, cliente: { ...c.cliente, encabezadoLinea1: e.target.value } }))}
                  style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <input placeholder={sucursalActual?.nombre || "Sucursal"} value={config.cliente.encabezadoLinea2}
                  onChange={(e) => setConfig((c) => ({ ...c, cliente: { ...c.cliente, encabezadoLinea2: e.target.value } }))}
                  style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <EditorEstiloInline estilo={config.cliente.estiloEncabezado} onCambiar={(e) => setConfig((c) => ({ ...c, cliente: { ...c.cliente, estiloEncabezado: e } }))} />
              </div>

              <EditorEstilo titulo="Fecha, hora y mesa" estilo={config.cliente.estiloFechaHoraMesa}
                onCambiar={(e) => setConfig((c) => ({ ...c, cliente: { ...c.cliente, estiloFechaHoraMesa: e } }))} />

              <EditorEstilo titulo="Cuerpo del ticket (orden)" estilo={config.cliente.estiloCuerpo}
                onCambiar={(e) => setConfig((c) => ({ ...c, cliente: { ...c.cliente, estiloCuerpo: e } }))} />

              <EditorEstilo titulo="Subtotal, IVA y total" estilo={config.cliente.estiloTotales}
                onCambiar={(e) => setConfig((c) => ({ ...c, cliente: { ...c.cliente, estiloTotales: e } }))} />

              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ marginTop: 0 }}>Pie de página</h4>
                <input placeholder="¡Gracias por su visita!" value={config.cliente.pieLinea1}
                  onChange={(e) => setConfig((c) => ({ ...c, cliente: { ...c.cliente, pieLinea1: e.target.value } }))}
                  style={{ width: "100%", padding: 10, marginBottom: 8, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <input placeholder="Línea adicional (ej. RFC, redes sociales, WiFi)" value={config.cliente.pieLinea2}
                  onChange={(e) => setConfig((c) => ({ ...c, cliente: { ...c.cliente, pieLinea2: e.target.value } }))}
                  style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <EditorEstiloInline estilo={config.cliente.estiloPie} onCambiar={(e) => setConfig((c) => ({ ...c, cliente: { ...c.cliente, estiloPie: e } }))} />
              </div>
            </>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <h4 style={{ marginTop: 0 }}>Título de la comanda</h4>
                <input value={config.comanda.titulo} onChange={(e) => setConfig((c) => ({ ...c, comanda: { ...c.comanda, titulo: e.target.value } }))}
                  style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
                <EditorEstiloInline estilo={config.comanda.estiloEncabezado} onCambiar={(e) => setConfig((c) => ({ ...c, comanda: { ...c.comanda, estiloEncabezado: e } }))} />
              </div>

              <EditorEstilo titulo="Cuerpo de la comanda (productos)" estilo={config.comanda.estiloCuerpo}
                onCambiar={(e) => setConfig((c) => ({ ...c, comanda: { ...c.comanda, estiloCuerpo: e } }))} />
            </>
          )}

          <button onClick={guardar} disabled={guardando || !sucursalId} style={{ width: "100%", background: "var(--h421-green)", color: "#fff", padding: "12px 16px", fontSize: 15 }}>
            {guardando ? "Guardando…" : "Guardar plantilla"}
          </button>
        </div>

        {/* --- Columna derecha: vista previa + impresoras + áreas --- */}
        <div>
          <p style={{ fontSize: 13, color: "var(--h421-gray-400)", marginBottom: 6 }}>Vista previa · Ticket cliente</p>
          <div className="ticket-paper" style={{ width: anchoPreviewPx, margin: "0 0 16px", clipPath: recorteTicket() }}>
            <iframe title="preview-cliente" srcDoc={htmlCliente} style={{ width: "100%", height: 420, border: "none", background: "#fff", display: "block" }} />
          </div>

          <p style={{ fontSize: 13, color: "var(--h421-gray-400)", marginBottom: 6 }}>Vista previa · Comanda</p>
          <div className="ticket-paper" style={{ width: anchoPreviewPx, margin: "0 0 16px", clipPath: recorteTicket() }}>
            <iframe title="preview-comanda" srcDoc={htmlComanda} style={{ width: "100%", height: 260, border: "none", background: "#fff", display: "block" }} />
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Impresión de recibos</h4>
              <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, background: impresoras.length > 0 ? "var(--h421-green-bg,#dcfce7)" : "var(--h421-red-bg)", color: impresoras.length > 0 ? "var(--h421-green)" : "var(--h421-red-texto)" }}>
                {impresoras.length > 0 ? `${impresoras.length} impresora(s) detectada(s)` : "Sin impresoras detectadas"}
              </span>
            </div>
            <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>
              Se imprime directo a la impresora que elijas aquí, sin abrir ningún diálogo (usa la impresión nativa de Windows, no requiere instalar nada).
              Sin una impresora asignada, se usa el diálogo normal del sistema.
            </p>

            <label style={{ fontSize: 13, color: "var(--h421-gray-600)" }}>Impresora de recibos</label>
            <div style={{ display: "flex", gap: 8, marginTop: 4, marginBottom: 14 }}>
              <select value={impresoraRecibos} onChange={(e) => elegirImpresoraRecibos(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
                <option value="">Sin asignar (usar diálogo del sistema)</option>
                {impresoras.map((p) => <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? " (predeterminada)" : ""}</option>)}
              </select>
              <button onClick={cargarImpresoras} style={{ background: "var(--h421-navy)", color: "#fff", padding: "0 16px" }}>Buscar impresoras</button>
            </div>

            <label style={{ fontSize: 13, color: "var(--h421-gray-600)" }}>Impresora de cocina (comandas, sin precios)</label>
            <select value={impresoraCocina} onChange={(e) => elegirImpresoraCocina(e.target.value)} style={{ width: "100%", padding: 10, marginTop: 4, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
              <option value="">Sin asignar (no imprime comanda)</option>
              {impresoras.map((p) => <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? " (predeterminada)" : ""}</option>)}
            </select>
            <p style={{ fontSize: 12, color: "var(--h421-gray-400)", marginTop: 6 }}>
              Al enviar un pedido a cocina o cobrarlo desde este equipo, se imprime aquí un ticket con producto y cantidad (sin precio).
            </p>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Áreas de impresión</h4>
            </div>
            <p style={{ fontSize: 13, color: "var(--h421-gray-400)" }}>Estas áreas agrupan productos por estación (cocina, barra, etc.), solo para catalogar el menú.</p>
            {areas.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--h421-gray-200)" }}>
                <strong>{a.nombre}</strong>
                <button onClick={() => eliminarArea(a.id)} style={{ background: "var(--h421-red-bg)", color: "var(--h421-red-texto)", padding: "4px 10px", fontSize: 12 }}>Eliminar</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input placeholder="Nombre del área (ej. Barra)" value={nuevaArea} onChange={(e) => setNuevaArea(e.target.value)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }} />
              <button onClick={agregarArea} style={{ background: "var(--h421-navy)", color: "#fff", padding: "0 16px" }}>+ Agregar área</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Igual que EditorEstilo pero sin su propio <div className="card"> — para incrustarlo dentro
 *  de la tarjeta de Encabezado/Pie, que ya trae sus campos de texto arriba. */
function EditorEstiloInline({ estilo, onCambiar }: { estilo: EstiloTexto; onCambiar: (e: EstiloTexto) => void }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <select value={estilo.fuente} onChange={(e) => onCambiar({ ...estilo, fuente: e.target.value })}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--h421-gray-200)" }}>
          {FUENTES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input type="range" min={9} max={28} value={estilo.tamano} onChange={(e) => onCambiar({ ...estilo, tamano: Number(e.target.value) })} style={{ width: 120 }} />
        <span style={{ fontSize: 13, color: "var(--h421-gray-400)", width: 34 }}>{estilo.tamano}px</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onCambiar({ ...estilo, negrita: !estilo.negrita })} style={{ fontWeight: 800, background: estilo.negrita ? "var(--h421-navy)" : "var(--h421-gray-50)", color: estilo.negrita ? "#fff" : "var(--h421-black)", width: 40 }}>B</button>
        <button onClick={() => onCambiar({ ...estilo, cursiva: !estilo.cursiva })} style={{ fontStyle: "italic", background: estilo.cursiva ? "var(--h421-navy)" : "var(--h421-gray-50)", color: estilo.cursiva ? "#fff" : "var(--h421-black)", width: 40 }}>I</button>
        <button onClick={() => onCambiar({ ...estilo, subrayado: !estilo.subrayado })} style={{ textDecoration: "underline", background: estilo.subrayado ? "var(--h421-navy)" : "var(--h421-gray-50)", color: estilo.subrayado ? "#fff" : "var(--h421-black)", width: 40 }}>U</button>
      </div>
    </div>
  );
}
