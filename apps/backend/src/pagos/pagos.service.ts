import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  AmbienteProveedorPago,
  EstadoSolicitudPago,
  MetodoPago,
  OrigenEventoPago,
  WS_EVENTS,
} from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CifradoService } from "../common/crypto/cifrado.service";
import { PedidosService } from "../pedidos/pedidos.service";
import { PushService } from "./push.service";
import { ProveedorPagoRegistry } from "./proveedores/proveedor-pago.registry";
import { CredencialesProveedor } from "./proveedores/proveedor-pago.interface";
import {
  ActualizarTerminalDto,
  CrearSolicitudPagoDto,
  CrearTerminalDto,
  GuardarConfigProveedorDto,
} from "./dto/pagos.dto";

/** Ventana en la que una solicitud de pago con tarjeta debe atenderse en la APK antes de darla
 *  por vencida automáticamente — más holgada que el `expiration_time` que se le manda a Mercado
 *  Pago para la propia orden en la terminal (ver mercadopago.adapter.ts), porque cubre también
 *  el tiempo en que el mesero aún no ha tocado "Iniciar cobro". */
const MINUTOS_EXPIRACION_SOLICITUD = 8;

/** Estados desde los que ya no se permite ninguna transición nueva — evita que un webhook tardío
 *  o una consulta de estado dupliquen/reviertan un resultado ya asentado. */
const ESTADOS_TERMINALES = new Set<EstadoSolicitudPago>([
  EstadoSolicitudPago.APROBADO,
  EstadoSolicitudPago.RECHAZADO,
  EstadoSolicitudPago.CANCELADO,
  EstadoSolicitudPago.EXPIRADO,
]);

@Injectable()
export class PagosService {
  private readonly logger = new Logger(PagosService.name);

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private cifrado: CifradoService,
    private proveedores: ProveedorPagoRegistry,
    private pedidos: PedidosService,
    private push: PushService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Configuración de proveedores (Administración > Terminales de pago)
  // -------------------------------------------------------------------------------------------

  async guardarConfigProveedor(dto: GuardarConfigProveedorDto) {
    const adaptador = this.proveedores.obtener(dto.proveedor);
    const credenciales: CredencialesProveedor = {
      ambiente: dto.ambiente,
      identificadorComercio: dto.identificadorComercio ?? null,
      webhookUrl: dto.webhookUrl ?? null,
      extra: dto.credenciales,
    };
    adaptador.validarConfiguracion(credenciales);

    const data = {
      empresaId: dto.empresaId,
      sucursalId: dto.sucursalId ?? null,
      proveedor: dto.proveedor,
      ambiente: dto.ambiente,
      identificadorComercio: dto.identificadorComercio ?? null,
      webhookUrl: dto.webhookUrl ?? null,
      credencialesCifradas: this.cifrado.cifrarJson(dto.credenciales),
    };

    const config = await this.prisma.paymentProviderConfig.upsert({
      where: { empresaId_sucursalId_proveedor: { empresaId: dto.empresaId, sucursalId: dto.sucursalId ?? null, proveedor: dto.proveedor } as any },
      update: data,
      create: data,
    });
    return this.sanearConfig(config);
  }

  async listarConfigProveedor(empresaId: string) {
    const configs = await this.prisma.paymentProviderConfig.findMany({ where: { empresaId } });
    return configs.map((c) => this.sanearConfig(c));
  }

  async probarConexionProveedor(configId: string) {
    const { adaptador, credenciales } = await this.cargarAdaptador(configId);
    return adaptador.probarConexion(credenciales);
  }

  async terminalesDisponiblesProveedor(configId: string) {
    const { adaptador, credenciales } = await this.cargarAdaptador(configId);
    return adaptador.listarTerminales(credenciales);
  }

  /** Nunca devuelve `credencialesCifradas` — ni cifrada ni mucho menos en claro; el frontend
   *  solo necesita saber que la config existe y está activa. */
  private sanearConfig(config: { credencialesCifradas: string; [k: string]: unknown }) {
    const { credencialesCifradas: _omit, ...resto } = config;
    return resto;
  }

  private async cargarAdaptador(configId: string) {
    const config = await this.prisma.paymentProviderConfig.findUnique({ where: { id: configId } });
    if (!config) throw new NotFoundException("Configuración de proveedor de pago no encontrada");
    const extra = this.cifrado.descifrarJson<Record<string, string>>(config.credencialesCifradas);
    const credenciales: CredencialesProveedor = {
      ambiente: config.ambiente as unknown as AmbienteProveedorPago,
      identificadorComercio: config.identificadorComercio,
      webhookUrl: config.webhookUrl,
      extra,
    };
    return { config, adaptador: this.proveedores.obtener(config.proveedor), credenciales };
  }

  // -------------------------------------------------------------------------------------------
  // Terminales
  // -------------------------------------------------------------------------------------------

  async crearTerminal(dto: CrearTerminalDto) {
    const sucursal = await this.prisma.sucursal.findUnique({ where: { id: dto.sucursalId }, select: { empresaId: true } });
    if (!sucursal) throw new BadRequestException("Sucursal no encontrada");
    try {
      return await this.prisma.paymentTerminal.create({
        data: {
          empresaId: sucursal.empresaId,
          sucursalId: dto.sucursalId,
          cajaId: dto.cajaId,
          proveedorConfigId: dto.proveedorConfigId,
          nombre: dto.nombre,
          zona: dto.zona,
          meseroAsignadoId: dto.meseroAsignadoId,
          identificadorExterno: dto.identificadorExterno,
        },
      });
    } catch (e: any) {
      if (e?.code !== "P2003" && e?.code !== "P2002") throw e;
      throw new BadRequestException("No se pudo crear la terminal — revisa sucursal/caja/config de proveedor, o que el identificador externo no esté ya usado en esa configuración");
    }
  }

  async listarTerminales(sucursalId: string) {
    return this.prisma.paymentTerminal.findMany({
      where: { sucursalId },
      include: { caja: true, meseroAsignado: { select: { id: true, nombre: true } }, proveedorConfig: { select: { id: true, proveedor: true, ambiente: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async actualizarTerminal(id: string, dto: ActualizarTerminalDto) {
    await this.obtenerTerminal(id);
    return this.prisma.paymentTerminal.update({ where: { id }, data: dto });
  }

  async eliminarTerminal(id: string) {
    await this.obtenerTerminal(id);
    try {
      await this.prisma.paymentTerminal.delete({ where: { id } });
    } catch (e: any) {
      if (e?.code === "P2003") {
        throw new BadRequestException("No se puede eliminar: esta terminal tiene solicitudes de pago en su historial. Desactívala en vez de eliminarla.");
      }
      throw e;
    }
    return { ok: true };
  }

  async probarConexionTerminal(id: string) {
    const terminal = await this.obtenerTerminal(id);
    const { adaptador, credenciales } = await this.cargarAdaptador(terminal.proveedorConfigId);
    const resultado = await adaptador.probarConexion(credenciales);
    await this.prisma.paymentTerminal.update({
      where: { id },
      data: { estadoConexion: resultado.ok ? "CONECTADA" : "ERROR", ultimaSincronizacion: new Date() },
    });
    return resultado;
  }

  historialTerminal(id: string) {
    return this.prisma.paymentRequest.findMany({
      where: { terminalId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  private async obtenerTerminal(id: string) {
    const terminal = await this.prisma.paymentTerminal.findUnique({ where: { id } });
    if (!terminal) throw new NotFoundException("Terminal no encontrada");
    return terminal;
  }

  // -------------------------------------------------------------------------------------------
  // Solicitudes de pago
  // -------------------------------------------------------------------------------------------

  async crearSolicitud(dto: CrearSolicitudPagoDto, creadoPorId: string) {
    const existente = await this.prisma.paymentRequest.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existente) return this.toDTO(existente);

    const activa = await this.prisma.paymentRequest.findFirst({
      where: { pedidoId: dto.pedidoId, estado: { notIn: Array.from(ESTADOS_TERMINALES) } },
    });
    if (activa) {
      throw new BadRequestException("Ya hay una solicitud de pago con tarjeta en curso para esta cuenta — espera a que termine o cancélala antes de crear otra.");
    }

    const pedido = await this.prisma.pedido.findUnique({ where: { id: dto.pedidoId } });
    if (!pedido) throw new NotFoundException("Pedido no encontrado");

    const pagosPrevios = await this.prisma.pago.aggregate({ where: { pedidoId: dto.pedidoId }, _sum: { monto: true } });
    const faltante = Number(pedido.total) - Number(pagosPrevios._sum.monto ?? 0);
    if (dto.importe > faltante + 0.01) {
      throw new BadRequestException(`El importe (${dto.importe}) excede lo que falta por cobrar de esta cuenta (${faltante.toFixed(2)})`);
    }

    const terminal = await this.obtenerTerminal(dto.terminalId);
    if (!terminal.activo) throw new BadRequestException("La terminal seleccionada está desactivada");

    const solicitud = await this.prisma.paymentRequest.create({
      data: {
        empresaId: pedido.empresaId,
        sucursalId: pedido.sucursalId,
        pedidoId: pedido.id,
        mesaId: pedido.mesaId,
        meseroId: pedido.meseroId,
        terminalId: terminal.id,
        proveedor: terminal.proveedorConfigId ? (await this.prisma.paymentProviderConfig.findUnique({ where: { id: terminal.proveedorConfigId }, select: { proveedor: true } }))!.proveedor : "mock",
        referenciaInterna: dto.idempotencyKey,
        importe: dto.importe,
        moneda: dto.moneda ?? "MXN",
        idempotencyKey: dto.idempotencyKey,
        creadoPorId,
        expiraEn: new Date(Date.now() + MINUTOS_EXPIRACION_SOLICITUD * 60_000),
      },
    });

    await this.registrarEvento(solicitud.id, "CREADA", OrigenEventoPago.POS);
    // PAGO_SOLICITADO (no PAGO_ACTUALIZADO) — es lo que la APK escucha para abrir la pantalla de
    // cobro / disparar la notificación, distinto de una actualización sobre una que ya tiene abierta.
    this.realtime.emitirASucursal(solicitud.sucursalId, WS_EVENTS.PAGO_SOLICITADO, solicitud);
    if (solicitud.meseroId) {
      this.realtime.emitirAUsuario(solicitud.meseroId, WS_EVENTS.PAGO_SOLICITADO, solicitud);
      await this.push.enviarPush(solicitud.meseroId, "Cobro con tarjeta", `Se solicitó un cobro de $${Number(solicitud.importe).toFixed(2)} ${solicitud.moneda}`, { paymentRequestId: solicitud.id });
    }
    return this.toDTO(solicitud);
  }

  /** Confirmación explícita del mesero (o del cajero, según cómo se configure el negocio) — solo
   *  hasta aquí se llama de verdad al proveedor y se manda el cobro a la terminal física. */
  async iniciarCobro(id: string, origen: OrigenEventoPago) {
    const solicitud = await this.expirarSiCorresponde(await this.obtenerSolicitud(id));
    if (solicitud.estado !== EstadoSolicitudPago.PENDIENTE) {
      throw new BadRequestException(`No se puede iniciar el cobro: la solicitud está en estado ${solicitud.estado}`);
    }

    const terminal = await this.obtenerTerminal(solicitud.terminalId);
    const { adaptador, credenciales } = await this.cargarAdaptador(terminal.proveedorConfigId);

    const resultado = await adaptador.crearSolicitudDePago(credenciales, {
      referenciaInterna: solicitud.referenciaInterna,
      identificadorExternoTerminal: terminal.identificadorExterno,
      importe: Number(solicitud.importe),
      moneda: solicitud.moneda,
      descripcion: `Pedido ${solicitud.pedidoId}`,
    });

    if (resultado.estado === "ERROR") {
      return this.transicionar(solicitud.id, EstadoSolicitudPago.ERROR, origen, resultado.motivoError);
    }
    const actualizada = await this.prisma.paymentRequest.update({
      where: { id: solicitud.id },
      data: { referenciaExterna: resultado.referenciaExterna, estado: EstadoSolicitudPago.ENVIADO_A_TERMINAL },
    });
    await this.registrarEvento(solicitud.id, "ENVIADO_A_TERMINAL", origen, { referenciaExterna: resultado.referenciaExterna });
    this.emitir(actualizada);
    return this.toDTO(actualizada);
  }

  async cancelarSolicitud(id: string, origen: OrigenEventoPago) {
    const solicitud = await this.expirarSiCorresponde(await this.obtenerSolicitud(id));
    if (ESTADOS_TERMINALES.has(solicitud.estado as EstadoSolicitudPago)) {
      return this.toDTO(solicitud); // ya está en un estado final — cancelar es idempotente, no error
    }
    if (solicitud.referenciaExterna) {
      const terminal = await this.obtenerTerminal(solicitud.terminalId);
      const { adaptador, credenciales } = await this.cargarAdaptador(terminal.proveedorConfigId);
      try {
        await adaptador.cancelarSolicitudDePago(credenciales, solicitud.referenciaExterna);
      } catch (e: any) {
        this.logger.warn(`No se pudo cancelar en el proveedor (se cancela igual localmente): ${e.message}`);
      }
    }
    return this.transicionar(id, EstadoSolicitudPago.CANCELADO, origen);
  }

  /** Fallback de polling (además del webhook) — lo usa el POS/APK si quiere forzar una
   *  relectura, y también sirve de red de seguridad si un webhook se perdiera. */
  async consultarEstado(id: string) {
    const solicitud = await this.expirarSiCorresponde(await this.obtenerSolicitud(id));
    if (ESTADOS_TERMINALES.has(solicitud.estado as EstadoSolicitudPago) || !solicitud.referenciaExterna) {
      return this.toDTO(solicitud);
    }
    const terminal = await this.obtenerTerminal(solicitud.terminalId);
    const { adaptador, credenciales } = await this.cargarAdaptador(terminal.proveedorConfigId);
    const consulta = await adaptador.consultarEstadoDePago(credenciales, solicitud.referenciaExterna);
    return this.transicionar(id, consulta.estado as EstadoSolicitudPago, OrigenEventoPago.SISTEMA, consulta.motivoError, consulta.payloadSanitizado);
  }

  async manejarWebhook(proveedorConfigId: string, peticion: { headers: Record<string, string>; query: Record<string, string>; body: unknown }) {
    const { adaptador, credenciales } = await this.cargarAdaptador(proveedorConfigId);
    const procesado = await adaptador.procesarWebhook(credenciales, peticion);

    const solicitud = procesado.referenciaInterna
      ? await this.prisma.paymentRequest.findUnique({ where: { referenciaInterna: procesado.referenciaInterna } })
      : await this.prisma.paymentRequest.findFirst({ where: { referenciaExterna: procesado.referenciaExterna ?? "__ninguna__" } });

    if (!solicitud) {
      this.logger.warn(`Webhook de ${adaptador.codigo} sin PaymentRequest correspondiente (ref interna=${procesado.referenciaInterna}, externa=${procesado.referenciaExterna})`);
      return { ok: true }; // 200 igual — Mercado Pago reintenta si respondemos error, y no hay nada que reintentar aquí
    }

    await this.transicionar(solicitud.id, procesado.estado as EstadoSolicitudPago, OrigenEventoPago.WEBHOOK, procesado.motivoError, procesado.payloadSanitizado);
    return { ok: true };
  }

  async obtener(id: string) {
    return this.toDTO(await this.expirarSiCorresponde(await this.obtenerSolicitud(id)));
  }

  async listarPorPedido(pedidoId: string) {
    const solicitudes = await this.prisma.paymentRequest.findMany({ where: { pedidoId }, orderBy: { createdAt: "desc" } });
    return Promise.all(solicitudes.map((s) => this.expirarSiCorresponde(s).then((r) => this.toDTO(r))));
  }

  // -------------------------------------------------------------------------------------------
  // Máquina de estados
  // -------------------------------------------------------------------------------------------

  private async transicionar(
    id: string,
    nuevoEstado: EstadoSolicitudPago,
    origen: OrigenEventoPago,
    motivoError?: string,
    payloadSanitizado?: Record<string, unknown>,
  ) {
    const solicitud = await this.obtenerSolicitud(id);
    // Idempotente: una vez en un estado terminal, ningún webhook/consulta tardía lo puede mover
    // — evita que un pago ya marcado APROBADO (y ya liquidado en `pedidos.cobrar()`) se revierta
    // o se vuelva a procesar por una notificación duplicada del proveedor.
    if (ESTADOS_TERMINALES.has(solicitud.estado as EstadoSolicitudPago)) return this.toDTO(solicitud);
    if (solicitud.estado === nuevoEstado) return this.toDTO(solicitud);

    const actualizada = await this.prisma.paymentRequest.update({
      where: { id },
      data: { estado: nuevoEstado, motivoError: motivoError ?? null },
    });
    await this.registrarEvento(id, nuevoEstado, origen, payloadSanitizado);
    this.emitir(actualizada);

    if (nuevoEstado === EstadoSolicitudPago.APROBADO) {
      await this.liquidarPedido(actualizada);
    }
    return this.toDTO(actualizada);
  }

  /** Único punto donde una solicitud de pago con tarjeta aprobada se convierte en un `Pago` real
   *  y liquida la cuenta — reutiliza PedidosService.cobrar() tal cual, así hereda gratis su
   *  idempotencia, descuento de inventario, liberar mesa y emisión de PEDIDO_ACTUALIZADO/
   *  MESA_ACTUALIZADA (ver pedidos.service.ts). Nunca se llega aquí sin que el proveedor haya
   *  confirmado el pago (webhook verificado o consulta directa a su API) — nunca por lo que
   *  reporte la APK. */
  private async liquidarPedido(solicitud: { pedidoId: string; importe: any; referenciaExterna: string | null; creadoPorId: string }) {
    try {
      await this.pedidos.cobrar(solicitud.pedidoId, {
        pagos: [{ metodo: MetodoPago.TARJETA, monto: Number(solicitud.importe), referencia: solicitud.referenciaExterna ?? undefined }],
        cajeroId: solicitud.creadoPorId,
      } as any);
    } catch (e: any) {
      // El pago con el proveedor ya se aprobó — si esto falla (ej. la cuenta ya se había cerrado
      // por otro medio) no se debe perder el dinero recibido; queda registrado en PaymentEvent
      // para revisión manual en vez de fallar en silencio.
      this.logger.error(`Pago APROBADO pero no se pudo liquidar el pedido ${solicitud.pedidoId}: ${e.message}`);
      await this.registrarEvento((solicitud as any).id, "ERROR_AL_LIQUIDAR", OrigenEventoPago.SISTEMA, { error: e.message });
    }
  }

  private async expirarSiCorresponde<T extends { id: string; estado: string; expiraEn: Date }>(solicitud: T): Promise<T> {
    if (ESTADOS_TERMINALES.has(solicitud.estado as EstadoSolicitudPago)) return solicitud;
    if (solicitud.expiraEn.getTime() > Date.now()) return solicitud;
    const actualizada = await this.prisma.paymentRequest.update({
      where: { id: solicitud.id },
      data: { estado: EstadoSolicitudPago.EXPIRADO, motivoError: "La solicitud expiró sin completarse" },
    });
    await this.registrarEvento(solicitud.id, "EXPIRADA_AUTOMATICAMENTE", OrigenEventoPago.SISTEMA);
    this.emitir(actualizada);
    return actualizada as unknown as T;
  }

  private async registrarEvento(paymentRequestId: string, tipoEvento: string, origen: OrigenEventoPago, payloadSanitizado?: Record<string, unknown>) {
    await this.prisma.paymentEvent.create({
      data: { paymentRequestId, tipoEvento, origen, payloadSanitizado: payloadSanitizado as any },
    });
  }

  private emitir(solicitud: { sucursalId: string; meseroId: string | null }) {
    // A la sucursal (para que el POS que abrió la cuenta vea el estado en vivo) y directo al
    // mesero asignado (sala `usuario:{id}`, ver realtime.gateway.ts) — así la APK lo recibe al
    // instante mientras tenga el socket conectado, sin esperar a un poll.
    this.realtime.emitirASucursal(solicitud.sucursalId, WS_EVENTS.PAGO_ACTUALIZADO, solicitud);
    if (solicitud.meseroId) this.realtime.emitirAUsuario(solicitud.meseroId, WS_EVENTS.PAGO_ACTUALIZADO, solicitud);
  }

  private async obtenerSolicitud(id: string) {
    const solicitud = await this.prisma.paymentRequest.findUnique({ where: { id } });
    if (!solicitud) throw new NotFoundException("Solicitud de pago no encontrada");
    return solicitud;
  }

  private toDTO(s: any) {
    return s;
  }
}
