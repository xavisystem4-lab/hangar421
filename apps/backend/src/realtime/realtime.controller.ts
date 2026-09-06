import { BadRequestException, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { Public } from "../common/decorators/public.decorator";
import { RealtimeGateway } from "./realtime.gateway";

/** IPs desde las que se acepta el aviso de cierre — ver `anunciarCierre()`. Cubre las formas en
 *  que Node/Express pueden reportar "esta misma máquina": IPv4 pelada, IPv6 loopback, e IPv4
 *  mapeada a IPv6 (lo más común detrás de un socket dual-stack en Windows). */
const IPS_LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

@ApiTags("realtime")
@Controller("realtime")
export class RealtimeController {
  constructor(private gateway: RealtimeGateway) {}

  /** Tablets de meseros conectadas ahora mismo — lo consume Administración → "Conexión
   *  Meseros" en el POS para mostrar qué dispositivos están enlazados y con qué IP. Protegido
   *  por el JwtAuthGuard GLOBAL (ver app.module.ts, APP_GUARD) — no necesita `@UseGuards` local. */
  @Get("conectados")
  conectados(@Query("sucursalId") sucursalId: string) {
    return this.gateway.listarConectados(sucursalId);
  }

  /** Aviso de cierre LIMPIO del software de PC — lo llama electron/backend-manager.ts
   *  (`detener()`) justo antes de matar el proceso del backend embebido, para que la app de
   *  Meseros pueda mostrar "Software cerrado" de inmediato en vez de esperar el timeout del
   *  heartbeat de transporte. Sin JWT a propósito: en ese momento del apagado no siempre hay
   *  una sesión de usuario a la mano en el proceso de Electron, y esta llamada no expone ni
   *  cambia ningún dato — solo dispara un aviso. Restringido a loopback para que ningún otro
   *  dispositivo de la LAN pueda disparar una alarma falsa de "cerrando" a todas las tablets. */
  @Public()
  @Post("anunciar-cierre")
  anunciarCierre(@Req() req: Request) {
    const ip = (req.ip ?? req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (!IPS_LOOPBACK.includes(ip)) {
      throw new BadRequestException("Este endpoint solo acepta llamadas desde la propia máquina");
    }
    this.gateway.anunciarCierre();
    return { ok: true };
  }
}
