import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SucursalLibre } from "../common/decorators/sucursal-libre.decorator";
import { TerminalService } from "./terminal.service";

class VerificarPinTerminalDto {
  @ApiProperty() @IsString() usuarioId!: string;
  @ApiProperty() @IsString() @MinLength(4) pin!: string;
}

/**
 * Endpoints de la terminal multisucursal (APK). Todos exigen la sesión de la terminal y se
 * acotan a sus sucursales (ver TerminalService). `@SucursalLibre`: operan sobre VARIAS
 * sucursales a la vez, no sobre la activa, así que SucursalAccessGuard no aplica.
 */
@ApiTags("auth")
@UseGuards(JwtAuthGuard)
@SucursalLibre()
@Controller("auth/terminal")
export class TerminalController {
  constructor(private terminal: TerminalService) {}

  @Get("contexto")
  contexto(@Req() req: any) {
    return this.terminal.contexto(req.user);
  }

  /** Límite bajo: es donde adivinar un PIN tendría sentido. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("verificar-pin")
  verificarPin(@Req() req: any, @Body() dto: VerificarPinTerminalDto) {
    return this.terminal.verificarPin(req.user, dto.usuarioId, dto.pin);
  }

  @Get("precios")
  precios(@Req() req: any) {
    return this.terminal.precios(req.user);
  }
}
