import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, tap } from "rxjs";
import { PrismaService } from "../../prisma/prisma.service";

export const AUDIT_KEY = "auditAction";
/** Marca un handler para que sus mutaciones queden registradas en AuditLog. */
export const Audit = (entidad: string, accion: string) =>
  SetMetadata(AUDIT_KEY, { entidad, accion });

/**
 * Interceptor global de auditoría: registra en `AuditLog` toda mutación marcada con @Audit(),
 * capturando usuario, dispositivo, sucursal e IP desde el request, y el resultado de la
 * operación (id de la entidad afectada) desde la respuesta.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<{ entidad: string; accion: string } | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    return next.handle().pipe(
      tap((result: any) => {
        this.prisma.auditLog
          .create({
            data: {
              empresaId: user?.empresaId ?? null,
              sucursalId: user?.sucursalId ?? request.body?.sucursalId ?? null,
              usuarioId: user?.sub ?? null,
              dispositivoId: user?.dispositivoId ?? request.body?.dispositivoId ?? null,
              entidad: meta.entidad,
              entidadId: result?.id ?? request.params?.id ?? null,
              accion: meta.accion,
              datosNuevos: safeJson(request.body),
              ip: request.ip,
            },
          })
          .catch(() => {
            // la auditoría nunca debe tumbar la operación de negocio
          });
      }),
    );
  }
}

function safeJson(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}
