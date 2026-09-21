import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { RolUsuario } from "@hangar421/shared";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { SucursalLibre } from "../common/decorators/sucursal-libre.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthService } from "./auth.service";
import { VinculacionService } from "./vinculacion.service";
import { CrearCodigoVinculacionDto, LoginCredencialesDto, LoginPinDto, RefreshTokenDto, SwitchSucursalDto, VincularDispositivoDto } from "./dto/login.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private auth: AuthService,
    private vinculacion: VinculacionService,
  ) {}

  @Public()
  @Get("usuarios-login")
  usuariosLogin(@Query("sucursalId") sucursalId?: string) {
    return this.auth.listarUsuariosPublico(sucursalId);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  login(@Body() dto: LoginCredencialesDto) {
    return this.auth.loginConCredenciales(dto);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("login-pin")
  loginPin(@Body() dto: LoginPinDto) {
    return this.auth.loginConPin(dto);
  }

  @Public()
  @Post("refresh")
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refrescar(dto.refreshToken);
  }

  @Public()
  @Post("logout")
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.cerrarSesion(dto.refreshToken);
  }

  /** Genera un código para enlazar una terminal. Solo admin — es lo que autoriza a un
   *  dispositivo nuevo a entrar a una sucursal. */
  @UseGuards(JwtAuthGuard)
  @Roles(RolUsuario.ADMIN_CORPORATIVO, RolUsuario.ADMIN_SUCURSAL)
  @Audit("CODIGO_VINCULACION", "CREAR")
  @Post("codigos-vinculacion")
  crearCodigoVinculacion(@CurrentUser() user: any, @Body() dto: CrearCodigoVinculacionDto) {
    return this.vinculacion.crear({
      // empresaId del TOKEN, nunca del cuerpo: quien genera el código no elige para qué empresa.
      empresaId: user.empresaId,
      sucursalId: dto.sucursalId,
      sucursalesIds: dto.sucursalesIds,
      creadoPorId: user.sub,
      creadoPorRol: user.rol,
      rol: dto.rol,
    });
  }

  /**
   * Canjea el código desde la terminal. Público por necesidad — el dispositivo todavía no tiene
   * ninguna credencial; el código ES la credencial, de un solo uso y con 15 min de vigencia.
   *
   * Límite bajo a propósito: es el único endpoint donde adivinar a ciegas tendría sentido. Con
   * 30^8 combinaciones y 5 intentos por minuto, la fuerza bruta no llega a ningún lado antes de
   * que el código caduque.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("vincular-dispositivo")
  vincularDispositivo(@Body() dto: VincularDispositivoDto) {
    return this.vinculacion.vincular(dto);
  }

  @UseGuards(JwtAuthGuard)
  @SucursalLibre()
  @Post("switch-sucursal")
  switchSucursal(@CurrentUser() user: any, @Body() dto: SwitchSucursalDto) {
    return this.auth.cambiarSucursalActiva(user.sub, dto.sucursalId, user.dispositivoId);
  }
}
