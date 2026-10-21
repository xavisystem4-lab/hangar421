import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, tap } from "rxjs";
import { PrismaService } from "../../prisma/prisma.service";

export const AVISA_TERMINALES_KEY = "avisaTerminales";

/**
 * Marca un controlador (o un handler) cuyas modificaciones deben llegar a las tablets al momento:
 * cada POST/PUT/PATCH/DELETE que salga bien mueve la marca de cambios de la empresa y las tablets
 * avisan con un pitido y "Descargar modificación de ERP".
 */
export const AvisaTerminales = (que: string) => SetMetadata(AVISA_TERMINALES_KEY, que);

const MUTACIONES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Mueve la marca de cambios de la empresa. Nunca lanza: avisar es secundario a la operación. */
export async function marcarCambioErp(prisma: PrismaService, empresaId: string, que: string, dispositivoId?: string | null): Promise<void> {
  const datos = { version: new Date(), que, dispositivoId: dispositivoId ?? null };
  await prisma.marcaCambioErp
    .upsert({ where: { empresaId }, create: { empresaId, ...datos }, update: datos })
    .catch(() => undefined);
}

@Injectable()
export class CambiosErpInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const que = this.reflector.getAllAndOverride<string | undefined>(AVISA_TERMINALES_KEY, [context.getHandler(), context.getClass()]);
    if (!que) return next.handle();
    const request = context.switchToHttp().getRequest();
    if (!MUTACIONES.has(String(request.method).toUpperCase())) return next.handle();
    return next.handle().pipe(
      tap(() => {
        const empresaId = request.user?.empresaId;
        if (empresaId) void marcarCambioErp(this.prisma, empresaId, que, request.user?.dispositivoId ?? null);
      }),
    );
  }
}
