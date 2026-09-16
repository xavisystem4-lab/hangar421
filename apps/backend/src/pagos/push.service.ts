import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Envío de notificaciones push (FCM) a la APK de Meseros cuando está en segundo plano o cerrada.
 *
 * TODO(producción): esto es un stub honesto, no una integración real — falta el proyecto de
 * Firebase (credenciales de service account) del cliente. Mientras tanto, el tiempo real
 * mientras la app está en primer plano (socket conectado) YA funciona sin esto — ver
 * PagosService.emitir()/RealtimeGateway.emitirAUsuario(). Esto solo hace falta para despertar la
 * app cuando el socket no está activo. Para activarlo: instalar `firebase-admin`, inicializarlo
 * con las credenciales del proyecto (variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON) y
 * reemplazar el cuerpo de `enviarPush()` por una llamada real a `messaging().sendEachForMulticast()`.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private prisma: PrismaService) {}

  async registrarToken(usuarioId: string, token: string, dispositivoId?: string, plataforma = "android") {
    return this.prisma.pushToken.upsert({
      where: { token },
      update: { usuarioId, dispositivoId, plataforma, activo: true },
      create: { usuarioId, token, dispositivoId, plataforma },
    });
  }

  async enviarPush(usuarioId: string, titulo: string, cuerpo: string, data: Record<string, string>) {
    const tokens = await this.prisma.pushToken.findMany({ where: { usuarioId, activo: true } });
    if (tokens.length === 0) return;
    this.logger.warn(
      `enviarPush() sin FCM configurado — ${tokens.length} token(s) registrados para ${usuarioId} pero no se envió notificación real (solo funciona el aviso en tiempo real mientras la app está en primer plano). Título: "${titulo}"`,
    );
  }
}
