import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { AuthUserContext, JwtPayload, LoginResponse, RolUsuario } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { LoginCredencialesDto, LoginPinDto } from "./dto/login.dto";

interface AccesoSucursal {
  sucursalId: string;
  rol: RolUsuario;
}

/** Prisma genera su propio tipo `RolUsuario` (idéntico en valores al de `@hangar421/shared`,
 *  pero nominalmente distinto para TypeScript) — se normaliza aquí, en el único punto donde
 *  las filas de `usuarioSucursal` entran al servicio. */
function mapearAccesos(rows: { sucursalId: string; rol: string }[]): AccesoSucursal[] {
  return rows.map((r) => ({ sucursalId: r.sucursalId, rol: r.rol as RolUsuario }));
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  /** Login con email + password (POS Windows admin, CRM). */
  async loginConCredenciales(dto: LoginCredencialesDto): Promise<LoginResponse> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: dto.email },
      include: { sucursales: { where: { activo: true } } },
    });
    if (!usuario || !usuario.activo || !usuario.passwordHash) {
      throw new UnauthorizedException("Credenciales inválidas");
    }
    const ok = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!ok) throw new UnauthorizedException("Credenciales inválidas");

    const accesos = mapearAccesos(usuario.sucursales);
    const { sucursalId, rol } = this.resolverSucursalActiva(accesos, dto.sucursalId);
    return this.emitirSesion(usuario.id, usuario.empresaId, usuario.nombre, accesos, sucursalId, rol, dto.dispositivoId);
  }

  /** Login rápido por PIN en terminal compartida (mesero/cajero), ligado a un dispositivo. */
  async loginConPin(dto: LoginPinDto): Promise<LoginResponse> {
    const usuarioSucursal = await this.prisma.usuarioSucursal.findUnique({
      where: { usuarioId_sucursalId: { usuarioId: dto.usuarioId, sucursalId: dto.sucursalId } },
      include: { usuario: { include: { sucursales: { where: { activo: true } } } } },
    });
    if (!usuarioSucursal || !usuarioSucursal.activo) {
      throw new UnauthorizedException("Sin acceso a la sucursal");
    }
    const usuario = usuarioSucursal.usuario;
    if (!usuario.activo || !usuario.pinHash) throw new UnauthorizedException("PIN no configurado");

    const ok = await bcrypt.compare(dto.pin, usuario.pinHash);
    if (!ok) throw new UnauthorizedException("PIN incorrecto");

    return this.emitirSesion(
      usuario.id,
      usuario.empresaId,
      usuario.nombre,
      mapearAccesos(usuario.sucursales),
      dto.sucursalId,
      usuarioSucursal.rol as RolUsuario,
      dto.dispositivoId,
    );
  }

  async refrescar(refreshToken: string): Promise<LoginResponse> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify(refreshToken, { secret: this.config.get("JWT_REFRESH_SECRET") });
    } catch {
      throw new UnauthorizedException("Refresh token inválido");
    }
    if (payload.type !== "refresh") throw new UnauthorizedException("Token inválido");

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException("Sesión expirada, inicia sesión de nuevo");
    }

    // Rotación: revocar el usado, emitir uno nuevo
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: payload.sub },
      include: { sucursales: { where: { activo: true } } },
    });

    return this.emitirSesion(
      usuario.id,
      usuario.empresaId,
      usuario.nombre,
      mapearAccesos(usuario.sucursales),
      payload.sucursalId!,
      payload.rol!,
      payload.dispositivoId,
    );
  }

  async cerrarSesion(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async cambiarSucursalActiva(usuarioId: string, sucursalId: string, dispositivoId?: string): Promise<LoginResponse> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      include: { sucursales: { where: { activo: true } } },
    });
    const accesos = mapearAccesos(usuario.sucursales);
    const acceso = accesos.find((s) => s.sucursalId === sucursalId);
    if (!acceso) throw new UnauthorizedException("Sin acceso a esa sucursal");

    return this.emitirSesion(usuario.id, usuario.empresaId, usuario.nombre, accesos, sucursalId, acceso.rol, dispositivoId);
  }

  // -- privados --------------------------------------------------------------

  private resolverSucursalActiva(
    sucursales: { sucursalId: string; rol: RolUsuario }[],
    sucursalIdSolicitada?: string,
  ) {
    if (sucursales.length === 0) {
      throw new BadRequestException("El usuario no tiene sucursales asignadas");
    }
    if (sucursalIdSolicitada) {
      const match = sucursales.find((s) => s.sucursalId === sucursalIdSolicitada);
      if (!match) throw new UnauthorizedException("Sin acceso a la sucursal solicitada");
      return { sucursalId: match.sucursalId, rol: match.rol };
    }
    // Un ADMIN_CORPORATIVO tiene alcance transversal (RolesGuard lo exime del check de sucursal);
    // no tiene sentido obligarlo a elegir una sucursal solo para iniciar sesión en el CRM.
    const comoCorporativo = sucursales.find((s) => s.rol === RolUsuario.ADMIN_CORPORATIVO);
    if (comoCorporativo) return { sucursalId: comoCorporativo.sucursalId, rol: comoCorporativo.rol };

    if (sucursales.length > 1) {
      throw new BadRequestException(
        "El usuario tiene acceso a varias sucursales; especifica sucursalId",
      );
    }
    return { sucursalId: sucursales[0].sucursalId, rol: sucursales[0].rol };
  }

  private async emitirSesion(
    usuarioId: string,
    empresaId: string,
    nombre: string,
    sucursales: { sucursalId: string; rol: RolUsuario }[],
    sucursalId: string,
    rol: RolUsuario,
    dispositivoId?: string,
  ): Promise<LoginResponse> {
    // jti único por sesión: sin esto, dos logins con el mismo payload dentro del mismo
    // segundo (mismo `iat`) producen un JWT idéntico y chocan con el índice único de
    // `tokenHash` en refresh_tokens al insertar el segundo.
    const jti = crypto.randomUUID();
    const accessPayload: JwtPayload = { sub: usuarioId, empresaId, sucursalId, rol, dispositivoId, type: "access", jti };
    const refreshPayload: JwtPayload = { sub: usuarioId, empresaId, sucursalId, rol, dispositivoId, type: "refresh", jti };

    const accessExpiresIn = this.config.get<string>("JWT_ACCESS_EXPIRES_IN", "15m");
    const refreshExpiresIn = this.config.get<string>("JWT_REFRESH_EXPIRES_IN", "30d");

    const accessToken = this.jwt.sign(accessPayload, {
      secret: this.config.get("JWT_ACCESS_SECRET"),
      expiresIn: accessExpiresIn,
    });
    const refreshToken = this.jwt.sign(refreshPayload, {
      secret: this.config.get("JWT_REFRESH_SECRET"),
      expiresIn: refreshExpiresIn,
    });

    await this.prisma.refreshToken.create({
      data: {
        usuarioId,
        tokenHash: this.hashToken(refreshToken),
        dispositivoId,
        expiresAt: new Date(Date.now() + this.parseDurationMs(refreshExpiresIn)),
      },
    });

    const usuarioContext: AuthUserContext = {
      id: usuarioId,
      nombre,
      empresaId,
      sucursales: sucursales.map((s) => ({ sucursalId: s.sucursalId, rol: s.rol })),
    };

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(this.parseDurationMs(accessExpiresIn) / 1000),
      usuario: usuarioContext,
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private parseDurationMs(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) return 15 * 60 * 1000;
    const value = Number(match[1]);
    const unit = match[2];
    const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1000;
    return value * factor;
  }
}
