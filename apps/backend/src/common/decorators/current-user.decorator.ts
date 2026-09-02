import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { JwtPayload } from "@hangar421/shared";

/** Extrae el payload del JWT (adjuntado por JwtAuthGuard) de la request actual. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
