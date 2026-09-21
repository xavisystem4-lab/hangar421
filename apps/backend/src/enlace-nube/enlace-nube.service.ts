import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "crypto";
import { EstadoPedido, SyncEntidad, SyncOperacion, TipoDispositivo, type SyncEnvelope, type SyncPushResponse } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CifradoService } from "../common/crypto/cifrado.service";
import { hoyEnZona, limiteDelDia } from "../pedidos/ventas-consulta";
import { ClienteNube, normalizarUrlErp } from "./cliente-nube";
import { claveOpcion, emparejarPorNombre } from "./mapeo";
import { armarVentaHub, type Mapeos, type VentaLocal } from "./venta-hub";

const ENTIDAD_VENTA = "VENTA";
const INTERVALO_MS = 60_000;
const REFRESCO_MAPEOS_MS = 30 * 60_000;
const LOTE = 25;

interface ProductoNube {
  id: string;
  nombre: string;
  categoriaId?: string;
  subcategoria?: string | null;
  /** Forma de GET /catalogo/productos (CatalogoService.listarProductosPorSucursal). */
  modificadores?: { nombre: string; opciones: { id: string; nombre: string }[] }[];
}

/**
 * Enlace del POS de Windows (backend embebido, modo standalone) con el ERP en la nube.
 *
 * El POS sigue siendo el hub de su sucursal y trabaja sin internet; esto solo SUBE a la nube sus
 * ventas cerradas desde la fecha elegida, para que aparezcan en el Dashboard. Se vincula con un
 * código de UNA sucursal de la nube (el mismo esquema que el APK).
 *
 * Solo corre con AUTO_BOOTSTRAP=true, que es la marca del backend embebido: en la nube los
 * endpoints responden 403 y el ciclo no arranca.
 */
@Injectable()
export class EnlaceNubeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("EnlaceNube");
  private readonly cifrado: CifradoService | null;
  private cliente: ClienteNube | null = null;
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private cicloActual: Promise<void> | null = null;
  private ultimoRefrescoMapeos = 0;
  private productosNube: ProductoNube[] = [];
  private categoriasNube = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    let cifrado: CifradoService | null = null;
    try {
      cifrado = new CifradoService(config, "NUBE_CIFRADO_KEY");
    } catch {
      // Sin llave no se puede guardar la sesión con la nube: el enlace queda deshabilitado
      // (vincular lo explica). No debe impedir que arranque el resto del backend.
    }
    this.cifrado = cifrado;
  }

  private get esPosLocal(): boolean {
    return this.config.get<string>("AUTO_BOOTSTRAP") === "true";
  }

  onModuleInit() {
    if (!this.esPosLocal) return;
    this.temporizador = setInterval(() => this.ciclo().catch(() => undefined), INTERVALO_MS);
    this.temporizador.unref?.();
  }

  onModuleDestroy() {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  // -- Estado y vinculación -------------------------------------------------------------------

  async estado() {
    this.exigirPosLocal();
    const enlace = await this.prisma.enlaceNube.findUnique({ where: { id: "principal" } });
    if (!enlace) return { vinculado: false as const };
    const [porEstado, sinEquivalente, pendientes] = await Promise.all([
      this.prisma.envioNube.groupBy({ by: ["estado"], where: { entidad: ENTIDAD_VENTA }, _count: true }),
      this.prisma.mapeoIdNube.count({ where: { entidad: "PRODUCTO", idNube: null } }),
      this.candidatas(enlace, 10_000).then((c) => c.length),
    ]);
    const cuenta = (e: string) => porEstado.find((p) => p.estado === e)?._count ?? 0;
    return {
      vinculado: true as const,
      activo: enlace.activo,
      urlErp: enlace.urlErp,
      sucursalNube: enlace.sucursalNombreNube,
      sucursalIdLocal: enlace.sucursalIdLocal,
      sincronizarDesde: enlace.sincronizarDesde,
      ultimoEnvio: enlace.ultimoEnvio,
      ultimoError: enlace.ultimoError,
      ventas: { enviadas: cuenta("ENVIADO"), conError: cuenta("ERROR"), esperandoProducto: cuenta("ESPERA_MAPEO"), porEnviar: pendientes },
      productosPorRelacionar: sinEquivalente,
    };
  }

  /**
   * Vincula este POS con una sucursal de la nube canjeando un código. `sincronizarDesde` es el
   * día (YYYY-MM-DD, en la zona de la sucursal local) desde el que se suben las ventas; por
   * defecto, hoy.
   */
  async vincular(
    empresaIdLocal: string,
    datos: { urlErp: string; codigo: string; sucursalIdLocal: string; sincronizarDesde?: string },
  ) {
    this.exigirPosLocal();
    if (!this.cifrado) throw new BadRequestException("Falta NUBE_CIFRADO_KEY: actualiza el POS para poder vincularlo con la nube");
    const sucursal = await this.prisma.sucursal.findFirst({ where: { id: datos.sucursalIdLocal, empresaId: empresaIdLocal } });
    if (!sucursal) throw new BadRequestException("La sucursal local no existe");
    const desde = limiteDelDia(datos.sincronizarDesde || hoyEnZona(sucursal.timezone), sucursal.timezone, "inicio");

    const base = normalizarUrlErp(datos.urlErp);
    const previo = await this.prisma.enlaceNube.findUnique({ where: { id: "principal" } });
    // La huella se conserva entre revinculaciones: es la identidad del POS en la nube.
    const huella = previo?.dispositivoId ?? `pc-${randomUUID()}`;

    const r = await fetch(`${base}/auth/vincular-dispositivo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo: datos.codigo, dispositivoId: huella, nombreDispositivo: `POS Windows — ${sucursal.nombre}`, tipo: TipoDispositivo.POS_WINDOWS }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new BadRequestException("No se pudo contactar con el ERP en la nube. Revisa la dirección y la conexión a internet.");
    });
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new BadRequestException(r.status === 401 ? "Ese código no sirve: puede haber caducado o ya se usó" : (cuerpo?.message ?? "La nube rechazó el código"));
    if (cuerpo.alcance === "EMPRESA") {
      throw new BadRequestException("Usa un código de UNA sucursal: este POS sube las ventas de una sola sucursal");
    }

    await this.prisma.enlaceNube.upsert({
      where: { id: "principal" },
      update: {
        urlErp: base, empresaIdNube: cuerpo.empresaId, sucursalIdNube: cuerpo.sucursalId, sucursalNombreNube: cuerpo.sucursal,
        sucursalIdLocal: sucursal.id, dispositivoId: huella, refreshCifrado: this.cifrado.cifrar(cuerpo.refreshToken),
        sincronizarDesde: desde, activo: true, ultimoError: null,
      },
      create: {
        urlErp: base, empresaIdNube: cuerpo.empresaId, sucursalIdNube: cuerpo.sucursalId, sucursalNombreNube: cuerpo.sucursal,
        sucursalIdLocal: sucursal.id, dispositivoId: huella, refreshCifrado: this.cifrado.cifrar(cuerpo.refreshToken), sincronizarDesde: desde,
      },
    });
    this.cliente = this.crearCliente(base, cuerpo.accessToken);
    await this.refrescarMapeos().catch((e) => this.logger.warn(`No se pudo emparejar el catálogo: ${e.message}`));
    this.ciclo().catch(() => undefined);
    return this.estado();
  }

  async desvincular() {
    this.exigirPosLocal();
    await this.prisma.enlaceNube.updateMany({ where: { id: "principal" }, data: { activo: false } });
    this.cliente = null;
    return this.estado();
  }

  async sincronizarAhora() {
    this.exigirPosLocal();
    await this.ciclo(true);
    return this.estado();
  }

  // -- Relación de productos -----------------------------------------------------------------

  /** Productos locales sin equivalente en la nube, cuántas ventas esperan por cada uno, y el
   *  catálogo de la nube para elegir. */
  async productosPorRelacionar() {
    this.exigirPosLocal();
    const enlace = await this.enlaceActivo();
    if (this.productosNube.length === 0) await this.cargarCatalogoNube(enlace).catch(() => undefined);
    const sinEquivalente = await this.prisma.mapeoIdNube.findMany({ where: { entidad: "PRODUCTO", idNube: null }, orderBy: { nombreLocal: "asc" } });
    const esperando = await this.prisma.pedidoItem.groupBy({
      by: ["productoId"],
      where: { productoId: { in: sinEquivalente.map((s) => s.idLocal) }, pedido: this.filtroVentas(enlace) },
      _count: true,
    });
    return {
      productos: sinEquivalente.map((s) => ({
        idLocal: s.idLocal,
        nombre: s.nombreLocal,
        lineasEnVentas: esperando.find((e) => e.productoId === s.idLocal)?._count ?? 0,
      })),
      catalogoNube: this.productosNube
        .map((p) => {
          const contexto = [this.categoriasNube.get(p.categoriaId ?? ""), p.subcategoria].filter(Boolean).join(" · ");
          return { id: p.id, nombre: contexto ? `${p.nombre} (${contexto})` : p.nombre };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    };
  }

  /** El admin elige a qué producto de la nube corresponde uno local. Las ventas que esperaban por
   *  él se reintentan en el siguiente ciclo. */
  async relacionar(idLocal: string, idNube: string) {
    this.exigirPosLocal();
    const enlace = await this.enlaceActivo();
    if (this.productosNube.length === 0) await this.cargarCatalogoNube(enlace);
    if (!this.productosNube.some((p) => p.id === idNube)) throw new BadRequestException("Ese producto no existe en el catálogo de la nube");
    const mapeo = await this.prisma.mapeoIdNube.findUnique({ where: { entidad_idLocal: { entidad: "PRODUCTO", idLocal } } });
    if (!mapeo) throw new NotFoundException("Producto local no encontrado");
    await this.prisma.mapeoIdNube.update({ where: { entidad_idLocal: { entidad: "PRODUCTO", idLocal } }, data: { idNube, origen: "MANUAL" } });
    await this.prisma.envioNube.deleteMany({ where: { entidad: ENTIDAD_VENTA, estado: "ESPERA_MAPEO" } });
    this.ciclo().catch(() => undefined);
    return this.productosPorRelacionar();
  }

  // -- Ciclo de subida -----------------------------------------------------------------------

  /** Una pasada: refresca el emparejamiento de vez en cuando y sube un lote de ventas. Nunca
   *  corren dos a la vez: si hay una en curso se espera a que termine, y una forzada ("Enviar
   *  ahora") corre otra después — si no, el botón volvería sin haber enviado nada. `forzar`
   *  ignora las esperas de reintento. */
  async ciclo(forzar = false): Promise<void> {
    if (this.cicloActual) {
      await this.cicloActual;
      if (!forzar) return;
    }
    this.cicloActual = this.ejecutarCiclo(forzar).finally(() => {
      this.cicloActual = null;
    });
    return this.cicloActual;
  }

  private async ejecutarCiclo(forzar: boolean): Promise<void> {
    try {
      const enlace = await this.prisma.enlaceNube.findUnique({ where: { id: "principal" } });
      if (!enlace?.activo) return;
      if (forzar || Date.now() - this.ultimoRefrescoMapeos > REFRESCO_MAPEOS_MS) await this.refrescarMapeos();
      await this.subirLote(enlace, forzar);
      await this.prisma.enlaceNube.update({ where: { id: "principal" }, data: { ultimoError: null } });
    } catch (e: any) {
      this.logger.warn(`Envío a la nube: ${e.message}`);
      await this.prisma.enlaceNube.updateMany({ where: { id: "principal" }, data: { ultimoError: String(e.message).slice(0, 500) } });
    }
  }

  private filtroVentas(enlace: { sucursalIdLocal: string; sincronizarDesde: Date }) {
    return {
      sucursalId: enlace.sucursalIdLocal,
      estado: { in: [EstadoPedido.COBRADO, EstadoPedido.CANCELADO] as any[] },
      createdAt: { gte: enlace.sincronizarDesde },
    };
  }

  /** Ventas por subir: nunca enviadas, cambiadas desde el último envío (una cancelación), o con
   *  error / esperando producto cuyo plazo de reintento ya venció. */
  private async candidatas(enlace: { sucursalIdLocal: string; sincronizarDesde: Date }, tope: number, forzar = false) {
    const ventas = await this.prisma.pedido.findMany({
      where: this.filtroVentas(enlace),
      select: { id: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
    });
    const envios = new Map(
      (await this.prisma.envioNube.findMany({ where: { entidad: ENTIDAD_VENTA, entidadId: { in: ventas.map((v) => v.id) } } })).map((e) => [e.entidadId, e]),
    );
    const ahora = new Date();
    return ventas
      .filter((v) => {
        const e = envios.get(v.id);
        if (!e) return true;
        if (e.estado === "ENVIADO") return e.version < v.updatedAt;
        return forzar || !e.proximoIntento || e.proximoIntento <= ahora;
      })
      .slice(0, tope);
  }

  private async subirLote(enlace: NonNullable<Awaited<ReturnType<typeof this.prisma.enlaceNube.findUnique>>>, forzar: boolean) {
    const candidatas = await this.candidatas(enlace, LOTE, forzar);
    if (candidatas.length === 0) return;

    const mapeos = await this.cargarMapeos();
    const ventas: VentaLocal[] = (await this.prisma.pedido.findMany({
      where: { id: { in: candidatas.map((c) => c.id) } },
      include: {
        mesero: { select: { id: true, nombre: true } },
        cajero: { select: { id: true, nombre: true } },
        dispositivo: { select: { identificador: true, nombre: true, tipo: true } },
        items: { include: { producto: { select: { nombre: true } }, modificadores: true } },
        pagos: true,
        descuentos: true,
      },
      orderBy: { createdAt: "asc" },
    })) as any;

    const sobres: SyncEnvelope[] = [];
    const altas = new Map<string, { id: string; nombre: string }>();
    const versiones = new Map<string, Date>();
    for (const v of ventas) {
      const version = candidatas.find((c) => c.id === v.id)!.updatedAt;
      const armado = armarVentaHub(v, mapeos);
      if (armado.tipo === "ESPERA_MAPEO") {
        await this.marcarEnvio(v.id, version, "ESPERA_MAPEO", `Producto sin equivalente en la nube: ${armado.productosSinEquivalente.join(", ")}`);
        continue;
      }
      for (const a of armado.usuariosPorAlta) altas.set(a.id, a);
      versiones.set(v.id, version);
      sobres.push({
        id: v.id,
        entidad: SyncEntidad.VENTA_HUB,
        operacion: SyncOperacion.CREATE,
        idempotencyKey: createHash("sha256").update(`${enlace.dispositivoId}|VENTA|${v.id}|${version.toISOString()}`).digest("hex"),
        dispositivoId: enlace.dispositivoId,
        sucursalId: enlace.sucursalIdNube,
        usuarioId: armado.venta.cajeroId ?? undefined,
        createdAtLocal: v.createdAt.toISOString(),
        payload: armado.venta,
      });
    }
    if (sobres.length === 0) return;

    // Las personas sin equivalente en la nube se dan de alta ANTES que sus ventas, con su mismo id.
    const sobresAlta: SyncEnvelope[] = [...altas.values()].map((u) => ({
      id: u.id,
      entidad: SyncEntidad.USUARIO,
      operacion: SyncOperacion.CREATE,
      idempotencyKey: createHash("sha256").update(`${enlace.dispositivoId}|USUARIO|${u.id}`).digest("hex"),
      dispositivoId: enlace.dispositivoId,
      sucursalId: enlace.sucursalIdNube,
      createdAtLocal: new Date().toISOString(),
      payload: { nombre: u.nombre, rol: "CAJERO" },
    }));

    const cliente = await this.obtenerCliente(enlace);
    const resp = await cliente.llamar<SyncPushResponse>("/sync/push", { metodo: "POST", cuerpo: { items: [...sobresAlta, ...sobres] } });

    for (const alta of sobresAlta) {
      const r = resp.resultados.find((x) => x.idempotencyKey === alta.idempotencyKey);
      if (r?.estado === "SYNCED") {
        await this.prisma.mapeoIdNube.upsert({
          where: { entidad_idLocal: { entidad: "USUARIO", idLocal: alta.id } },
          update: { idNube: alta.id, origen: "ALTA" },
          create: { entidad: "USUARIO", idLocal: alta.id, idNube: alta.id, nombreLocal: (alta.payload as any).nombre, origen: "ALTA" },
        });
      }
    }
    for (const s of sobres) {
      const r = resp.resultados.find((x) => x.idempotencyKey === s.idempotencyKey);
      if (!r) continue;
      await this.marcarEnvio(s.id, versiones.get(s.id)!, r.estado === "SYNCED" ? "ENVIADO" : "ERROR", r.error ?? null);
    }
    await this.prisma.enlaceNube.update({ where: { id: "principal" }, data: { ultimoEnvio: new Date() } });
  }

  private async marcarEnvio(entidadId: string, version: Date, estado: "ENVIADO" | "ERROR" | "ESPERA_MAPEO", error: string | null) {
    const previo = await this.prisma.envioNube.findUnique({ where: { entidad_entidadId: { entidad: ENTIDAD_VENTA, entidadId } } });
    const intentos = estado === "ENVIADO" ? 0 : (previo?.intentos ?? 0) + 1;
    // Reintento con espera creciente (1, 2, 4… hasta 60 min); una venta esperando producto se
    // revisa cada 5 min (relacionarlo la libera al instante).
    const esperaMin = estado === "ESPERA_MAPEO" ? 5 : Math.min(60, 2 ** Math.max(0, intentos - 1));
    const datos = {
      version,
      estado,
      intentos,
      ultimoError: error?.slice(0, 500) ?? null,
      proximoIntento: estado === "ENVIADO" ? null : new Date(Date.now() + esperaMin * 60_000),
      enviadoAt: estado === "ENVIADO" ? new Date() : (previo?.enviadoAt ?? null),
    };
    await this.prisma.envioNube.upsert({
      where: { entidad_entidadId: { entidad: ENTIDAD_VENTA, entidadId } },
      update: datos,
      create: { entidad: ENTIDAD_VENTA, entidadId, ...datos },
    });
  }

  // -- Emparejamiento ------------------------------------------------------------------------

  /** Empareja por nombre productos, opciones y usuarios locales con los de la nube. Nunca pisa
   *  una relación que eligió el admin (MANUAL) ni un usuario ya dado de alta (ALTA). */
  async refrescarMapeos(): Promise<void> {
    const enlace = await this.enlaceActivo();
    await this.cargarCatalogoNube(enlace);
    const cliente = await this.obtenerCliente(enlace);
    const contexto = await cliente.llamar<{ usuarios: { id: string; nombre: string }[] }>("/auth/terminal/contexto");

    const [productos, opciones, usuarios, fijos] = await Promise.all([
      this.prisma.producto.findMany({ select: { id: true, nombre: true, subcategoria: true, categoria: { select: { nombre: true } } } }),
      this.prisma.opcionModificador.findMany({ select: { id: true, nombre: true, modificador: { select: { nombre: true } } } }),
      // Explícito para username vacío: un NOT a secas descarta los NULL (ver TerminalService).
      this.prisma.usuario.findMany({
        where: { OR: [{ username: null }, { NOT: { username: { startsWith: "terminal." } } }] },
        select: { id: true, nombre: true },
      }),
      this.prisma.mapeoIdNube.findMany({ where: { origen: { in: ["MANUAL", "ALTA"] } }, select: { entidad: true, idLocal: true } }),
    ]);
    const esFijo = new Set(fijos.map((f) => `${f.entidad}|${f.idLocal}`));

    const opcionesNube = new Map<string, string>();
    for (const p of this.productosNube) {
      for (const m of p.modificadores ?? []) for (const o of m.opciones ?? []) opcionesNube.set(claveOpcion(m.nombre, o.nombre), o.id);
    }

    const guardar = async (entidad: string, idLocal: string, nombreLocal: string, idNube: string | null) => {
      if (esFijo.has(`${entidad}|${idLocal}`)) return;
      await this.prisma.mapeoIdNube.upsert({
        where: { entidad_idLocal: { entidad, idLocal } },
        update: { idNube, nombreLocal, origen: "AUTOMATICO" },
        create: { entidad, idLocal, idNube, nombreLocal, origen: "AUTOMATICO" },
      });
    };

    const porProducto = emparejarPorNombre(
      productos.map((p) => ({ id: p.id, nombre: p.nombre, grupos: [p.subcategoria, p.categoria?.nombre] })),
      this.productosNube.map((p) => ({ id: p.id, nombre: p.nombre, grupos: [p.subcategoria, this.categoriasNube.get(p.categoriaId ?? "")] })),
    );
    for (const p of productos) {
      const contexto = [p.categoria?.nombre, p.subcategoria].filter(Boolean).join(" · ");
      const nombre = contexto ? `${p.nombre} (${contexto})` : p.nombre;
      await guardar("PRODUCTO", p.id, nombre, porProducto.get(p.id) ?? null);
    }
    for (const o of opciones) {
      await guardar("OPCION_MODIFICADOR", o.id, `${o.modificador.nombre}: ${o.nombre}`, opcionesNube.get(claveOpcion(o.modificador.nombre, o.nombre)) ?? null);
    }
    const porUsuario = emparejarPorNombre(usuarios, contexto.usuarios);
    for (const u of usuarios) {
      const idNube = porUsuario.get(u.id) ?? null;
      // Un usuario sin equivalente no se guarda: se da de alta con su id cuando venda algo.
      if (idNube) await guardar("USUARIO", u.id, u.nombre, idNube);
    }
    this.ultimoRefrescoMapeos = Date.now();
  }

  private async cargarMapeos(): Promise<Mapeos> {
    const filas = await this.prisma.mapeoIdNube.findMany();
    const de = (entidad: string) => new Map(filas.filter((f) => f.entidad === entidad).map((f) => [f.idLocal, f.idNube]));
    const usuarios = new Map<string, string>();
    for (const [k, v] of de("USUARIO")) if (v) usuarios.set(k, v);
    return { productos: de("PRODUCTO"), opciones: de("OPCION_MODIFICADOR"), usuarios };
  }

  private async cargarCatalogoNube(enlace: { empresaIdNube: string; sucursalIdNube: string; urlErp: string; dispositivoId: string; refreshCifrado: string }) {
    const cliente = await this.obtenerCliente(enlace);
    const [productos, categorias] = await Promise.all([
      cliente.llamar<ProductoNube[]>(`/catalogo/productos?empresaId=${enlace.empresaIdNube}&sucursalId=${enlace.sucursalIdNube}`),
      cliente.llamar<{ id: string; nombre: string }[]>(`/catalogo/categorias?empresaId=${enlace.empresaIdNube}`),
    ]);
    this.productosNube = productos;
    this.categoriasNube = new Map(categorias.map((c) => [c.id, c.nombre]));
  }

  // -- Sesión con la nube --------------------------------------------------------------------

  private async enlaceActivo() {
    const enlace = await this.prisma.enlaceNube.findUnique({ where: { id: "principal" } });
    if (!enlace?.activo) throw new BadRequestException("Este POS no está vinculado con la nube");
    return enlace;
  }

  private async obtenerCliente(enlace: { urlErp: string }) {
    if (!this.cliente) this.cliente = this.crearCliente(enlace.urlErp);
    return this.cliente;
  }

  private crearCliente(base: string, accessInicial?: string) {
    return new ClienteNube(
      base,
      async () => {
        const e = await this.prisma.enlaceNube.findUniqueOrThrow({ where: { id: "principal" } });
        return this.cifrado!.descifrar(e.refreshCifrado);
      },
      async (nuevo) => {
        await this.prisma.enlaceNube.update({ where: { id: "principal" }, data: { refreshCifrado: this.cifrado!.cifrar(nuevo) } });
      },
      accessInicial,
    );
  }

  private exigirPosLocal() {
    if (!this.esPosLocal) throw new ForbiddenException("El enlace con la nube solo existe en el POS de Windows");
  }
}
