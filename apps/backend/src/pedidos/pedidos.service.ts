import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  EstadoMesa,
  EstadoPedido,
  EstadoPedidoItem,
  RolUsuario,
  TipoDescuento,
  TipoMovimientoInventario,
  WS_EVENTS,
  calcularMontoDescuento,
  calcularTotalesPedido,
  validarPagoSuficiente,
} from "@hangar421/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { armarResumen, hoyEnZona, limiteDelDia, normalizarPaginacion, type FiltroVentas } from "./ventas-consulta";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { AuthService } from "../auth/auth.service";
import { resolverDispositivoId } from "../common/dispositivo.util";
import {
  AgregarItemsDto,
  AplicarDescuentoDto,
  CobrarPedidoDto,
  CrearPedidoDto,
} from "./dto/pedido.dto";

/** Roles que pueden autorizar acciones sensibles (cancelar una cuenta, aplicar un descuento) —
 *  deben coincidir con lo que muestran ModalCancelarPedido.tsx/ModalDescuento.tsx en el selector
 *  de "quién autoriza". */
const ROLES_AUTORIZAN_SUPERVISOR = [RolUsuario.SUPERVISOR, RolUsuario.ADMIN_SUCURSAL, RolUsuario.ADMIN_CORPORATIVO];

@Injectable()
export class PedidosService {
  private readonly logger = new Logger("Pedidos");

  constructor(private prisma: PrismaService, private realtime: RealtimeGateway, private auth: AuthService) {}

  /** `estados` (plural) filtra por una LISTA de estados — lo usa el POS para la cola de
   *  "Pedidos por cobrar" (ENVIADO/EN_PREPARACION/LISTO a la vez; no existe un único valor de
   *  `estado` que cubra "todavía no se cobra ni se canceló"). `estado` (singular) se mantiene
   *  para los llamados existentes que sí filtran por uno solo. Se incluyen `mesero`/`cliente`
   *  además de `mesa` para que esa pantalla pueda mostrar quién tomó el pedido y en qué mesa
   *  sin resolver cada ID aparte. */
  async listar(sucursalId: string, estado?: EstadoPedido, estados?: EstadoPedido[]) {
    return this.prisma.pedido.findMany({
      where: { sucursalId, ...(estado ? { estado } : {}), ...(estados?.length ? { estado: { in: estados } } : {}) },
      include: {
        items: { include: { modificadores: true, producto: true } },
        pagos: true,
        mesa: true,
        mesero: { select: { id: true, nombre: true } },
        cliente: { select: { id: true, nombre: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Consulta de ventas del ERP: lo que alimenta el módulo de Ventas y el detalle del ticket.
   *
   * Tres decisiones que no se ven en la firma:
   *
   *  - **Se listan TODOS los estados, no solo COBRADO.** El dashboard solo suma las cobradas, y
   *    eso hacía que una venta que llegó a medias (el pedido entró pero su pago no, así que se
   *    quedó en ABIERTO) desapareciera sin dejar rastro. Aquí se ve, con su estado, que es la
   *    única forma de notar que hay algo que reparar. Al total solo suman las cobradas.
   *  - **El día se calcula en la zona de la sucursal**, no en la del servidor (Railway corre en
   *    UTC). Ver `limiteDelDia`.
   *  - **Sin `sucursalId` devuelve el consolidado de la empresa.** Solo llega aquí sin él quien
   *    pasó SucursalAccessGuard, es decir un ADMIN_CORPORATIVO.
   */
  async consultarVentas(empresaId: string, filtro: FiltroVentas) {
    const zona = await this.zonaHoraria(filtro.sucursalId, empresaId);
    const desde = filtro.desde ?? hoyEnZona(zona);
    const hasta = filtro.hasta ?? desde;

    const where: Prisma.PedidoWhereInput = {
      empresaId,
      ...(filtro.sucursalId ? { sucursalId: filtro.sucursalId } : {}),
      ...(filtro.estado ? { estado: filtro.estado } : {}),
      createdAt: { gte: limiteDelDia(desde, zona, "inicio"), lte: limiteDelDia(hasta, zona, "fin") },
      ...(filtro.busqueda?.trim() ? this.filtroBusqueda(filtro.busqueda.trim()) : {}),
    };

    const { take, skip } = normalizarPaginacion(filtro.limite, filtro.offset);

    // El resumen se calcula sobre TODO el rango, no sobre la página: si no, el total cambiaría
    // al pasar de página, que es exactamente lo que nadie espera de un total.
    const [items, totalFilas, paraResumen] = await Promise.all([
      this.prisma.pedido.findMany({
        where,
        include: {
          // El nombre del producto no se copia en la línea del pedido (a diferencia del SQLite
          // del APK), así que viene por la relación.
          items: { select: { id: true, cantidad: true, precioUnitario: true, producto: { select: { nombre: true } } } },
          pagos: { select: { metodo: true, monto: true } },
          mesero: { select: { id: true, nombre: true } },
          cajero: { select: { id: true, nombre: true } },
          sucursal: { select: { id: true, nombre: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prisma.pedido.count({ where }),
      this.prisma.pedido.findMany({ where, select: { estado: true, total: true } }),
    ]);

    return {
      rango: { desde, hasta, zona },
      resumen: armarResumen(paraResumen.map((p) => ({ estado: p.estado, total: Number(p.total) }))),
      paginacion: { total: totalFilas, limite: take, offset: skip },
      items: items.map((p) => ({
        id: p.id,
        folio: p.folio,
        fecha: p.createdAt,
        estado: p.estado,
        canalOrigen: p.canalOrigen,
        total: Number(p.total),
        subtotal: Number(p.subtotal),
        descuento: Number(p.descuentoTotal),
        impuestos: Number(p.impuesto),
        sucursal: p.sucursal,
        // `mesero`/`cajero` pueden venir vacíos en una venta que se sincronizó desde una terminal
        // cuyo cajero se dio de alta sin conexión (ver usuariosLocalesRepo.mapaUsuariosErp): se
        // guarda la venta sin atribución antes que perderla.
        mesero: p.mesero,
        cajero: p.cajero,
        numItems: p.items.length,
        items: p.items.map((i) => ({
          id: i.id,
          nombre: i.producto?.nombre ?? "—",
          cantidad: i.cantidad,
          // El subtotal de la línea no se guarda: se recompone. Puede quedar por debajo del
          // total del ticket si el pedido llevaba modificadores con precio, por eso el importe
          // que manda siempre es el `total` del pedido, no la suma de estas líneas.
          subtotal: Math.round(i.cantidad * Number(i.precioUnitario) * 100) / 100,
        })),
        pagos: p.pagos.map((pa) => ({ metodo: pa.metodo, monto: Number(pa.monto) })),
      })),
    };
  }

  /** Busca por folio exacto si lo que se tecleó es un número, y si no por nombre de producto
   *  dentro del ticket — que es como se busca "la venta del café" cuando no se recuerda el
   *  folio. */
  private filtroBusqueda(texto: string): Prisma.PedidoWhereInput {
    // `folio` es texto (lo arma la terminal, no es un autoincremental), así que se busca por
    // coincidencia parcial: tecleando "42" salen el 42 y el 1042, que es lo que se espera al
    // recordar solo el final de un folio.
    return {
      OR: [
        { folio: { contains: texto, mode: "insensitive" } },
        { items: { some: { producto: { nombre: { contains: texto, mode: "insensitive" } } } } },
      ],
    };
  }

  /** Zona de la sucursal; si es el consolidado, la de la empresa a través de su primera
   *  sucursal. El `default` del esquema es America/Mexico_City, así que siempre hay una. */
  private async zonaHoraria(sucursalId: string | undefined, empresaId: string): Promise<string> {
    const sucursal = sucursalId
      ? await this.prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { timezone: true } })
      : await this.prisma.sucursal.findFirst({ where: { empresaId, activo: true }, select: { timezone: true } });
    return sucursal?.timezone ?? "America/Mexico_City";
  }

  async obtener(id: string) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id },
      include: {
        items: { include: { modificadores: { include: { opcionModificador: true } }, producto: true } },
        pagos: true,
        descuentos: true,
        mesa: true,
        mesero: { select: { id: true, nombre: true } },
        cliente: { select: { id: true, nombre: true } },
      },
    });
    if (!pedido) throw new NotFoundException("Pedido no encontrado");
    return pedido;
  }

  /** Crea un pedido de forma idempotente: si `dto.id` ya existe, devuelve el existente
   *  (reintento de sincronización offline no duplica). */
  async crear(dto: CrearPedidoDto) {
    const existente = await this.prisma.pedido.findUnique({ where: { id: dto.id } });
    if (existente) return this.obtener(dto.id);

    const sucursal = await this.prisma.sucursal.findUniqueOrThrow({ where: { id: dto.sucursalId } });
    const folio = await this.generarFolio(dto.sucursalId);

    const itemsResueltos = await Promise.all(
      dto.items.map((item) => this.resolverItem(item)),
    );

    const { subtotal, impuesto, total } = calcularTotalesPedido(itemsResueltos, [], Number(sucursal.tasaImpuesto));

    // El POS manda su propia huella de instalación como "dispositivoId" (ver electron/db.ts ->
    // obtenerDeviceId()), pero acá es una llave foránea real hacia Dispositivo.id — se resuelve/
    // autoregistra para que un dispositivo nunca antes visto no rompa la creación del pedido.
    const dispositivoId = await resolverDispositivoId(this.prisma, dto.dispositivoId, dto.sucursalId);

    // `meseroId` y `cajeroId` son llaves foráneas a Usuario. Un cliente offline puede mandar un
    // id que aquí no existe (un cajero dado de alta en la tablet sin conexión, ver
    // usuariosLocalesRepo.mapaUsuariosErp): con Prisma eso es un P2003 que rechaza el pedido
    // ENTERO. Perder la atribución de quién vendió es mucho menos grave que perder la venta, así
    // que el id que no existe se descarta y el pedido entra igual.
    const meseroId = await this.resolverUsuarioExistente(dto.meseroId);
    if (dto.meseroId && !meseroId) {
      this.logger.warn(
        `Pedido ${dto.id}: el usuario ${dto.meseroId} no existe en el ERP — se guarda sin mesero asignado ` +
          "(probable alta de cajero hecha sin conexión, ver usuariosLocalesRepo.mapaUsuariosErp).",
      );
    }

    const pedido = await this.prisma.$transaction(async (tx) => {
      const creado = await tx.pedido.create({
        data: {
          id: dto.id,
          empresaId: dto.empresaId,
          sucursalId: dto.sucursalId,
          mesaId: dto.mesaId,
          clienteId: dto.clienteId,
          folio,
          tipo: dto.tipo,
          numComensales: dto.numComensales ?? 1,
          meseroId,
          dispositivoId,
          canalOrigen: dto.canalOrigen,
          notasGenerales: dto.notasGenerales,
          idempotencyKey: dto.idempotencyKey,
          subtotal,
          impuesto,
          total,
          estado: dto.enviarInmediato ? EstadoPedido.ENVIADO : EstadoPedido.ABIERTO,
          items: {
            create: itemsResueltos.map((it) => ({
              productoId: it.productoId,
              cantidad: it.cantidad,
              precioUnitario: it.precioUnitario,
              notas: it.notas,
              modificadores: {
                create: it.modificadoresSeleccionados.map((m) => ({
                  opcionModificadorId: m.id,
                  precioExtra: m.precioExtra,
                })),
              },
            })),
          },
        },
        // `mesa` incluida — el POS la usa para la notificación nativa de "nuevo pedido de
        // mesero" (mostrar "Mesa 3" en vez de solo el folio, ver App.tsx del POS).
        include: { items: { include: { modificadores: true } }, mesa: true },
      });

      if (dto.mesaId) {
        await tx.mesa.update({ where: { id: dto.mesaId }, data: { estado: EstadoMesa.OCUPADA } });
      }

      return creado;
    });

    this.realtime.emitirASucursal(dto.sucursalId, WS_EVENTS.PEDIDO_CREADO, pedido);
    this.realtime.emitirAEmpresa(dto.empresaId, WS_EVENTS.PEDIDO_CREADO, pedido);
    if (dto.enviarInmediato) {
      this.realtime.emitirASucursal(dto.sucursalId, WS_EVENTS.COMANDA_NUEVA, pedido);
    }
    if (dto.mesaId) {
      this.realtime.emitirASucursal(dto.sucursalId, WS_EVENTS.MESA_ACTUALIZADA, { id: dto.mesaId, estado: EstadoMesa.OCUPADA });
    }
    return pedido;
  }

  async agregarItems(pedidoId: string, dto: AgregarItemsDto) {
    const pedido = await this.prisma.pedido.findUniqueOrThrow({ where: { id: pedidoId } });
    const itemsResueltos = await Promise.all(dto.items.map((item) => this.resolverItem(item)));

    await this.prisma.$transaction(
      itemsResueltos.map((it) =>
        this.prisma.pedidoItem.create({
          data: {
            pedidoId,
            productoId: it.productoId,
            cantidad: it.cantidad,
            precioUnitario: it.precioUnitario,
            notas: it.notas,
            modificadores: {
              create: it.modificadoresSeleccionados.map((m) => ({
                opcionModificadorId: m.id,
                precioExtra: m.precioExtra,
              })),
            },
          },
        }),
      ),
    );

    await this.recalcularTotales(pedidoId);
    const actualizado = await this.obtener(pedidoId);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    return actualizado;
  }

  async enviarACocina(pedidoId: string) {
    const pedido = await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: { estado: EstadoPedido.ENVIADO },
      include: { items: { include: { producto: true, modificadores: { include: { opcionModificador: true } } } } },
    });
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.COMANDA_NUEVA, pedido);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, pedido);
    return pedido;
  }

  async cambiarEstadoItem(pedidoId: string, itemId: string, estado: EstadoPedidoItem) {
    const item = await this.prisma.pedidoItem.update({
      where: { id: itemId },
      data: { estado },
      include: { pedido: true },
    });

    const items = await this.prisma.pedidoItem.findMany({ where: { pedidoId } });
    const todosListos = items.every((i) => i.estado === EstadoPedidoItem.LISTO || i.estado === EstadoPedidoItem.CANCELADO);
    const algunoEnPrep = items.some((i) => i.estado === EstadoPedidoItem.EN_PREPARACION);

    let nuevoEstadoPedido: EstadoPedido | undefined;
    if (todosListos) nuevoEstadoPedido = EstadoPedido.LISTO;
    else if (algunoEnPrep) nuevoEstadoPedido = EstadoPedido.EN_PREPARACION;

    let pedidoActualizado = item.pedido;
    if (nuevoEstadoPedido && nuevoEstadoPedido !== item.pedido.estado) {
      pedidoActualizado = await this.prisma.pedido.update({
        where: { id: pedidoId },
        data: { estado: nuevoEstadoPedido },
      });
    }

    this.realtime.emitirASucursal(item.pedido.sucursalId, WS_EVENTS.PEDIDO_ITEM_ACTUALIZADO, item);
    if (nuevoEstadoPedido === EstadoPedido.LISTO) {
      this.realtime.emitirASucursal(item.pedido.sucursalId, WS_EVENTS.COMANDA_LISTA, pedidoActualizado);
      if (item.pedido.meseroId) {
        this.realtime.emitirAUsuario(item.pedido.meseroId, WS_EVENTS.COMANDA_LISTA, pedidoActualizado);
      }
    }
    return item;
  }

  async aplicarDescuento(pedidoId: string, dto: AplicarDescuentoDto) {
    const pedido = await this.prisma.pedido.findUniqueOrThrow({ where: { id: pedidoId } });

    // Mismo fix que en cancelar(): este endpoint es alcanzable desde cualquier sesión del POS
    // (cajero incluido, ver pedidos.controller.ts) — lo que de verdad autoriza el descuento es
    // esta contraseña, validada aquí contra el usuario elegido, no el rol de quien esté
    // logueado en la terminal. Antes el PIN se "verificaba" por separado en el frontend
    // (/auth/login-pin) pero el resultado se descartaba y nunca se re-comprobaba en esta
    // mutación real — con una sesión de cajero, el descuento siempre daba 403 sin importar qué
    // PIN se tecleara, porque @Roles exigía que la SESIÓN ya fuera supervisor/admin.
    await this.auth.verificarAutorizacion(dto.autorizadoPorId, dto.password, pedido.sucursalId, ROLES_AUTORIZAN_SUPERVISOR);

    const montoAplicado = calcularMontoDescuento(dto.tipo, dto.valor, Number(pedido.subtotal));

    await this.prisma.descuento.create({
      data: {
        pedidoId,
        tipo: dto.tipo,
        valor: dto.valor,
        montoAplicado,
        motivo: dto.motivo,
        autorizadoPorId: dto.autorizadoPorId,
      },
    });

    await this.recalcularTotales(pedidoId);
    const actualizado = await this.obtener(pedidoId);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    return actualizado;
  }

  /** Cobro: registra pagos, cierra el pedido y descuenta inventario según receta. */
  async cobrar(pedidoId: string, dto: CobrarPedidoDto) {
    const pedido = await this.obtener(pedidoId);

    // Idempotente ante un doble toque de "Confirmar pago" (doble clic, reintento de red): si ya
    // está cobrado, se devuelve tal cual en vez de insertar pagos duplicados o fallar.
    if (pedido.estado === EstadoPedido.COBRADO) return pedido;

    const { suficiente, totalPagado, faltante } = validarPagoSuficiente(dto.pagos, Number(pedido.total));
    if (!suficiente) {
      throw new BadRequestException(
        `El pago (${totalPagado}) no cubre el total del pedido (${pedido.total}); faltan ${faltante}`,
      );
    }

    // `cajeroId` puede no existir en esta base: el caso real es un cajero dado de alta en la
    // terminal SIN conexión, cuyo id es un uuid7 generado en la tablet que el ERP nunca ha
    // visto (ver usuariosLocalesRepo.mapaUsuariosErp).
    //
    // Esto RECHAZABA el cobro entero con un 400. El pedido ya se había creado —`crear` sí lo
    // tolera— así que la venta se quedaba en ENVIADO: existía en el ERP pero sin pago, no
    // sumaba a ningún total y no había forma de verla. Tres tickets reales acabaron así.
    //
    // Mismo criterio que en `crear`: se cobra sin atribución y se deja constancia en el log.
    // Perder de quién fue el cobro es mucho menos grave que perder el cobro.
    const cajeroId = await this.resolverUsuarioExistente(dto.cajeroId);
    if (dto.cajeroId && !cajeroId) {
      this.logger.warn(
        `Cobro del pedido ${pedidoId}: el cajero ${dto.cajeroId} no existe en el ERP — se registra el pago sin ` +
          "cajero asignado (probable alta de cajero hecha sin conexión).",
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.pago.createMany({
          data: dto.pagos.map((p) => ({
            pedidoId,
            metodo: p.metodo,
            monto: p.monto,
            referencia: p.referencia,
            usuarioId: cajeroId,
          })),
        });
        await tx.pedido.update({
          where: { id: pedidoId },
          data: { estado: EstadoPedido.COBRADO, cajeroId },
        });
        if (pedido.mesaId) {
          await tx.mesa.update({ where: { id: pedido.mesaId }, data: { estado: EstadoMesa.LIBRE } });
        }
      });
    } catch (e: any) {
      // Prisma P2003 = viola una relación (FK) — el caso más probable es cajeroId/mesaId
      // apuntando a algo que ya no existe. Se traduce a un 400 con el detalle real en vez de
      // dejar que se vaya como 500 genérico ("Error interno del servidor").
      if (e?.code === "P2003") {
        throw new BadRequestException(`No se pudo registrar el cobro — datos inconsistentes (${e.meta?.field_name ?? "relación inválida"}). Vuelve a intentar; si persiste, cierra sesión y entra de nuevo.`);
      }
      throw e;
    }

    await this.descontarInventarioPorReceta(pedido);

    const actualizado = await this.obtener(pedidoId);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    this.realtime.emitirAEmpresa(pedido.empresaId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    if (pedido.mesaId) {
      this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.MESA_ACTUALIZADA, { id: pedido.mesaId, estado: EstadoMesa.LIBRE });
    }
    return actualizado;
  }

  /**
   * Cancelación que llega desde una terminal offline (APK / POS de sucursal), donde el PIN del
   * gerente YA se validó en el dispositivo contra su hash local.
   *
   * Es un camino distinto de `cancelar()` a propósito, por dos motivos:
   *
   *  1. Aquí NO hay contraseña que revalidar. La terminal tiene que poder cancelar sin red —es
   *     justo cuando más falta hace—, así que el punto de autorización es el dispositivo y lo
   *     que llega al ERP es el registro de quién autorizó. Mismo nivel de confianza con el que
   *     esa terminal ya abre caja e inicia sesión offline.
   *  2. Sí admite ventas COBRADAS. En un punto de venta de mostrador la venta nace cobrada, así
   *     que la regla de `cancelar()` ("para eso hace falta una devolución") dejaría sin cancelar
   *     absolutamente todo lo del APK.
   *
   * Cancelar una venta cobrada devuelve al inventario lo que consumió: si no, cada cancelación
   * dejaría un faltante fantasma en el almacén.
   */
  async cancelarDesdeTerminal(
    pedidoId: string,
    datos: { motivo: string; autorizadoPorId?: string; autorizadoPorNombre?: string; solicitadoPorId?: string },
  ) {
    const pedido = await this.obtener(pedidoId);
    if (pedido.estado === EstadoPedido.CANCELADO) return pedido; // idempotente: el reintento de la cola no duplica

    const estabaCobrado = pedido.estado === EstadoPedido.COBRADO;

    await this.prisma.$transaction(async (tx) => {
      await tx.pedido.update({ where: { id: pedidoId }, data: { estado: EstadoPedido.CANCELADO } });
      await tx.pedidoItem.updateMany({ where: { pedidoId }, data: { estado: EstadoPedidoItem.CANCELADO } });
      if (pedido.mesaId) {
        await tx.mesa.update({ where: { id: pedido.mesaId }, data: { estado: EstadoMesa.LIBRE } });
      }
      await tx.auditLog.create({
        data: {
          empresaId: pedido.empresaId,
          sucursalId: pedido.sucursalId,
          entidad: "PEDIDO",
          entidadId: pedidoId,
          accion: "CANCELAR_DESDE_TERMINAL",
          // El usuario auditado es quien AUTORIZÓ: es la pregunta que se hace siempre al revisar
          // una cancelación. Quién la pidió queda en los datos.
          usuarioId: datos.autorizadoPorId ?? datos.solicitadoPorId,
          datosNuevos: {
            motivo: datos.motivo,
            autorizadoPorNombre: datos.autorizadoPorNombre,
            solicitadoPorId: datos.solicitadoPorId,
            estadoPrevio: pedido.estado,
            total: Number(pedido.total),
          },
        },
      });
    });

    if (estabaCobrado) await this.reponerInventarioPorReceta(pedido, pedidoId);

    const actualizado = await this.obtener(pedidoId);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    this.realtime.emitirAEmpresa(pedido.empresaId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    return actualizado;
  }

  async cancelar(pedidoId: string, motivo: string, autorizadoPorId: string, password: string) {
    const pedido = await this.obtener(pedidoId);
    if (pedido.estado === EstadoPedido.COBRADO) {
      throw new BadRequestException("Esta cuenta ya está cobrada — no se puede cancelar (para eso hace falta una devolución).");
    }
    if (pedido.estado === EstadoPedido.CANCELADO) return pedido; // idempotente ante un doble toque

    // Verificación real de autorización: la sesión que llama puede ser un cajero (este endpoint
    // ya no exige rol de supervisor/admin en el propio login del POS, ver pedidos.controller.ts)
    // — lo que de verdad autoriza cancelar es esta contraseña, validada aquí contra el usuario elegido.
    await this.auth.verificarAutorizacion(autorizadoPorId, password, pedido.sucursalId, ROLES_AUTORIZAN_SUPERVISOR);

    await this.prisma.$transaction(async (tx) => {
      await tx.pedido.update({ where: { id: pedidoId }, data: { estado: EstadoPedido.CANCELADO } });
      await tx.pedidoItem.updateMany({ where: { pedidoId }, data: { estado: EstadoPedidoItem.CANCELADO } });
      if (pedido.mesaId) {
        await tx.mesa.update({ where: { id: pedido.mesaId }, data: { estado: EstadoMesa.LIBRE } });
      }
      await tx.auditLog.create({
        data: {
          empresaId: pedido.empresaId,
          sucursalId: pedido.sucursalId,
          entidad: "PEDIDO",
          entidadId: pedidoId,
          accion: "CANCELAR",
          usuarioId: autorizadoPorId,
          datosNuevos: { motivo },
        },
      });
    });
    const actualizado = await this.obtener(pedidoId);
    this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.PEDIDO_ACTUALIZADO, actualizado);
    return actualizado;
  }

  // -- privados ---------------------------------------------------------------

  /** Devuelve el id solo si ese usuario existe de verdad; si no, undefined. Evita que un id
   *  huérfano tumbe la operación entera por violación de clave foránea. */
  private async resolverUsuarioExistente(usuarioId?: string | null): Promise<string | undefined> {
    if (!usuarioId) return undefined;
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true } });
    return usuario?.id;
  }

  private async resolverItem(item: { productoId: string; cantidad: number; notas?: string; modificadores?: { opcionModificadorId: string }[] }) {
    // findUniqueOrThrow revienta con un NotFoundError si el productoId no existe (ej. el POS
    // tenía el catálogo cacheado y alguien borró/desactivó ese producto entre medias) — sin este
    // try/catch se iba como 500 genérico ("Error interno del servidor"), sin decir cuál producto
    // ni qué hacer al respecto.
    const producto = await this.prisma.producto.findUnique({ where: { id: item.productoId } });
    if (!producto) {
      throw new BadRequestException(
        `Uno de los productos del pedido ya no existe en el catálogo (id: ${item.productoId}). Actualiza la app (F5 o reinicia el POS) y vuelve a agregarlo.`,
      );
    }
    const opciones = item.modificadores?.length
      ? await this.prisma.opcionModificador.findMany({
          where: { id: { in: item.modificadores.map((m) => m.opcionModificadorId) } },
        })
      : [];

    const modificadoresPrecio = opciones.reduce((acc, o) => acc + Number(o.precioExtra), 0);

    return {
      productoId: item.productoId,
      cantidad: item.cantidad,
      notas: item.notas,
      precioUnitario: Number(producto.precioBase),
      modificadoresPrecio,
      modificadoresSeleccionados: opciones.map((o) => ({ id: o.id, precioExtra: Number(o.precioExtra) })),
    };
  }

  private async recalcularTotales(pedidoId: string) {
    const [pedido, items, descuentos] = await Promise.all([
      this.prisma.pedido.findUniqueOrThrow({ where: { id: pedidoId }, include: { sucursal: true } }),
      this.prisma.pedidoItem.findMany({ where: { pedidoId }, include: { modificadores: true } }),
      this.prisma.descuento.findMany({ where: { pedidoId } }),
    ]);

    const itemsParaTotal = items.map((it) => ({
      precioUnitario: Number(it.precioUnitario),
      cantidad: it.cantidad,
      modificadoresPrecio: it.modificadores.reduce((s, m) => s + Number(m.precioExtra), 0),
    }));
    // los descuentos ya tienen su montoAplicado calculado y persistido (aplicarDescuento); aquí
    // se reexpresan como descuentos de tipo MONTO para reutilizar calcularTotalesPedido.
    const descuentosParaTotal = descuentos.map((d) => ({ tipo: TipoDescuento.MONTO, valor: Number(d.montoAplicado) }));
    const totales = calcularTotalesPedido(itemsParaTotal, descuentosParaTotal, Number(pedido.sucursal.tasaImpuesto));

    await this.prisma.pedido.update({ where: { id: pedidoId }, data: totales });
  }

  private async generarFolio(sucursalId: string): Promise<string> {
    const hoy = new Date();
    const prefijo = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}`;
    const conteo = await this.prisma.pedido.count({
      where: { sucursalId, createdAt: { gte: new Date(hoy.setHours(0, 0, 0, 0)) } },
    });
    return `${prefijo}-${String(conteo + 1).padStart(4, "0")}`;
  }

  /**
   * Devuelve al inventario lo que consumió una venta que se cancela. Espejo exacto de
   * `descontarInventarioPorReceta`: mismas recetas, mismas cantidades, signo contrario.
   *
   * Sin esto, cada cancelación dejaría un faltante fantasma en el almacén y la lista de compras
   * pediría reponer algo que nunca se usó.
   *
   * Se registra como ENTRADA con `referenciaId` del pedido, así que el rastro queda emparejado
   * con la SALIDA original y se puede auditar el par completo.
   */
  private async reponerInventarioPorReceta(
    pedido: Awaited<ReturnType<PedidosService["obtener"]>>,
    pedidoId: string,
  ) {
    for (const item of pedido.items) {
      const receta = await this.prisma.recetaItem.findMany({ where: { productoId: item.productoId } });
      for (const r of receta) {
        const cantidadReponer = Number(r.cantidad) * item.cantidad;
        await this.prisma.$transaction(async (tx) => {
          await tx.movimientoInventario.create({
            data: {
              sucursalId: pedido.sucursalId,
              insumoId: r.insumoId,
              tipo: TipoMovimientoInventario.ENTRADA,
              cantidad: cantidadReponer,
              motivo: `Cancelación del pedido ${pedido.folio}`,
              referenciaId: pedidoId,
            },
          });
          await tx.inventarioSucursal.upsert({
            where: { sucursalId_insumoId: { sucursalId: pedido.sucursalId, insumoId: r.insumoId } },
            update: { existencia: { increment: cantidadReponer } },
            create: { sucursalId: pedido.sucursalId, insumoId: r.insumoId, existencia: cantidadReponer, minimo: 0 },
          });
        });
      }
    }
  }

  private async descontarInventarioPorReceta(pedido: Awaited<ReturnType<PedidosService["obtener"]>>) {
    for (const item of pedido.items) {
      const receta = await this.prisma.recetaItem.findMany({ where: { productoId: item.productoId } });
      for (const r of receta) {
        const cantidadDescontar = Number(r.cantidad) * item.cantidad;
        await this.prisma.$transaction(async (tx) => {
          await tx.movimientoInventario.create({
            data: {
              sucursalId: pedido.sucursalId,
              insumoId: r.insumoId,
              tipo: TipoMovimientoInventario.SALIDA,
              cantidad: cantidadDescontar,
              motivo: `Venta pedido ${pedido.folio}`,
              referenciaId: pedido.id,
            },
          });
          const inv = await tx.inventarioSucursal.upsert({
            where: { sucursalId_insumoId: { sucursalId: pedido.sucursalId, insumoId: r.insumoId } },
            update: { existencia: { decrement: cantidadDescontar } },
            create: { sucursalId: pedido.sucursalId, insumoId: r.insumoId, existencia: -cantidadDescontar, minimo: 0 },
          });
          if (Number(inv.existencia) <= Number(inv.minimo)) {
            this.realtime.emitirASucursal(pedido.sucursalId, WS_EVENTS.INVENTARIO_ALERTA, inv);
            this.realtime.emitirAEmpresa(pedido.empresaId, WS_EVENTS.INVENTARIO_ALERTA, inv);
          }
        });
      }
    }
  }
}
