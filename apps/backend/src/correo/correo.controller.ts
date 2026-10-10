import { Body, Controller, Get, Post, Put, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RolUsuario } from "@hangar421/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Audit } from "../common/interceptors/audit.interceptor";
import { CorreoService, PRESETS_CORREO, type GuardarConfiguracionCorreo } from "./correo.service";

/** Admin → Correo del ERP: solo ADMIN_CORPORATIVO (es la cuenta que envía en nombre de la empresa). */
@ApiTags("correo")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("correo")
export class CorreoController {
  constructor(private correo: CorreoService) {}

  @Get("configuracion")
  @Roles(RolUsuario.ADMIN_CORPORATIVO)
  obtener(@CurrentUser() user: { empresaId: string }) {
    return this.correo.obtenerConfiguracion(user.empresaId);
  }

  @Get("presets")
  @Roles(RolUsuario.ADMIN_CORPORATIVO)
  presets() {
    return PRESETS_CORREO;
  }

  // Sin @Audit: el body trae la contraseña en claro (se cifra antes de guardar) y no debe quedar
  // en AuditLog. El guardado se registra en el log del servidor sin la contraseña.
  @Put("configuracion")
  @Roles(RolUsuario.ADMIN_CORPORATIVO)
  guardar(@Body() body: GuardarConfiguracionCorreo, @CurrentUser() user: { empresaId: string; sub?: string }) {
    return this.correo.guardarConfiguracion(user.empresaId, body, user.sub);
  }

  @Post("prueba")
  @Roles(RolUsuario.ADMIN_CORPORATIVO)
  @Audit("CORREO", "ENVIAR_PRUEBA")
  prueba(@Body() body: { destinatario: string }, @CurrentUser() user: { empresaId: string; nombre?: string; email?: string }) {
    return this.correo.enviarPrueba(user.empresaId, body?.destinatario ?? "", user.nombre ?? user.email);
  }
}
