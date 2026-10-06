import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlataformaConfig, PlataformaOrdenSync } from "@prisma/client";
import { randomUUID } from "crypto";
import {
  AmbientePlataforma,
  CanalOrigen,
  ConfirmacionPlataforma,
  EstadoConexionPlataforma,
  EstadoSincronizacionOrdenPlataforma,
  PlataformaDelivery,
  TipoPedido,
} from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CifradoService } from "../common/crypto/cifrado.service";
import { PedidosService } from "../pedidos/pedidos.service";
import { CIFRADO_PLATAFORMAS } from "./plataformas.tokens";
import { PlataformaDeliveryRegistry } from "./proveedores/plataforma-delivery.registry";
import { CredencialesPlataforma, ItemOrdenExterna, PeticionWebhook, PlataformaDeliveryAdapter, ResultadoAccionPlataforma, ResultadoPruebaConexionPlataforma } from "./proveedores/plataforma-delivery.interface";
import {
  AceptarPedidoEntranteDto,
  EventoPlataformaDto,
  FiltrosPedidosEntrantes,
  GuardarConfigPlataformaDto,
  PedidoEntranteDto,
  PlataformaConfigDto,
} from "./dto/plataformas.dto";

type ConfigRow = PlataformaConfig;
/** Un reclamo de "aceptando…" caduca a los 2 min (terminal caída a media operación). */
const RECLAMO_VIGENCIA_MS = 2 * 60_000;
type OrdenRow = PlataformaOrdenSync;

@Injectable()
export class PlataformasService {
  private readonly logger = new Logger(PlataformasService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @Inject(CIFRADO_PLATAFORMAS) private cifrado: CifradoService,
    private registry: PlataformaDeliveryRegistry,
    private pedidos: PedidosService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Consulta / configuración (Administración > Plataformas)
  // -------------------------------------------------------------------------------------------

  /** Una config por plataforma. Con `sucursalId`, la cuenta propia de esa sucursal (si existe)
   *  gana sobre la de toda la empresa. */
  async listar(empresaId: string, sucursalId: string | null = null): Promise<PlataformaConfigDto[]> {
    const configs = await this.prisma.plataformaConfig.findMany({
      where: { empresaId, sucursalId: sucursalId ? { in: [sucursalId] } : null },
    });
    const deEmpresa = sucursalId ? await this.prisma.plataformaConfig.findMany({ where: { empresaId, sucursalId: null } }) : [];
    const porCodigo = new Map<string, ConfigRow>();
    for (const c of [...deEmpresa, ...configs]) porCodigo.set(c.plataforma, c); // la de sucursal pisa

    const resultado: PlataformaConfigDto[] = [];
    for (const codigo of Object.values(PlataformaDelivery) as PlataformaDelivery[]) {
      const adaptador = this.registry.obtener(codigo);
      const config = porCodigo.get(codigo);
      if (!config) {
        resultado.push(this.placeholderDto(empresaId, sucursalId, codigo, adaptador));
        continue;
      }
      const conteos = await this.contarOrdenes(config.id);
      resultado.push(this.toDto(config, adaptador, conteos));
    }
    return resultado;
  }

  async obtenerUno(plataforma: string, empresaId: string, sucursalId: string | null = null): Promise<PlataformaConfigDto> {
    const adaptador = this.registry.obtener(plataforma);
    const config =
      (sucursalId ? await this.prisma.plataformaConfig.findFirst({ where: { empresaId, sucursalId, plataforma } }) : null) ??
      (await this.prisma.plataformaConfig.findFirst({ where: { empresaId, sucursalId: null, plataforma } }));
    if (!config) return this.placeholderDto(empresaId, sucursalId, plataforma, adaptador);
    const conteos = await this.contarOrdenes(config.id);
    return this.toDto(config, adaptador, conteos);
  }

  /** Guarda la configuración, cifra las credenciales, y prueba la conexión de inmediato para que
   *  la respuesta ya refleje el estado real — evita que el frontend tenga que encadenar un
   *  segundo llamado a "Probar conexión" justo después de guardar. */
  async guardarConfig(plataforma: string, dto: GuardarConfigPlataformaDto, user: any): Promise<PlataformaConfigDto> {
    const adaptador = this.registry.obtener(plataforma);
    const credenciales: CredencialesPlataforma = {
      ambiente: dto.ambiente as unknown as "SANDBOX" | "PRODUCCION",
      identificadorTienda: dto.identificadorTienda ?? null,
      extra: dto.credenciales,
    };
    adaptador.validarConfiguracion(credenciales);

    const empresaId = user.empresaId;
    const sucursalId = dto.sucursalId ?? null;
    const data = {
      empresaId,
      sucursalId,
      plataforma,
      ambiente: dto.ambiente,
      activo: dto.activo,
      identificadorTienda: dto.identificadorTienda ?? null,
      credencialesCifradas: this.cifrado.cifrarJson(dto.credenciales),
      credencialesUltimos4: adaptador.campoPrincipalEnmascarado(credenciales),
      clientSecretConfigurado: adaptador.tieneClientSecret(credenciales),
    };

    // findFirst + update/create en vez de upsert: Prisma no acepta `null` dentro de un unique
    // compuesto (sucursalId null = cuenta de toda la empresa) y Postgres no considera iguales
    // dos NULL, así que el upsert podía duplicar filas.
    const existente = await this.prisma.plataformaConfig.findFirst({ where: { empresaId, sucursalId, plataforma } });
    let config = existente
      ? await this.prisma.plataformaConfig.update({ where: { id: existente.id }, data })
      : await this.prisma.plataformaConfig.create({ data });

    const resultado = await adaptador.probarConexion(credenciales);
    config = await this.aplicarResultadoPrueba(config.id, resultado);

    // Auditoría manual (sin @Audit en el controlador) — el body de este endpoint trae
    // credenciales en claro; @Audit registraría el body completo en AuditLog.datosNuevos.
    await this.auditarSinSecretos(user, "PLATAFORMA_CONFIG", "GUARDAR", config.id, {
      plataforma,
      ambiente: dto.ambiente,
      activo: dto.activo,
      identificadorTienda: dto.identificadorTienda ?? null,
      sucursalId,
    });

    const conteos = await this.contarOrdenes(config.id);
    return this.toDto(config, adaptador, conteos);
  }

  async probarConexion(configId: string, empresaId?: string): Promise<ResultadoPruebaConexionPlataforma> {
    const { config, adaptador, credenciales } = await this.cargarAdaptador(configId, empresaId);
    const resultado = await adaptador.probarConexion(credenciales);
    await this.aplicarResultadoPrueba(config.id, resultado);
    return resultado;
  }

  async reconectar(configId: string, empresaId?: string): Promise<ResultadoPruebaConexionPlataforma> {
    const { config, adaptador, credenciales } = await this.cargarAdaptador(configId, empresaId);
    const resultado = await adaptador.probarConexion(credenciales);
    await this.aplicarResultadoPrueba(config.id, resultado, resultado.ok);
    return resultado;
  }

  /** Nunca borra `credencialesCifradas` — así "Reconectar" no exige volver a capturar todo. */
  async desconectar(configId: string, empresaId?: string): Promise<PlataformaConfigDto> {
    await this.obtenerConfigOFallar(configId, empresaId);
    const actualizado = await this.prisma.plataformaConfig.update({
      where: { id: configId },
      data: { activo: false, estadoConexion: EstadoConexionPlataforma.DESCONECTADA },
    });
    const adaptador = this.registry.obtener(actualizado.plataforma);
    const conteos = await this.contarOrdenes(actualizado.id);
    return this.toDto(actualizado, adaptador, conteos);
  }

  async regenerarWebhook(configId: string, empresaId?: string): Promise<{ webhookUrl: string }> {
    await this.obtenerConfigOFallar(configId, empresaId);
    const actualizado = await this.prisma.plataformaConfig.update({
      where: { id: configId },
      data: { webhookSlug: randomUUID() },
    });
    return { webhookUrl: this.construirWebhookUrl(actualizado.plataforma, actualizado.webhookSlug) };
  }

  // -------------------------------------------------------------------------------------------
  // Webhooks entrantes
  // -------------------------------------------------------------------------------------------

  /** Nunca responde 500 a la plataforma (provocaría una tormenta de reintentos): todo caso
   *  inválido (firma, config inexistente o desactivada) se registra y responde {ok:true}. Los
   *  rechazos quedan en PlataformaWebhookEvent con `procesadoOk = false` para que la bandeja los
   *  muestre como "errores de sincronización". La idempotencia la da el índice único de
   *  PlataformaWebhookEvent(plataformaConfigId, eventoExternoId): un reenvío choca (P2002) y se
   *  descarta sin reprocesar. */
  async manejarWebhook(plataforma: string, webhookSlug: string, peticion: PeticionWebhook): Promise<{ ok: true }> {
    const config = await this.prisma.plataformaConfig.findUnique({ where: { webhookSlug } });
    if (!config || config.plataforma !== plataforma) {
      this.logger.warn(`Webhook recibido para ${plataforma} sin configuración correspondiente`);
      return { ok: true };
    }
    const credenciales = this.credencialesDe(config);
    if (!credenciales) {
      await this.registrarEventoFallido(config.id, "Llegó un webhook pero la integración no tiene credenciales guardadas.");
      return { ok: true };
    }
    const adaptador = this.registry.obtener(config.plataforma);

    let procesado;
    try {
      procesado = await adaptador.procesarWebhook(credenciales, peticion);
    } catch (e: any) {
      this.logger.warn(`Webhook de ${plataforma} (config ${config.id}) rechazado: ${e.message}`);
      await this.registrarEventoFallido(config.id, e.message ?? "Webhook rechazado");
      return { ok: true };
    }

    if (!config.activo && procesado.orden && !procesado.orden.cancelada) {
      await this.registrarEventoFallido(config.id, `Pedido ${procesado.orden.ordenExternaId} ignorado: la integración está desactivada en el POS.`);
      return { ok: true };
    }

    try {
      await this.prisma.plataformaWebhookEvent.create({
        data: {
          plataformaConfigId: config.id,
          eventoExternoId: procesado.eventoExternoId,
          tipoEvento: procesado.orden?.tipoEvento ?? "sin-orden-asociada",
          payloadSanitizado: (procesado.orden?.payloadSanitizado ?? null) as any,
        },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        this.logger.log(`Webhook de ${plataforma} duplicado (evento ${procesado.eventoExternoId}) — ignorado`);
        return { ok: true };
      }
      this.logger.error(`Error al registrar evento de webhook de ${plataforma}: ${e.message}`);
      return { ok: true };
    }

    const orden = procesado.orden;
    if (orden) {
      const llave = { plataformaConfigId_ordenExternaId: { plataformaConfigId: config.id, ordenExternaId: orden.ordenExternaId } as any };
      const existente = await this.prisma.plataformaOrdenSync.findUnique({ where: llave });
      if (!existente) {
        await this.prisma.plataformaOrdenSync.create({
          data: {
            plataformaConfigId: config.id,
            ordenExternaId: orden.ordenExternaId,
            estado: orden.cancelada ? EstadoSincronizacionOrdenPlataforma.CANCELADA : EstadoSincronizacionOrdenPlataforma.RECIBIDA,
            estadoExterno: orden.estadoExterno,
            clienteNombre: orden.clienteNombre ?? null,
            totalExterno: orden.total ?? null,
            payloadSanitizado: orden.payloadSanitizado as any,
          },
        }).catch((e: any) => {
          // Dos webhooks de la misma orden al mismo tiempo: el segundo choca con el único.
          if (e?.code !== "P2002") throw e;
        });
      } else if (orden.cancelada) {
        // Cancelada por la plataforma: si nadie la aceptó, sale de pendientes. Si ya se aceptó,
        // se conserva el estado y solo se marca el estado externo (la bandeja avisa).
        await this.prisma.plataformaOrdenSync.updateMany({
          where: { id: existente.id, estado: EstadoSincronizacionOrdenPlataforma.RECIBIDA, pedidoId: null },
          data: { estado: EstadoSincronizacionOrdenPlataforma.CANCELADA, estadoExterno: orden.estadoExterno },
        });
        await this.prisma.plataformaOrdenSync.updateMany({
          where: { id: existente.id, estado: { not: EstadoSincronizacionOrdenPlataforma.RECIBIDA } },
          data: { estadoExterno: orden.estadoExterno },
        });
      } else if (existente.estado === EstadoSincronizacionOrdenPlataforma.RECIBIDA) {
        // Actualización de una orden pendiente: se refrescan los datos, nunca el estado.
        await this.prisma.plataformaOrdenSync.update({
          where: { id: existente.id },
          data: {
            estadoExterno: orden.estadoExterno,
            clienteNombre: orden.clienteNombre ?? existente.clienteNombre,
            totalExterno: orden.total ?? existente.totalExterno,
            payloadSanitizado: orden.payloadSanitizado as any,
          },
        });
      } else {
        await this.prisma.plataformaOrdenSync.update({ where: { id: existente.id }, data: { estadoExterno: orden.estadoExterno } });
      }
    }

    await this.prisma.plataformaConfig.update({ where: { id: config.id }, data: { ultimaSincronizacion: new Date() } });
    return { ok: true };
  }

  // -------------------------------------------------------------------------------------------
  // Pedidos entrantes (bandeja)
  //
  // Un pedido recibido nunca se convierte solo en un Pedido real: el cajero empareja cada item
  // con un producto del catálogo y lo acepta. Ahí se confirma en la plataforma (si su API lo
  // permite) y recién después se crea el Pedido con PedidosService.crear() — mismo folio,
  // totales y evento a cocina que un pedido tomado en el POS.
  // -------------------------------------------------------------------------------------------

  async listarPedidosEntrantes(empresaId: string, filtros: FiltrosPedidosEntrantes = {}): Promise<PedidoEntranteDto[]> {
    const configs = await this.prisma.plataformaConfig.findMany({
      where: {
        empresaId,
        ...(filtros.plataforma ? { plataforma: filtros.plataforma } : {}),
        // Una terminal ve las cuentas de toda la empresa y las de su propia sucursal.
        ...(filtros.sucursalId ? { OR: [{ sucursalId: null }, { sucursalId: filtros.sucursalId }] } : {}),
      },
      select: { id: true },
    });
    if (configs.length === 0) return [];
    const estado = filtros.estado ?? EstadoSincronizacionOrdenPlataforma.RECIBIDA;
    const ordenes = await this.prisma.plataformaOrdenSync.findMany({
      where: {
        plataformaConfigId: { in: configs.map((c) => c.id) },
        ...(estado === "TODOS" ? {} : { estado: estado as EstadoSincronizacionOrdenPlataforma }),
        ...(filtros.desde ? { createdAt: { gte: filtros.desde } } : {}),
      },
      include: { plataformaConfig: true },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(filtros.limite ?? 100, 1), 300),
    });
    return ordenes.map((o) => this.toDtoEntrante(o, this.registry.obtener(o.plataformaConfig.plataforma)));
  }

  async obtenerPedidoEntrante(id: string, empresaId?: string): Promise<PedidoEntranteDto> {
    const orden = await this.obtenerOrdenOFallar(id, empresaId);
    return this.toDtoEntrante(orden, this.registry.obtener(orden.plataformaConfig.plataforma));
  }

  /** Webhooks rechazados (firma, integración desactivada, sin credenciales) — "errores de
   *  sincronización" de la bandeja. Solo el motivo, nunca el payload. */
  async listarEventosConError(empresaId: string, limite = 50): Promise<EventoPlataformaDto[]> {
    const eventos = await this.prisma.plataformaWebhookEvent.findMany({
      where: { procesadoOk: false, plataformaConfig: { empresaId } },
      include: { plataformaConfig: { select: { plataforma: true } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limite, 1), 200),
    });
    return eventos.map((e) => ({
      id: e.id,
      plataforma: e.plataformaConfig.plataforma,
      motivo: e.motivoError ?? "Webhook rechazado",
      createdAt: e.createdAt,
    }));
  }

  /** Pedido de PRUEBA para verificar la bandeja sin una plataforma real. Solo en una integración
   *  en ambiente de Pruebas (o con PLATAFORMAS_SIMULACION_HABILITADA=true). Queda marcado
   *  `simulado`: la bandeja lo rotula "SIMULACIÓN" y aceptarlo nunca llama a la plataforma. */
  async simularPedido(empresaId: string, plataforma: string, sucursalId: string | null): Promise<PedidoEntranteDto> {
    const adaptador = this.registry.obtener(plataforma);
    if (!(Object.values(PlataformaDelivery) as string[]).includes(plataforma)) throw new BadRequestException("Plataforma no válida");
    let config =
      (sucursalId ? await this.prisma.plataformaConfig.findFirst({ where: { empresaId, sucursalId, plataforma } }) : null) ??
      (await this.prisma.plataformaConfig.findFirst({ where: { empresaId, sucursalId: null, plataforma } }));
    const permitidaPorEnv = this.config.get<string>("PLATAFORMAS_SIMULACION_HABILITADA") === "true";
    if (config && (config.ambiente as string) === AmbientePlataforma.PRODUCCION && !permitidaPorEnv) {
      throw new ForbiddenException(`${adaptador.nombreVisible} está en Producción: los pedidos de prueba solo se permiten en ambiente de Pruebas.`);
    }
    if (!config) {
      config = await this.prisma.plataformaConfig.create({
        data: { empresaId, sucursalId: null, plataforma, ambiente: AmbientePlataforma.SANDBOX as any, activo: false },
      });
    }
    const folio = `SIM-${Math.floor(Date.now() / 1000).toString(36).toUpperCase()}`;
    const items: ItemOrdenExterna[] = [
      { nombreExterno: "Latte", cantidad: 2, precioUnitario: 70, modificadores: ["Leche de avena"], notas: "Uno sin azúcar" },
      { nombreExterno: "Brownie de Manzana Verde", cantidad: 1, precioUnitario: 60 },
    ];
    const orden = await this.prisma.plataformaOrdenSync.create({
      data: {
        plataformaConfigId: config.id,
        ordenExternaId: folio,
        estado: EstadoSincronizacionOrdenPlataforma.RECIBIDA,
        estadoExterno: "SIMULADO",
        clienteNombre: "Cliente de prueba",
        totalExterno: 200,
        simulado: true,
        payloadSanitizado: {
          simulado: true,
          folioCorto: folio,
          items,
          notas: "Pedido de prueba generado desde el POS — no es real.",
          entrega: { tipo: "DELIVERY", repartidor: "Repartidor de prueba", horaEstimada: new Date(Date.now() + 20 * 60000).toISOString(), codigoEntrega: "1234" },
          montos: { subtotal: 200, envio: 0, propina: 0, descuento: 0 },
        } as any,
      },
    });
    return this.toDtoEntrante(orden, adaptador);
  }

  /**
   * Acepta un pedido entrante. Orden de operaciones (para que nunca se marque aceptado sin
   * confirmación y nunca se dupliquen pedidos con dos terminales):
   *  1. Reclamo atómico: `updateMany … where estado = RECIBIDA and pedidoId is null` fija el id
   *     del Pedido. Solo una terminal gana; la otra recibe 409 (o el pedido ya creado).
   *  2. Confirmación en la plataforma (aceptarOrden del adaptador). Si falla, se libera el
   *     reclamo y se responde 502 con un mensaje accionable — el pedido sigue pendiente.
   *     Si la integración no puede confirmar (DiDi, o API no configurada), se exige
   *     `confirmarManual: true`: el cajero declara que ya lo aceptó en la tablet de la plataforma.
   *  3. Se crea el Pedido (idempotente por id) y se marca SINCRONIZADA.
   * Si el paso 3 falla tras confirmar en la plataforma, la orden conserva `confirmacion` y el
   * reintento salta el paso 2.
   */
  async aceptarPedido(id: string, dto: AceptarPedidoEntranteDto, empresaId?: string) {
    let orden = await this.obtenerOrdenOFallar(id, empresaId);

    if (orden.estado === EstadoSincronizacionOrdenPlataforma.SINCRONIZADA && orden.pedidoId) {
      return this.pedidos.obtener(orden.pedidoId);
    }
    if (orden.estado !== EstadoSincronizacionOrdenPlataforma.RECIBIDA) {
      throw new BadRequestException(
        orden.estado === EstadoSincronizacionOrdenPlataforma.CANCELADA
          ? "La plataforma ya canceló este pedido — no se puede aceptar."
          : `Este pedido ya se marcó como "${orden.estado}" — no se puede volver a aceptar.`,
      );
    }

    const config = orden.plataformaConfig;
    const adaptador = this.registry.obtener(config.plataforma);
    const pedidoId = dto.pedidoId ?? randomUUID();

    // 1. Reclamo atómico (no se usa `pedidoId` porque es llave foránea al Pedido, que aún no existe).
    const reclamo = await this.prisma.plataformaOrdenSync.updateMany({
      where: { id: orden.id, estado: EstadoSincronizacionOrdenPlataforma.RECIBIDA, ...this.sinReclamoVigente() },
      data: { reclamadoPor: pedidoId, reclamadoEn: new Date() },
    });
    if (reclamo.count === 0) {
      orden = await this.obtenerOrdenOFallar(id, empresaId);
      if (orden.estado === EstadoSincronizacionOrdenPlataforma.SINCRONIZADA && orden.pedidoId) return this.pedidos.obtener(orden.pedidoId);
      if (orden.estado !== EstadoSincronizacionOrdenPlataforma.RECIBIDA) throw new BadRequestException(`El pedido cambió a "${orden.estado}" — actualiza la bandeja.`);
      throw new ConflictException("Este pedido se está aceptando ahora mismo (en otra terminal o en un intento anterior). Espera unos segundos y actualiza la bandeja.");
    }
    const liberar = (error: string) =>
      this.prisma.plataformaOrdenSync.updateMany({ where: { id: orden.id, reclamadoPor: pedidoId }, data: { reclamadoPor: null, reclamadoEn: null, ultimoIntentoError: error } });

    // 2. Confirmación en la plataforma.
    let confirmacion = orden.confirmacion as ConfirmacionPlataforma | null;
    if (!confirmacion) {
      try {
        confirmacion = await this.confirmarEnPlataforma(orden, adaptador, dto.confirmarManual === true, "aceptar");
      } catch (e) {
        await liberar((e as Error).message);
        throw e;
      }
      await this.prisma.plataformaOrdenSync.update({ where: { id: orden.id }, data: { confirmacion, ultimoIntentoError: null } });
    }

    // 3. Pedido real.
    const notas = [
      `Pedido de ${adaptador.nombreVisible} #${orden.ordenExternaId}`,
      orden.simulado ? "SIMULACIÓN" : null,
      orden.clienteNombre ? `Cliente: ${orden.clienteNombre}` : null,
      dto.notasGenerales,
    ].filter(Boolean).join(" — ");

    // `Pedido.turnoId` es llave foránea. El turno que manda la terminal puede no existir todavía
    // en el ERP (se abrió sin conexión y aún no sube): con él, Prisma rechazaría el pedido entero.
    const turnoId = dto.turnoId
      ? (await this.prisma.turno.findUnique({ where: { id: dto.turnoId }, select: { id: true } }))?.id
      : undefined;

    let pedido;
    try {
      pedido = await this.pedidos.crear({
        id: pedidoId,
        empresaId: config.empresaId,
        sucursalId: dto.sucursalId,
        turnoId,
        meseroId: dto.meseroId,
        dispositivoId: dto.dispositivoId,
        tipo: TipoPedido.DOMICILIO,
        canalOrigen: CanalOrigen.PLATAFORMA_DELIVERY,
        notasGenerales: notas,
        enviarInmediato: true,
        items: dto.items.map((it) => ({ productoId: it.productoId, cantidad: it.cantidad, notas: it.notas })),
      } as any);
    } catch (e: any) {
      await liberar(`Confirmado en ${adaptador.nombreVisible}, pero no se pudo crear el pedido: ${e?.message ?? "error"}. Vuelve a aceptar.`);
      throw e;
    }

    await this.prisma.plataformaOrdenSync.update({
      where: { id: orden.id },
      data: { estado: EstadoSincronizacionOrdenPlataforma.SINCRONIZADA, pedidoId: pedido.id, aceptadaEn: new Date(), ultimoIntentoError: null, reclamadoPor: null, reclamadoEn: null },
    });
    return pedido;
  }

  /** Rechaza: se confirma en la plataforma igual que aceptar (o MANUAL con confirmación del
   *  cajero). Si la plataforma falla, el pedido sigue pendiente. */
  async rechazarPedido(id: string, motivo: string, empresaId?: string, confirmarManual = false): Promise<PedidoEntranteDto> {
    const orden = await this.obtenerOrdenOFallar(id, empresaId);
    if (orden.estado !== EstadoSincronizacionOrdenPlataforma.RECIBIDA || orden.pedidoId) {
      throw new BadRequestException(`Este pedido ya se marcó como "${orden.estado}" — no se puede rechazar.`);
    }
    if (orden.reclamadoPor && orden.reclamadoEn && orden.reclamadoEn.getTime() > Date.now() - RECLAMO_VIGENCIA_MS) {
      throw new ConflictException("Este pedido se está aceptando en este momento — no se puede rechazar.");
    }
    const adaptador = this.registry.obtener(orden.plataformaConfig.plataforma);
    let confirmacion: ConfirmacionPlataforma;
    try {
      confirmacion = await this.confirmarEnPlataforma(orden, adaptador, confirmarManual, "rechazar", motivo);
    } catch (e) {
      await this.prisma.plataformaOrdenSync.update({ where: { id: orden.id }, data: { ultimoIntentoError: (e as Error).message } });
      throw e;
    }
    const actualizada = await this.prisma.plataformaOrdenSync.updateMany({
      where: { id: orden.id, estado: EstadoSincronizacionOrdenPlataforma.RECIBIDA, pedidoId: null, ...this.sinReclamoVigente() },
      data: { estado: EstadoSincronizacionOrdenPlataforma.IGNORADA, motivoError: motivo, confirmacion, ultimoIntentoError: null },
    });
    if (actualizada.count === 0) throw new ConflictException("El pedido cambió de estado mientras se rechazaba. Actualiza la bandeja.");
    return this.obtenerPedidoEntrante(id, empresaId);
  }

  private sinReclamoVigente() {
    return { OR: [{ reclamadoPor: null }, { reclamadoEn: { lt: new Date(Date.now() - RECLAMO_VIGENCIA_MS) } }] };
  }

  /** Lanza 502 si la plataforma falló, 409 (código CONFIRMACION_MANUAL_REQUERIDA) si no puede
   *  confirmar y el cajero no declaró haberlo hecho en la tablet de la plataforma. */
  private async confirmarEnPlataforma(
    orden: OrdenRow & { plataformaConfig: ConfigRow },
    adaptador: PlataformaDeliveryAdapter,
    confirmarManual: boolean,
    accion: "aceptar" | "rechazar",
    motivo = "",
  ): Promise<ConfirmacionPlataforma> {
    if (orden.simulado) return ConfirmacionPlataforma.SIMULADA;
    const credenciales = this.credencialesDe(orden.plataformaConfig);
    const metodo = accion === "aceptar" ? adaptador.aceptarOrden : adaptador.rechazarOrden;
    let resultado: ResultadoAccionPlataforma | null = null;
    if (credenciales && metodo && (orden.plataformaConfig.activo || accion === "rechazar")) {
      resultado = await metodo.call(adaptador, credenciales, orden.ordenExternaId, motivo);
    }
    if (resultado?.ok) return ConfirmacionPlataforma.CONFIRMADA;
    if (resultado && !resultado.ok) {
      if (confirmarManual) return ConfirmacionPlataforma.MANUAL;
      throw new BadGatewayException(`${resultado.detalle} El pedido sigue pendiente; si ya lo ${accion === "aceptar" ? "aceptaste" : "rechazaste"} en la tablet de ${adaptador.nombreVisible}, vuelve a intentar y confirma a mano.`);
    }
    if (!confirmarManual) {
      throw new ConflictException({
        codigo: "CONFIRMACION_MANUAL_REQUERIDA",
        message: `${adaptador.nombreVisible} no permite ${accion} desde el POS con la configuración actual. ${accion === "aceptar" ? "Acéptalo" : "Recházalo"} primero en la tablet de ${adaptador.nombreVisible} y luego confirma aquí.`,
      });
    }
    return ConfirmacionPlataforma.MANUAL;
  }
  // -------------------------------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------------------------------

  private async aplicarResultadoPrueba(configId: string, resultado: ResultadoPruebaConexionPlataforma, activar = false): Promise<ConfigRow> {
    return this.prisma.plataformaConfig.update({
      where: { id: configId },
      data: {
        estadoConexion: resultado.ok ? EstadoConexionPlataforma.CONECTADA : EstadoConexionPlataforma.ERROR,
        ...(resultado.ok
          ? { ultimaSincronizacion: new Date(), ultimoErrorMensaje: null, ultimoErrorEn: null }
          : { ultimoErrorMensaje: resultado.detalle, ultimoErrorEn: new Date() }),
        ...(activar ? { activo: true } : {}),
      },
    });
  }

  private async cargarAdaptador(configId: string, empresaId?: string) {
    const config = await this.obtenerConfigOFallar(configId, empresaId);
    if (!config.credencialesCifradas) {
      throw new BadRequestException("No hay credenciales guardadas para esta plataforma — guarda la configuración primero");
    }
    const extra = this.cifrado.descifrarJson<Record<string, string>>(config.credencialesCifradas);
    const credenciales: CredencialesPlataforma = {
      ambiente: config.ambiente as unknown as "SANDBOX" | "PRODUCCION",
      identificadorTienda: config.identificadorTienda,
      extra,
    };
    return { config, adaptador: this.registry.obtener(config.plataforma), credenciales };
  }

  /** Con `empresaId` (el del token), una config de otra empresa se trata como inexistente. */
  private async obtenerConfigOFallar(configId: string, empresaId?: string): Promise<ConfigRow> {
    const config = await this.prisma.plataformaConfig.findUnique({ where: { id: configId } });
    if (!config || (empresaId && config.empresaId !== empresaId)) throw new NotFoundException("Configuración de plataforma no encontrada");
    return config;
  }

  private async obtenerOrdenOFallar(id: string, empresaId?: string): Promise<OrdenRow & { plataformaConfig: ConfigRow }> {
    const orden = await this.prisma.plataformaOrdenSync.findUnique({ where: { id }, include: { plataformaConfig: true } });
    if (!orden || (empresaId && orden.plataformaConfig.empresaId !== empresaId)) throw new NotFoundException("Pedido entrante no encontrado");
    return orden;
  }

  private credencialesDe(config: ConfigRow): CredencialesPlataforma | null {
    if (!config.credencialesCifradas) return null;
    return {
      ambiente: config.ambiente as unknown as "SANDBOX" | "PRODUCCION",
      identificadorTienda: config.identificadorTienda,
      extra: this.cifrado.descifrarJson<Record<string, string>>(config.credencialesCifradas),
    };
  }

  private async registrarEventoFallido(configId: string, motivo: string) {
    try {
      await this.prisma.plataformaWebhookEvent.create({
        data: { plataformaConfigId: configId, eventoExternoId: `rechazado:${randomUUID()}`, tipoEvento: "rechazado", procesadoOk: false, motivoError: motivo.slice(0, 300) },
      });
    } catch (e: any) {
      this.logger.error(`No se pudo registrar el webhook rechazado: ${e.message}`);
    }
  }

  private toDtoEntrante(orden: OrdenRow, adaptador: PlataformaDeliveryAdapter): PedidoEntranteDto {
    const payload = (orden.payloadSanitizado ?? {}) as {
      items?: ItemOrdenExterna[];
      folioCorto?: string | null;
      notas?: string | null;
      entrega?: PedidoEntranteDto["entrega"];
      montos?: PedidoEntranteDto["montos"];
    };
    return {
      id: orden.id,
      plataforma: adaptador.codigo,
      nombreVisible: adaptador.nombreVisible,
      ordenExternaId: orden.ordenExternaId,
      folioCorto: payload.folioCorto ?? null,
      estado: orden.estado,
      estadoExterno: orden.estadoExterno ?? null,
      clienteNombre: orden.clienteNombre,
      totalExterno: orden.totalExterno !== null ? Number(orden.totalExterno) : null,
      items: payload.items ?? [],
      notas: payload.notas ?? null,
      entrega: payload.entrega ?? null,
      montos: payload.montos ?? null,
      motivoError: orden.motivoError,
      ultimoIntentoError: orden.ultimoIntentoError ?? null,
      confirmacion: orden.confirmacion ?? null,
      simulado: orden.simulado ?? false,
      puedeConfirmarEnPlataforma: !orden.simulado && typeof adaptador.aceptarOrden === "function",
      pedidoId: orden.pedidoId,
      aceptadaEn: orden.aceptadaEn ?? null,
      createdAt: orden.createdAt,
      updatedAt: orden.updatedAt,
    };
  }

  private async contarOrdenes(configId: string): Promise<{ pedidosRecibidos: number; pedidosSincronizados: number }> {
    const [pedidosRecibidos, pedidosSincronizados] = await Promise.all([
      this.prisma.plataformaOrdenSync.count({ where: { plataformaConfigId: configId } }),
      this.prisma.plataformaOrdenSync.count({
        where: { plataformaConfigId: configId, estado: EstadoSincronizacionOrdenPlataforma.SINCRONIZADA },
      }),
    ]);
    return { pedidosRecibidos, pedidosSincronizados };
  }

  private construirWebhookUrl(plataforma: string, webhookSlug: string): string {
    const base = this.config.get<string>("PLATAFORMAS_PUBLIC_BASE_URL") ?? "";
    return `${base}/plataformas/webhooks/${plataforma}/${webhookSlug}`;
  }

  private toDto(config: ConfigRow, adaptador: PlataformaDeliveryAdapter, conteos: { pedidosRecibidos: number; pedidosSincronizados: number }): PlataformaConfigDto {
    return {
      id: config.id,
      empresaId: config.empresaId,
      sucursalId: config.sucursalId,
      plataforma: config.plataforma,
      nombreVisible: adaptador.nombreVisible,
      ambiente: config.ambiente as unknown as AmbientePlataforma,
      activo: config.activo,
      estadoConexion: config.estadoConexion,
      identificadorTienda: config.identificadorTienda,
      credencialesUltimos4: config.credencialesUltimos4,
      clientSecretConfigurado: config.clientSecretConfigurado,
      webhookUrl: this.construirWebhookUrl(config.plataforma, config.webhookSlug),
      ultimaSincronizacion: config.ultimaSincronizacion,
      ultimoErrorMensaje: config.ultimoErrorMensaje,
      ultimoErrorEn: config.ultimoErrorEn,
      ...conteos,
    };
  }

  private placeholderDto(empresaId: string, sucursalId: string | null, plataforma: string, adaptador: PlataformaDeliveryAdapter): PlataformaConfigDto {
    return {
      id: null,
      empresaId,
      sucursalId,
      plataforma,
      nombreVisible: adaptador.nombreVisible,
      ambiente: AmbientePlataforma.SANDBOX,
      activo: false,
      estadoConexion: EstadoConexionPlataforma.PENDIENTE_CONFIGURACION,
      identificadorTienda: null,
      credencialesUltimos4: null,
      clientSecretConfigurado: false,
      webhookUrl: null,
      ultimaSincronizacion: null,
      ultimoErrorMensaje: null,
      ultimoErrorEn: null,
      pedidosRecibidos: 0,
      pedidosSincronizados: 0,
    };
  }

  private async auditarSinSecretos(user: any, entidad: string, accion: string, entidadId: string, datosNuevos: Record<string, unknown>) {
    try {
      await this.prisma.auditLog.create({
        data: {
          empresaId: user.empresaId ?? null,
          sucursalId: user.sucursalId ?? null,
          usuarioId: user.sub ?? null,
          entidad,
          entidadId,
          accion,
          datosNuevos: datosNuevos as any,
        },
      });
    } catch (e: any) {
      this.logger.warn(`No se pudo registrar auditoría de ${entidad}/${accion}: ${e.message}`);
    }
  }
}
