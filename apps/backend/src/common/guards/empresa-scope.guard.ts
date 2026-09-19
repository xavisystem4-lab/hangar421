import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * Verifica que el `empresaId` que trae la petición sea el de la sesión.
 *
 * Casi todos los endpoints reciben `empresaId` por query o body y lo usan tal cual para filtrar
 * (`sucursales.service.listar`, `catalogo.service.listarCategorias`, `reportes.service.dashboard`…).
 * Sin esta comprobación, cualquier usuario autenticado puede cambiar ese valor en la URL y leer
 * el catálogo, las sucursales o los reportes de OTRA empresa: el JWT se valida, pero nadie
 * compara lo que el cliente declara contra lo que el token dice.
 *
 * Va como guard global (ver app.module.ts) en vez de endpoint por endpoint porque la regla no
 * tiene excepciones legítimas — un usuario nunca opera sobre una empresa que no es la suya, ni
 * siquiera ADMIN_CORPORATIVO, cuyo alcance transversal es sobre las SUCURSALES de su empresa
 * (por eso aquí no se le exime, a diferencia de RolesGuard/SucursalAccessGuard).
 *
 * Todos los clientes actuales mandan ya su propio `usuario.empresaId`, así que esto no cambia
 * ninguna llamada legítima — solo rechaza las manipuladas.
 */
@Injectable()
export class EmpresaScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Los guards globales también corren sobre el gateway de Socket.IO, donde no hay petición
    // HTTP que inspeccionar — `switchToHttp()` devolvería un objeto vacío y esto rechazaría
    // conexiones legítimas de cocina/meseros.
    if (context.getType() !== "http") return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();

    // Se miran las tres fuentes porque el `empresaId` llega por cualquiera de ellas según el
    // endpoint: params en `/empresas/:empresaId`, query en los listados, body en las altas.
    const declarada = request.params?.empresaId ?? request.query?.empresaId ?? request.body?.empresaId;
    if (declarada === undefined || declarada === null || declarada === "") return true;

    const user = request.user;
    if (!user?.empresaId) {
      throw new ForbiddenException("La sesión no tiene empresa asociada");
    }
    if (declarada !== user.empresaId) {
      throw new ForbiddenException("No tienes acceso a esta empresa");
    }
    return true;
  }
}
