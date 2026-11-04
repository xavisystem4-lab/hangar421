import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useCarritoStore } from "../store/carritoStore";
import { useAuthLocalStore } from "../store/authLocalStore";
import { solicitarAltaProducto } from "../db/solicitudesProductoRepo";
import { sincronizarPronto } from "../sync/syncEngine";
import { usarColores } from "../store/temaStore";
import { abrirBaseDeDatos } from "../db/database";
import { coincideBusqueda } from "../db/busqueda";
import { listarCategorias, listarProductos, modificadoresDeProducto, type CategoriaLocal, type ModificadorLocal, type ProductoLocal } from "../db/catalogoRepo";
import { ModalModificadores } from "../components/ModalModificadores";
import { ModalNombreCliente } from "../components/ModalNombreCliente";
import { esVentaDidi } from "../caja/origenVenta";
import { tiempoEsperando } from "../caja/enEspera";
import { listarPromociones } from "../db/promocionesRepo";
import { obtenerOCrearSucursalIdLocal } from "../db/dispositivoLocal";
import { precioDeVenta } from "../caja/promocionVenta";
import { coloresPorCategoria, conOpacidad } from "../caja/coloresCategoria";
import type { Promocion } from "@hangar421/shared";

/** Catálogo + carrito — lee/escribe SQLite local, nunca la red. El catálogo de HANGAR 421 se
 *  siembra en la base local en el primer arranque (ver db/catalogoHangar.ts), así que la
 *  pantalla tiene los mismos productos que el POS de Windows sin depender de ninguna conexión;
 *  se puede editar desde Admin → Catálogo, y si se enlaza el ERP el catálogo real lo reemplaza
 *  (ver catalogoSyncRepo.upsertCatalogo). */
export function PosVentaScreen({ onCobrar, categoriaSugerida }: { onCobrar: () => void; categoriaSugerida?: string | null }) {
  const { items, agregarItem, quitarItem, cambiarCantidad, totales, nombreCliente, nombrePreguntado, fijarNombreCliente, marcarNombrePreguntado, enEspera, ponerEnEspera, retomarEspera, descartarEspera } = useCarritoStore();
  const [pidiendoNombre, setPidiendoNombre] = useState(false);
  // Modal para apartar el pedido (cliente sin cambio, fue a su carro…) con nombre o descripción.
  const [apartando, setApartando] = useState(false);
  // Reloj para el "lleva 3 min esperando" de cada botón; solo corre si hay pedidos en espera.
  const [, setTic] = useState(0);
  useEffect(() => {
    if (enEspera.length === 0) return;
    const t = setInterval(() => setTic((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [enEspera.length]);
  const colores = usarColores();
  const estilos = crearEstilos(colores);
  const [categorias, setCategorias] = useState<CategoriaLocal[]>([]);
  const [productos, setProductos] = useState<ProductoLocal[]>([]);
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const usuario = useAuthLocalStore((s) => s.usuario);
  // Promociones (precios especiales) y sucursal de esta tablet: el precio con promoción se decide
  // al agregar el producto, con la hora de ese momento (ver caja/promocionVenta.ts).
  const [promociones, setPromociones] = useState<Promocion[]>([]);
  const [sucursalLocalId, setSucursalLocalId] = useState<string | null>(null);
  const [personalizando, setPersonalizando] = useState<{ producto: ProductoLocal; modificadores: ModificadorLocal[] } | null>(null);

  /** Un producto compuesto (café, combo) abre el modal; el resto entra directo al carrito, que
   *  es lo que mantiene ágil el cobro en barra. Si el producto dice que se personaliza pero no
   *  tiene modificadores cargados (catálogo a medio sincronizar), se agrega directo en vez de
   *  abrir un modal vacío que bloquearía la venta. */
  async function tocarProducto(producto: ProductoLocal) {
    if (producto.requierePersonalizacion) {
      const db = await abrirBaseDeDatos();
      const modificadores = await modificadoresDeProducto(db, producto.id);
      if (modificadores.length > 0) {
        setPersonalizando({ producto, modificadores });
        return;
      }
    }
    agregarItem({
      productoId: producto.id,
      nombreProducto: producto.nombre,
      categoria: nombrePorCategoria.get(producto.categoriaId),
      cantidad: 1,
      ...precioDeVenta(promociones, producto, new Date(), sucursalLocalId),
      modificadores: [],
    });
  }

  function pedirAlta() {
    const texto = busqueda.trim();
    Alert.alert(
      "Solicitar alta de producto",
      `Se avisará al administrador para que registre "${texto}". Mientras no esté en el catálogo no se puede vender.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Enviar solicitud",
          onPress: async () => {
            try {
              const db = await abrirBaseDeDatos();
              await solicitarAltaProducto(db, { texto, usuarioId: usuario?.id });
              sincronizarPronto();
              setBusqueda("");
              Alert.alert("Solicitud enviada", "El administrador la verá en el ERP. Si no hay conexión, sale en cuanto vuelva la red.");
            } catch (e: any) {
              Alert.alert("No se pudo registrar la solicitud", e?.message ?? "Inténtalo de nuevo");
            }
          },
        },
      ],
    );
  }

  async function cargar() {
    const db = await abrirBaseDeDatos();
    const [cats, prods, promos, sucursalId] = await Promise.all([listarCategorias(db), listarProductos(db), listarPromociones(db), obtenerOCrearSucursalIdLocal(db)]);
    setCategorias(cats);
    setProductos(prods);
    setPromociones(promos);
    setSucursalLocalId(sucursalId);
  }

  useEffect(() => {
    cargar();
  }, []);

  // Al llegar desde un aviso de DiDi (notificación de la app de DiDi en esta tablet) se abre
  // directo el grupo DIDI: el cajero captura los productos del pedido sin buscar la categoría.
  useEffect(() => {
    if (!categoriaSugerida || categorias.length === 0) return;
    const buscada = categoriaSugerida.toLowerCase();
    const cat = categorias.find((c) => c.nombre.toLowerCase().includes(buscada));
    if (cat) setCategoriaActiva(cat.id);
  }, [categoriaSugerida, categorias]);

  // Un pedido de DIDI se captura desde la tablet de DiDi y se entrega con el código de la app, no
  // con un nombre: ahí no se pregunta ni se ofrece ponerle nombre.
  const pedidoDidi = esVentaDidi(items.map((i) => i.categoria));

  // Pedido nuevo = primer producto en un carrito vacío: ahí se pregunta (una sola vez por pedido)
  // si se le pone nombre. Al cobrar o vaciar el carrito se reinicia y el siguiente pedido vuelve
  // a preguntar.
  useEffect(() => {
    if (items.length > 0 && !nombrePreguntado && !pedidoDidi) setPidiendoNombre(true);
  }, [items.length, nombrePreguntado, pedidoDidi]);

  const t = totales();
  const buscando = busqueda.trim().length > 0;
  const nombrePorCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.nombre])), [categorias]);
  // Un color vivo por categoría (azul rey = bebidas frías, rojo = calientes, café = postres…),
  // compartido por el botón de la categoría y las tarjetas de sus productos (ver coloresCategoria).
  const colorPorCategoria = useMemo(() => coloresPorCategoria(categorias), [categorias]);

  // Al buscar se ignora la categoría activa y se recorre TODO el catálogo — mismo criterio que
  // el autocompletado del POS de Windows: el cajero debe encontrar un producto aunque esté
  // parado en otra pestaña. La subcategoría entra en la búsqueda para que "galletas" liste las
  // tres de Domingo.
  const productosVisibles = useMemo(() => {
    const ordenCategoria = new Map(categorias.map((c) => [c.id, c.orden]));
    const filtrados = productos.filter((p) =>
      buscando
        ? coincideBusqueda(`${p.nombre} ${p.subcategoria ?? ""}`, busqueda)
        : !categoriaActiva || p.categoriaId === categoriaActiva,
    );
    return filtrados.sort(
      (a, b) =>
        (ordenCategoria.get(a.categoriaId) ?? 99) - (ordenCategoria.get(b.categoriaId) ?? 99) ||
        a.orden - b.orden ||
        a.nombre.localeCompare(b.nombre),
    );
  }, [productos, categorias, categoriaActiva, busqueda, buscando]);

  /** El catálogo real repite nombres con precios distintos ("Latte" frío 85 / caliente 70,
   *  "Pistache" galleta 80 / rol 155). Mientras se ve una sola categoría el nombre basta; en
   *  "Todas" y en los resultados de búsqueda hace falta el contexto o no se distinguen. */
  function etiquetaContexto(p: ProductoLocal): string | null {
    const categoria = buscando || !categoriaActiva ? nombrePorCategoria.get(p.categoriaId) ?? null : null;
    // DIDI repite nombres del menú con su subcategoría ("Latte" · Bebidas calientes a $49): fuera
    // de su pestaña hay que decir también de qué grupo es o se confunde con el del mostrador.
    if (p.subcategoria) return categoria && categoria !== p.subcategoria ? `${categoria} · ${p.subcategoria}` : p.subcategoria;
    return categoria;
  }

  /** Solo los grupos con algo en venta: en una sucursal donde todo un grupo está en standby
   *  (p. ej. DIDI, que solo vende Benito Juárez) el botón no aparece vacío. */
  const categoriasConProductos = useMemo(() => {
    const conProductos = new Set(productos.map((p) => p.categoriaId));
    return categorias.filter((c) => conProductos.has(c.id));
  }, [categorias, productos]);

  const sinCatalogo = categorias.length === 0 && productos.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      {!sinCatalogo && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={estilos.tabsCategoria} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
            <TouchableOpacity onPress={() => setCategoriaActiva(null)} style={[estilos.chip, !categoriaActiva && estilos.chipActivo]}>
              <Text style={{ color: !categoriaActiva ? "#fff" : colores.texto, fontWeight: "700" }}>Todas</Text>
            </TouchableOpacity>
            {categoriasConProductos.map((c) => {
              const color = colorPorCategoria.get(c.id);
              const activa = categoriaActiva === c.id;
              // Siempre con su color; la elegida va sólida y con borde blanco, las demás atenuadas.
              return (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => setCategoriaActiva(c.id)}
                  style={[estilos.chip, estilos.chipCategoria, { backgroundColor: activa ? color?.fondo : conOpacidad(color?.fondo ?? "#1565C0", 0.72), borderColor: activa ? "#fff" : "transparent" }]}
                  accessibilityState={{ selected: activa }}
                >
                  <Text style={{ color: color?.texto ?? "#fff", fontWeight: "800" }}>{c.nombre}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={estilos.barraBusqueda}>
            <Text style={estilos.lupa}>🔍</Text>
            <TextInput
              placeholder="Buscar producto…"
              placeholderTextColor={colores.textoSecundario}
              value={busqueda}
              onChangeText={setBusqueda}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={estilos.inputBusqueda}
              accessibilityLabel="Buscar producto"
            />
            {buscando && (
              <TouchableOpacity onPress={() => setBusqueda("")} style={estilos.botonLimpiar} accessibilityLabel="Limpiar búsqueda">
                <Text style={estilos.botonLimpiarTexto}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
        {sinCatalogo ? (
          <Text style={estilos.ayuda}>Todavía no hay catálogo — da de alta tus productos desde Admin → Catálogo, o conecta con el ERP para traerlo.</Text>
        ) : (
          <>
            {buscando && (
              <Text style={estilos.resumenBusqueda}>
                {productosVisibles.length === 0
                  ? `Sin resultados para "${busqueda.trim()}"`
                  : `${productosVisibles.length} resultado${productosVisibles.length === 1 ? "" : "s"} en todo el catálogo`}
              </Text>
            )}
            {/* Producto que no existe: la venta de ese producto se detiene aquí. No se crea ni se
                vende "pendiente" — solo se pide al administrador que lo dé de alta. */}
            {buscando && productosVisibles.length === 0 && (
              <View style={estilos.tarjetaSolicitud}>
                <Text style={estilos.textoSolicitud}>
                  "{busqueda.trim()}" no está en el catálogo, así que no se puede vender todavía. Puedes pedir al
                  administrador que lo dé de alta.
                </Text>
                <TouchableOpacity onPress={pedirAlta} style={estilos.botonSolicitud} accessibilityLabel="Solicitar alta del producto">
                  <Text style={estilos.botonSolicitudTexto}>Solicitar alta al administrador</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={estilos.grillaProductos}>
              {productosVisibles.map((p) => {
                const contexto = etiquetaContexto(p);
                const promo = precioDeVenta(promociones, p, new Date(), sucursalLocalId);
                // La tarjeta lleva el color de su categoría con texto blanco: en "Todas" y en la
                // búsqueda se distingue de un vistazo a qué familia pertenece cada producto.
                const color = colorPorCategoria.get(p.categoriaId);
                const fondo = color?.fondo ?? colores.navy;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[estilos.tarjetaProducto, { backgroundColor: fondo, borderColor: fondo }]}
                    onPress={() => tocarProducto(p)}
                  >
                    <Text style={estilos.nombreProducto} numberOfLines={2}>{p.nombre}</Text>
                    {contexto && <Text style={estilos.contextoProducto} numberOfLines={1}>{contexto}</Text>}
                    {promo.promocionId && <Text style={estilos.etiquetaPromo} numberOfLines={1}>🏷 {promo.nombrePromocion}</Text>}
                    <Text style={estilos.precioProducto}>
                      ${promo.precioUnitario.toFixed(2)}
                      {promo.promocionId ? <Text style={estilos.precioAnterior}>  ${p.precioBase.toFixed(2)}</Text> : null}
                      {/* Avisa de que el precio puede subir con lo que se elija en el modal. */}
                      {p.requierePersonalizacion ? <Text style={estilos.marcaPersonaliza}>  ⚙</Text> : null}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {productosVisibles.length === 0 && !buscando && <Text style={estilos.ayuda}>Sin productos en esta categoría.</Text>}
          </>
        )}
      </ScrollView>

      <View style={estilos.carrito}>
        {/* Pedidos en espera: un botón por cliente apartado. Tocarlo abre su pedido con los
            productos pendientes de cobrar; dejarlo presionado lo descarta. */}
        {enEspera.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ gap: 8 }}>
            {enEspera.map((p) => {
              const total = p.items.reduce((s, i) => s + (i.precioUnitario + i.modificadores.reduce((m, x) => m + x.precioExtra, 0)) * i.cantidad, 0);
              const piezas = p.items.reduce((s, i) => s + i.cantidad, 0);
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => retomarEspera(p.id)}
                  onLongPress={() =>
                    Alert.alert("Descartar pedido en espera", `¿Quitar el pedido de "${p.etiqueta}" ($${total.toFixed(2)})? Sus productos se pierden.`, [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Descartar", style: "destructive", onPress: () => descartarEspera(p.id) },
                    ])
                  }
                  style={estilos.botonEspera}
                  accessibilityRole="button"
                  accessibilityLabel={`Retomar pedido en espera de ${p.etiqueta}`}
                >
                  <Text style={estilos.botonEsperaNombre} numberOfLines={1}>⏸ {p.etiqueta}</Text>
                  <Text style={estilos.botonEsperaDetalle} numberOfLines={1}>
                    {piezas} pza · ${total.toFixed(2)} · {tiempoEsperando(p.desde, new Date())}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        {/* Nombre del pedido: sale en el ticket y la comanda. Tocarlo lo cambia o lo quita. En un
            pedido de DIDI no se ofrece (ver pedidoDidi). */}
        {!pedidoDidi && (
          <TouchableOpacity onPress={() => setPidiendoNombre(true)} style={estilos.filaNombre} accessibilityLabel="Nombre del pedido">
            <Text style={{ color: nombreCliente ? colores.texto : colores.textoSecundario, fontWeight: nombreCliente ? "700" : "400" }} numberOfLines={1}>
              {nombreCliente ? `👤 ${nombreCliente}` : "👤 Poner nombre al pedido"}
            </Text>
            <Text style={{ color: colores.textoSecundario }}>{nombreCliente ? "✎" : "+"}</Text>
          </TouchableOpacity>
        )}
        <ScrollView style={{ maxHeight: 160 }}>
          {items.map((item) => (
            <View key={item.id} style={estilos.filaItem}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colores.texto }} numberOfLines={1}>{item.nombreProducto}</Text>
                {/* Lo elegido en el modal, bajo el nombre: dos "Latte" con leches distintas
                    tienen que distinguirse en el carrito antes de cobrar. */}
                {item.modificadores.length > 0 && (
                  <Text style={estilos.modificadoresItem} numberOfLines={2}>
                    {item.modificadores.map((m) => m.nombreOpcion).join(" · ")}
                  </Text>
                )}
                {item.promocionId ? (
                  <Text style={estilos.promoItem} numberOfLines={1}>🏷 {item.nombrePromocion}{item.precioLista != null ? ` · antes $${item.precioLista.toFixed(2)}` : ""}</Text>
                ) : null}
                {item.notas ? <Text style={estilos.modificadoresItem} numberOfLines={1}>✎ {item.notas}</Text> : null}
              </View>
              <View style={estilos.controlesCantidad}>
                {/* El cesto va a la izquierda del "−" para que no se confunda con el cobro y quede
                    junto a los controles de la línea; los tres son táctiles de 40×40. */}
                <TouchableOpacity onPress={() => quitarItem(item.id)} style={[estilos.botonCantidad, { backgroundColor: colores.red + "1A" }]} accessibilityLabel={`Quitar ${item.nombreProducto}`}>
                  <Text style={estilos.botonCantidadTexto}>🗑</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => cambiarCantidad(item.id, -1)} style={estilos.botonCantidad} accessibilityLabel={`Una menos de ${item.nombreProducto}`}><Text style={estilos.botonCantidadTexto}>−</Text></TouchableOpacity>
                <Text style={{ color: colores.texto, width: 28, textAlign: "center", fontSize: 16, fontWeight: "700" }}>{item.cantidad}</Text>
                <TouchableOpacity onPress={() => cambiarCantidad(item.id, 1)} style={estilos.botonCantidad} accessibilityLabel={`Una más de ${item.nombreProducto}`}><Text style={estilos.botonCantidadTexto}>+</Text></TouchableOpacity>
              </View>
              {/* Incluye los extras: si no, la suma de las líneas no cuadraría con el total. */}
              <Text style={{ color: colores.texto, width: 70, textAlign: "right" }}>
                ${((item.precioUnitario + item.modificadores.reduce((s, m) => s + m.precioExtra, 0)) * item.cantidad).toFixed(2)}
              </Text>
            </View>
          ))}
          {items.length === 0 && <Text style={estilos.ayuda}>Carrito vacío — toca un producto para agregarlo.</Text>}
        </ScrollView>

        {/* Total y botón en la MISMA fila: antes eran dos bloques apilados y el pie del carrito
            se comía una franja alta de pantalla en una tablet, justo donde hace falta ver
            productos.

            El botón repite el importe a propósito: es la última confirmación de cuánto se va a
            cobrar, y el cajero mira el botón, no la etiqueta. Por eso el bloque de la izquierda
            queda en un cuerpo menor — informa, pero el que manda es el botón. */}
        <View style={estilos.barraCobro}>
          <View style={estilos.bloqueTotal}>
            <Text style={estilos.totalEtiqueta}>Total</Text>
            <Text style={estilos.totalImporte} numberOfLines={1} adjustsFontSizeToFit>
              ${t.total.toFixed(2)}
            </Text>
          </View>

          {/* Apartar el pedido: el cliente no trae cambio o fue por dinero a su carro. Se guarda
              con nombre o descripción y la caja queda libre para el siguiente. */}
          <TouchableOpacity
            onPress={() => setApartando(true)}
            disabled={items.length === 0}
            style={[estilos.botonApartar, items.length === 0 && { opacity: 0.5 }]}
            accessibilityRole="button"
            accessibilityLabel="Poner pedido en espera"
          >
            <Text style={estilos.botonApartarTexto}>⏸ En espera</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onCobrar}
            disabled={items.length === 0}
            style={[estilos.botonCobrar, items.length === 0 && { opacity: 0.5 }]}
          >
            {/* `adjustsFontSizeToFit` para que un total de cuatro cifras no parta el botón en
                una tablet estrecha. */}
            <Text style={estilos.botonCobrarTexto} numberOfLines={1} adjustsFontSizeToFit>
              Cobrar ${t.total.toFixed(2)}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {apartando && (
        <ModalNombreCliente
          inicial={nombreCliente}
          titulo="Poner pedido en espera"
          ayuda="Escribe el nombre o una descripción (ej. «Señor camioneta roja»). Quedará como botón arriba del carrito: tócalo cuando regrese para cobrarle."
          placeholder="Nombre o descripción"
          textoGuardar="Apartar"
          textoOmitir="Cancelar"
          onGuardar={(texto) => { ponerEnEspera(texto); setApartando(false); }}
          onOmitir={() => setApartando(false)}
        />
      )}

      {pidiendoNombre && (
        <ModalNombreCliente
          inicial={nombreCliente}
          onGuardar={(nombre) => { fijarNombreCliente(nombre); setPidiendoNombre(false); }}
          onOmitir={() => { fijarNombreCliente(null); marcarNombrePreguntado(); setPidiendoNombre(false); }}
        />
      )}

      {personalizando && (
        <ModalModificadores
          // El modal suma los extras sobre el precio que se va a cobrar: con promoción, el especial.
          producto={{ ...personalizando.producto, precioBase: precioDeVenta(promociones, personalizando.producto, new Date(), sucursalLocalId).precioUnitario }}
          modificadores={personalizando.modificadores}
          onCancelar={() => setPersonalizando(null)}
          onConfirmar={(cantidad, seleccion, notas) => {
            agregarItem({
              productoId: personalizando.producto.id,
              nombreProducto: personalizando.producto.nombre,
              categoria: nombrePorCategoria.get(personalizando.producto.categoriaId),
              cantidad,
              ...precioDeVenta(promociones, personalizando.producto, new Date(), sucursalLocalId),
              notas: notas || undefined,
              modificadores: seleccion,
            });
            setPersonalizando(null);
          }}
        />
      )}
    </View>
  );
}

function crearEstilos(colores: ReturnType<typeof usarColores>) {
  return StyleSheet.create({
    tabsCategoria: { flexGrow: 0, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde, backgroundColor: colores.superficie },
    chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colores.gray50 },
    chipActivo: { backgroundColor: colores.navy },
    chipCategoria: { borderWidth: 2 },
    barraBusqueda: {
      flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: colores.superficie, borderBottomWidth: 1, borderBottomColor: colores.borde,
    },
    lupa: { fontSize: 15 },
    // minHeight 44: mismo piso táctil que el resto de controles de la app (ver botones de la
    // barra inferior) — se teclea con el dedo, muchas veces con guantes de barra.
    inputBusqueda: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colores.borde, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, color: colores.texto },
    botonLimpiar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colores.gray50, alignItems: "center", justifyContent: "center" },
    botonLimpiarTexto: { color: colores.textoSecundario, fontSize: 15, fontWeight: "700" },
    resumenBusqueda: { color: colores.textoSecundario, fontSize: 12, paddingHorizontal: 4, paddingBottom: 10 },
    tarjetaSolicitud: { backgroundColor: colores.superficie, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colores.borde, marginBottom: 12 },
    textoSolicitud: { color: colores.texto, fontSize: 14, marginBottom: 10 },
    botonSolicitud: { backgroundColor: colores.navy, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    botonSolicitudTexto: { color: "#fff", fontWeight: "700" },
    grillaProductos: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    // Fondo y borde los pone cada tarjeta con el color de su categoría; el texto va en blanco.
    tarjetaProducto: { width: "47%", backgroundColor: colores.navy, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colores.navy },
    nombreProducto: { fontSize: 14, fontWeight: "800", color: "#fff" },
    contextoProducto: { fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 2 },
    precioProducto: { fontSize: 15, fontWeight: "800", color: "#fff", marginTop: 6 },
    marcaPersonaliza: { fontSize: 11, color: "rgba(255,255,255,0.85)", fontWeight: "600" },
    modificadoresItem: { fontSize: 11, color: colores.textoSecundario, marginTop: 1 },
    ayuda: { color: colores.textoSecundario, fontSize: 13, padding: 8 },
    carrito: { backgroundColor: colores.superficie, borderTopWidth: 1, borderTopColor: colores.borde, padding: 12 },
    filaNombre: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40, paddingBottom: 6, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: colores.borde },
    filaItem: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colores.borde },
    etiquetaPromo: { fontSize: 11, fontWeight: "800", color: "#FFE082" },
    precioAnterior: { fontSize: 12, fontWeight: "400", color: "rgba(255,255,255,0.75)", textDecorationLine: "line-through" },
    promoItem: { fontSize: 12, fontWeight: "700", color: colores.green },
    controlesCantidad: { flexDirection: "row", alignItems: "center", gap: 4, marginHorizontal: 8 },
    botonCantidad: { width: 40, height: 40, borderRadius: 8, backgroundColor: colores.gray50, alignItems: "center", justifyContent: "center" },
    botonCantidadTexto: { fontSize: 22, fontWeight: "700", color: colores.texto },
    barraCobro: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10 },
    // `flexShrink` para que con un total largo se encoja el importe y no se deforme el botón.
    bloqueTotal: { flex: 1, flexShrink: 1 },
    totalEtiqueta: { fontSize: 11, fontWeight: "700", color: colores.textoSecundario, letterSpacing: 0.5 },
    totalImporte: { fontSize: 19, fontWeight: "800", color: colores.navyTexto },
    // 52 de alto es el mínimo cómodo para el pulgar en una tablet de mostrador; se mantiene
    // aunque la barra sea ahora más baja en total.
    botonCobrar: {
      backgroundColor: colores.green, borderRadius: 12,
      paddingHorizontal: 20, minHeight: 52, flexShrink: 1, minWidth: 170,
      alignItems: "center", justifyContent: "center",
    },
    botonCobrarTexto: { color: "#fff", fontWeight: "700", fontSize: 17 },
    botonApartar: { backgroundColor: colores.amber + "26", borderWidth: 1, borderColor: colores.amber, borderRadius: 12, paddingHorizontal: 14, minHeight: 52, alignItems: "center", justifyContent: "center" },
    botonApartarTexto: { color: colores.texto, fontWeight: "700", fontSize: 15 },
    botonEspera: { backgroundColor: colores.amber + "26", borderWidth: 1, borderColor: colores.amber, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, minHeight: 48, maxWidth: 220, justifyContent: "center" },
    botonEsperaNombre: { color: colores.texto, fontWeight: "800", fontSize: 14 },
    botonEsperaDetalle: { color: colores.textoSecundario, fontSize: 11, marginTop: 2 },
  });
}
