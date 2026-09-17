import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlataformaConfig, PlataformaOrdenSync } from "@prisma/client";
import { randomUUID } from "crypto";
import {
  AmbientePlataforma,
  CanalOrigen,
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
import { CredencialesPlataforma, ItemOrdenExterna, PlataformaDeliveryAdapter, ResultadoPruebaConexionPlataforma } from "./proveedores/plataforma-delivery.interface";
import {
  AceptarPedidoEntranteDto,
  GuardarConfigPlataformaDto,
  PedidoEntranteDto,
  PlataformaConfigDto,
} from "./dto/plataformas.dto";

type ConfigRow = PlataformaConfig;
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

  async listar(empresaId: string, sucursalId: string | null = null): Promise<PlataformaConfigDto[]> {
    const configs = await this.prisma.plataformaConfig.findMany({ where: { empresaId, sucursalId } });
    const porCodigo = new Map(configs.map((c) => [c.plataforma, c]));

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
    const config = await this.prisma.plataformaConfig.findUnique({
      where: { empresaId_sucursalId_plataforma: { empresaId, sucursalId, plataforma } as any },
    });
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

    let config = await this.prisma.plataformaConfig.upsert({
      where: { empresaId_sucursalId_plataforma: { empresaId, sucursalId, plataforma } as any },
      update: data,
      create: data,
    });

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

  async probarConexion(configId: string): Promise<ResultadoPruebaConexionPlataforma> {
    const { config, adaptador, credenciales } = await this.cargarAdaptador(configId);
    const resultado = await adaptador.probarConexion(credenciales);
    await this.aplicarResultadoPrueba(config.id, resultado);
    return resultado;
  }

  async reconectar(configId: string): Promise<ResultadoPruebaConexionPlataforma> {
    const { config, adaptador, credenciales } = await this.cargarAdaptador(configId);
    const resultado = await adaptador.probarConexion(credenciales);
    await this.aplicarResultadoPrueba(config.id, resultado, resultado.ok);
    return resultado;
  }

  /** Nunca borra `credencialesCifradas` — así "Reconectar" no exige volver a capturar todo. */
  async desconectar(configId: string): Promise<PlataformaConfigDto> {
    await this.obtenerConfigOFallar(configId);
    const actualizado = await this.prisma.plataformaConfig.update({
      where: { id: configId },
      data: { activo: false, estadoConexion: EstadoConexionPlataforma.DESCONECTADA },
    });
    const adaptador = this.registry.obtener(actualizado.plataforma);
    const conteos = await this.contarOrdenes(actualizado.id);
    return this.toDto(actualizado, adaptador, conteos);
  }

  async regenerarWebhook(configId: string): Promise<{ webhookUrl: string }> {
    await this.obtenerConfigOFallar(configId);
    const actualizado = await this.prisma.plataformaConfig.update({
      where: { id: configId },
      data: { webhookSlug: randomUUID() },
    });
    return { webhookUrl: this.construirWebhookUrl(actualizado.plataforma, actualizado.webhookSlug) };
  }

  // -------------------------------------------------------------------------------------------
  // Webhooks entrantes
  // -------------------------------------------------------------------------------------------

  /** Nunca deja que un webhook mal formado, con firma inválida, o de una config inexistente
   *  provoque un 500 — todos esos casos se registran (log) y responden {ok:true} igual, para no
   *  provocar una tormenta de reintentos del lado de la plataforma (mismo espíritu que el caso
   *  "sin PaymentRequest correspondiente" de pagos.service.ts, aplicado también a firma inválida
   *  y config no encontrada). La idempotencia real la da el índice único de
   *  PlataformaWebhookEvent(plataformaConfigId, eventoExternoId) — un evento repetido choca ahí
   *  (P2002) y se descarta sin reprocesar. */
  async manejarWebhook(
    plataforma: string,
    webhookSlug: string,
    peticion: { headers: Record<string, string>; query: Record<string, string>; body: unknown },
  ): Promise<{ ok: true }> {
    const config = await this.prisma.plataformaConfig.findUnique({ where: { webhookSlug } });
    if (!config || config.plataforma !== plataforma) {
      this.logger.warn(`Webhook recibido para ${plataforma}/${webhookSlug} sin configuración correspondiente`);
      return { ok: true };
    }
    if (!config.credencialesCifradas) {
      this.logger.warn(`Webhook recibido para ${plataforma} (config ${config.id}) sin credenciales guardadas — ignorado`);
      return { ok: true };
    }

    const extra = this.cifrado.descifrarJson<Record<string, string>>(config.credencialesCifradas);
    const credenciales: CredencialesPlataforma = {
      ambiente: config.ambiente as unknown as "SANDBOX" | "PRODUCCION",
      identificadorTienda: config.identificadorTienda,
      extra,
    };
    const adaptador = this.registry.obtener(config.plataforma);

    let procesado;
    try {
      procesado = await adaptador.procesarWebhook(credenciales, peticion);
    } catch (e: any) {
      this.logger.warn(`Webhook de ${plataforma} (config ${config.id}) rechazado: ${e.message}`);
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

    if (procesado.orden) {
      await this.prisma.plataformaOrdenSync.upsert({
        where: {
          plataformaConfigId_ordenExternaId: {
            plataformaConfigId: config.id,
            ordenExternaId: procesado.orden.ordenExternaId,
          } as any,
        },
        create: {
          plataformaConfigId: config.id,
          ordenExternaId: procesado.orden.ordenExternaId,
          estado: EstadoSincronizacionOrdenPlataforma.RECIBIDA,
          clienteNombre: procesado.orden.clienteNombre ?? null,
          totalExterno: procesado.orden.total ?? null,
          payloadSanitizado: procesado.orden.payloadSanitizado as any,
        },
        // Una plataforma puede mandar varios eventos para la misma orden (ej. "creada" y luego
        // "actualizada") con eventoExternoId distintos — cada uno pasa el chequeo de idempotencia
        // de arriba, pero deben converger en el mismo PlataformaOrdenSync sin pisar un estado ya
        // avanzado por el cajero (aceptado/rechazado) con estos datos, que son solo del último
        // evento crudo de la plataforma.
        update: {
          clienteNombre: procesado.orden.clienteNombre ?? null,
          totalExterno: procesado.orden.total ?? null,
          payloadSanitizado: procesado.orden.payloadSanitizado as any,
        },
      });
    }

    await this.prisma.plataformaConfig.update({ where: { id: config.id }, data: { ultimaSincronizacion: new Date() } });
    return { ok: true };
  }

  // -------------------------------------------------------------------------------------------
  // Pedidos entrantes (bandeja de aceptación manual)
  //
  // Un pedido recibido por webhook nunca se convierte en un Pedido real automáticamente — no hay
  // forma confiable de mapear los items tal como los manda cada plataforma (nombres/ids propios
  // de su catálogo) contra el catálogo real de HANGAR 421 sin conocer el payload real de cada una
  // (ver TODO(real-api) en cada adaptador). En vez de adivinar el mapeo, el cajero revisa cada
  // pedido entrante desde el CRM y elige a mano el Producto real para cada item antes de aceptar
  // — recién ahí se crea el Pedido, reutilizando PedidosService.crear() tal cual (mismo folio,
  // mismo cálculo de totales, mismo evento PEDIDO_CREADO hacia cocina) para que un pedido de
  // plataforma se comporte exactamente igual que uno tomado en el POS.
  // -------------------------------------------------------------------------------------------

  async listarPedidosEntrantes(empresaId: string, estado: EstadoSincronizacionOrdenPlataforma = EstadoSincronizacionOrdenPlataforma.RECIBIDA): Promise<PedidoEntranteDto[]> {
    const configs = await this.prisma.plataformaConfig.findMany({ where: { empresaId }, select: { id: true } });
    if (configs.length === 0) return [];
    const ordenes = await this.prisma.plataformaOrdenSync.findMany({
      where: { plataformaConfigId: { in: configs.map((c) => c.id) }, estado },
      include: { plataformaConfig: true },
      orderBy: { createdAt: "desc" },
    });
    return ordenes.map((o) => this.toDtoEntrante(o, this.registry.obtener(o.plataformaConfig.plataforma)));
  }

  async obtenerPedidoEntrante(id: string): Promise<PedidoEntranteDto> {
    const orden = await this.obtenerOrdenOFallar(id);
    const config = await this.prisma.plataformaConfig.findUniqueOrThrow({ where: { id: orden.plataformaConfigId } });
    return this.toDtoEntrante(orden, this.registry.obtener(config.plataforma));
  }

  /** Crea el Pedido real (tipo DOMICILIO, canal PLATAFORMA_DELIVERY) a partir del mapeo de items
   *  que hizo el cajero, y lo manda directo a cocina (`enviarInmediato`) — el cajero ya lo revisó
   *  al aceptar, no necesita un paso extra de "enviar a cocina" como sí lo tiene un pedido nuevo
   *  desde cero en el POS. Idempotente: si el pedido ya fue aceptado antes, devuelve el mismo
   *  Pedido en vez de crear uno duplicado (protege contra un doble clic en "Aceptar"). */
  async aceptarPedido(id: string, dto: AceptarPedidoEntranteDto) {
    const orden = await this.obtenerOrdenOFallar(id);

    if (orden.estado === EstadoSincronizacionOrdenPlataforma.SINCRONIZADA && orden.pedidoId) {
      return this.pedidos.obtener(orden.pedidoId);
    }
    if (orden.estado !== EstadoSincronizacionOrdenPlataforma.RECIBIDA) {
      throw new BadRequestException(`Este pedido ya se marcó como "${orden.estado}" — no se puede volver a aceptar.`);
    }

    const config = await this.prisma.plataformaConfig.findUniqueOrThrow({ where: { id: orden.plataformaConfigId } });
    const adaptador = this.registry.obtener(config.plataforma);

    const notas = [
      `Pedido de ${adaptador.nombreVisible} #${orden.ordenExternaId}`,
      orden.clienteNombre ? `Cliente: ${orden.clienteNombre}` : null,
      dto.notasGenerales,
    ].filter(Boolean).join(" — ");

    const pedido = await this.pedidos.crear({
      id: randomUUID(),
      empresaId: config.empresaId,
      sucursalId: dto.sucursalId,
      tipo: TipoPedido.DOMICILIO,
      canalOrigen: CanalOrigen.PLATAFORMA_DELIVERY,
      notasGenerales: notas,
      enviarInmediato: true,
      items: dto.items.map((it) => ({ productoId: it.productoId, cantidad: it.cantidad, notas: it.notas })),
    } as any);

    await this.prisma.plataformaOrdenSync.update({
      where: { id: orden.id },
      data: { estado: EstadoSincronizacionOrdenPlataforma.SINCRONIZADA, pedidoId: pedido.id },
    });

    return pedido;
  }

  /** No cancela nada del lado de la plataforma (ninguna de las tres tiene, en este PR, un
   *  endpoint real de "rechazar pedido" implementado — ver TODO(real-api) en los adaptadores);
   *  solo deja registro interno de que este pedido no se va a preparar, para que no siga
   *  apareciendo en la bandeja de pendientes. */
  async rechazarPedido(id: string, motivo: string): Promise<PedidoEntranteDto> {
    const orden = await this.obtenerOrdenOFallar(id);
    if (orden.estado !== EstadoSincronizacionOrdenPlataforma.RECIBIDA) {
      throw new BadRequestException(`Este pedido ya se marcó como "${orden.estado}" — no se puede rechazar.`);
    }

    const actualizada = await this.prisma.plataformaOrdenSync.update({
      where: { id: orden.id },
      data: { estado: EstadoSincronizacionOrdenPlataforma.IGNORADA, motivoError: motivo },
    });

    const config = await this.prisma.plataformaConfig.findUniqueOrThrow({ where: { id: orden.plataformaConfigId } });
    return this.toDtoEntrante(actualizada, this.registry.obtener(config.plataforma));
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

  private async cargarAdaptador(configId: string) {
    const config = await this.obtenerConfigOFallar(configId);
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

  private async obtenerConfigOFallar(configId: string): Promise<ConfigRow> {
    const config = await this.prisma.plataformaConfig.findUnique({ where: { id: configId } });
    if (!config) throw new NotFoundException("Configuración de plataforma no encontrada");
    return config;
  }

  private async obtenerOrdenOFallar(id: string): Promise<OrdenRow> {
    const orden = await this.prisma.plataformaOrdenSync.findUnique({ where: { id } });
    if (!orden) throw new NotFoundException("Pedido entrante no encontrado");
    return orden;
  }

  private toDtoEntrante(orden: OrdenRow, adaptador: PlataformaDeliveryAdapter): PedidoEntranteDto {
    const payload = (orden.payloadSanitizado ?? {}) as { items?: ItemOrdenExterna[] };
    return {
      id: orden.id,
      plataforma: adaptador.codigo,
      nombreVisible: adaptador.nombreVisible,
      ordenExternaId: orden.ordenExternaId,
      estado: orden.estado,
      clienteNombre: orden.clienteNombre,
      totalExterno: orden.totalExterno !== null ? Number(orden.totalExterno) : null,
      items: payload.items ?? [],
      motivoError: orden.motivoError,
      pedidoId: orden.pedidoId,
      createdAt: orden.createdAt,
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
