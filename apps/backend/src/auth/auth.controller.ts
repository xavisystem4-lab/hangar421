import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthService } from "./auth.service";
import { LoginCredencialesDto, LoginPinDto, RefreshTokenDto, SwitchSucursalDto } from "./dto/login.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Get("usuarios-login")
  usuariosLogin() {
    return this.auth.listarUsuariosPublico();
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

  @UseGuards(JwtAuthGuard)
  @Post("switch-sucursal")
  switchSucursal(@CurrentUser() user: any, @Body() dto: SwitchSucursalDto) {
    return this.auth.cambiarSucursalActiva(user.sub, dto.sucursalId, user.dispositivoId);
  }
}
