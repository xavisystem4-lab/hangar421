import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { AccesoSucursal, AuthUserContext, JwtPayload, LoginResponse, RolUsuario, SucursalRequeridaError } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { LoginCredencialesDto, LoginPinDto } from "./dto/login.dto";

/** Se incluye el nombre de la sucursal en todas las consultas que resuelven accesos: es lo que
 *  el selector de sucursal necesita pintar (ver AccesoSucursal en @hangar421/shared). */
const INCLUIR_SUCURSALES = { where: { activo: true }, include: { sucursal: { select: { nombre: true } } } } as const;

/** Prisma genera su propio tipo `RolUsuario` (idéntico en valores al de `@hangar421/shared`,
 *  pero nominalmente distinto para TypeScript) — se normaliza aquí, en el único punto donde
 *  las filas de `usuarioSucursal` entran al servicio. */
function mapearAccesos(rows: { sucursalId: string; rol: string; sucursal?: { nombre: string } }[]): AccesoSucursal[] {
  return rows.map((r) => ({ sucursalId: r.sucursalId, nombre: r.sucursal?.nombre ?? "", rol: r.rol as RolUsuario }));
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  /** Lista pública (sin autenticar) de personal activo para mostrar como selector — solo
   *  nombre/rol/email (necesario para completar el login con credenciales), nunca contraseñas
   *  ni PINs. Se usa en dos lugares con necesidades distintas:
   *  - Login (`sucursalId` ausente): un usuario por fila, con SU PRIMERA sucursal asignada
   *    como default (si tiene varias, ver `resolverSucursalActiva`).
   *  - Autorizar un descuento (`sucursalId` presente, ver ModalDescuento): solo interesan los
   *    que sí tienen acceso a ESA sucursal en concreto — antes se devolvía "la primera sucursal
   *    de cada quien" sin importar cuál, así que un supervisor cuya primera sucursal fuera otra
   *    (ej. de dos cafés) salía en la lista pero `/auth/login-pin` lo rechazaba con "sin acceso
   *    a la sucursal" — y ModalDescuento mostraba siempre "PIN de autorización inválido" sin
   *    importar el PIN, porque tapaba cualquier error con ese mismo mensaje genérico. */
  async listarUsuariosPublico(sucursalId?: string) {
    const empresa = await this.prisma.empresa.findFirst({ orderBy: { createdAt: "asc" } });
    if (!empresa) return [];
    const usuarios = await this.prisma.usuario.findMany({
      where: { empresaId: empresa.id, activo: true, eliminado: false, email: { not: null } },
      select: {
        id: true,
        nombre: true,
        email: true,
        sucursales: {
          where: { activo: true, ...(sucursalId ? { sucursalId } : {}) },
          select: { rol: true, sucursalId: true },
          ...(sucursalId ? {} : { take: 1 }),
        },
      },
      orderBy: { nombre: "asc" },
    });
    return usuarios
      .filter((u) => u.sucursales.length > 0)
      .map((u) => ({
        id: u.id,
        nombre: u.nombre,
        email: u.email!,
        rol: u.sucursales[0].rol,
        sucursalId: u.sucursales[0].sucursalId,
      }));
  }

  /** Login con correo o nombre de usuario + password (POS Windows admin, CRM). */
  async loginConCredenciales(dto: LoginCredencialesDto): Promise<LoginResponse> {
    const usuario = await this.prisma.usuario.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.email }] },
      include: { sucursales: INCLUIR_SUCURSALES },
    });
    if (!usuario || !usuario.activo || usuario.eliminado || !usuario.passwordHash) {
      throw new UnauthorizedException("Credenciales inválidas");
    }
    const ok = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!ok) throw new UnauthorizedException("Credenciales inválidas");

    const accesos = mapearAccesos(usuario.sucursales);
    const { sucursalId, rol } = this.resolverSucursalActiva(accesos, dto.sucursalId);
    return this.emitirSesion(usuario.id, usuario.empresaId, usuario.nombre, accesos, sucursalId, rol, dto.dispositivoId);
  }

  /** Verifica que `usuarioId` tenga la CONTRASEÑA correcta Y un rol autorizado en `sucursalId`
   *  — sin emitir sesión (a diferencia de `loginConCredenciales`). Pensado para acciones que
   *  requieren autorización de un supervisor/admin DESDE una sesión de menor privilegio ya
   *  abierta en el POS (ej. cancelar una cuenta, aplicar un descuento): la sesión activa puede
   *  ser un CAJERO, la contraseña es lo que realmente autoriza la acción, y se valida aquí mismo
   *  en el servidor. Se usa contraseña (no PIN) a propósito para esta autorización — 4 dígitos
   *  es cómodo para iniciar sesión rápido en una terminal compartida, pero es un candado
   *  demasiado débil para algo tan consecuente como cancelar una cuenta. */
  async verificarAutorizacion(usuarioId: string, password: string, sucursalId: string, rolesPermitidos: RolUsuario[]): Promise<void> {
    const usuarioSucursal = await this.prisma.usuarioSucursal.findUnique({
      where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
      include: { usuario: true },
    });
    if (!usuarioSucursal || !usuarioSucursal.activo) {
      throw new UnauthorizedException("El usuario que autoriza no tiene acceso a esta sucursal");
    }
    if (!rolesPermitidos.includes(usuarioSucursal.rol as RolUsuario)) {
      throw new UnauthorizedException("El usuario que autoriza no tiene un rol permitido para esta acción");
    }
    const usuario = usuarioSucursal.usuario;
    if (!usuario.activo || usuario.eliminado || !usuario.passwordHash) {
      throw new UnauthorizedException("El usuario que autoriza no tiene contraseña configurada");
    }
    const ok = await bcrypt.compare(password, usuario.passwordHash);
    if (!ok) throw new UnauthorizedException("Contraseña de autorización inválida");
  }

  /** Login rápido por PIN en terminal compartida (mesero/cajero), ligado a un dispositivo. */
  async loginConPin(dto: LoginPinDto): Promise<LoginResponse> {
    const usuarioSucursal = await this.prisma.usuarioSucursal.findUnique({
      where: { usuarioId_sucursalId: { usuarioId: dto.usuarioId, sucursalId: dto.sucursalId } },
      include: { usuario: { include: { sucursales: INCLUIR_SUCURSALES } } },
    });
    if (!usuarioSucursal || !usuarioSucursal.activo) {
      throw new UnauthorizedException("Sin acceso a la sucursal");
    }
    const usuario = usuarioSucursal.usuario;
    if (!usuario.activo || usuario.eliminado || !usuario.pinHash) throw new UnauthorizedException("PIN no configurado");

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
      include: { sucursales: INCLUIR_SUCURSALES },
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
      include: { sucursales: INCLUIR_SUCURSALES },
    });
    const accesos = mapearAccesos(usuario.sucursales);
    const acceso = accesos.find((s) => s.sucursalId === sucursalId);
    if (!acceso) throw new UnauthorizedException("Sin acceso a esa sucursal");

    return this.emitirSesion(usuario.id, usuario.empresaId, usuario.nombre, accesos, sucursalId, acceso.rol, dispositivoId);
  }

  /** Sesión para una terminal vinculada por código (ver VinculacionService). Es un punto de
   *  entrada aparte porque NO hay contraseña ni PIN que validar: la autorización ya la dio el
   *  canje del código, que es de un solo uso y caduca. La sucursal activa y el rol vienen del
   *  código, no de lo que pida el cliente. */
  async emitirSesionParaTerminal(
    usuarioId: string,
    empresaId: string,
    nombre: string,
    sucursalId: string,
    rol: RolUsuario,
    dispositivoId: string,
  ): Promise<LoginResponse> {
    const sucursal = await this.prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId }, select: { nombre: true } });
    return this.emitirSesion(usuarioId, empresaId, nombre, [{ sucursalId, nombre: sucursal.nombre, rol }], sucursalId, rol, dispositivoId);
  }

  // -- privados --------------------------------------------------------------

  private resolverSucursalActiva(
    sucursales: AccesoSucursal[],
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
      // El error lleva la lista de sucursales. No es decorativo: aquí NO se emite ningún token,
      // así que sin estos datos el cliente no tiene forma de consultar a qué sucursales puede
      // entrar y el selector se vuelve inalcanzable — que es exactamente lo que le pasaba al
      // APK, cuya pantalla de "elegir sucursal" nunca llegaba a mostrarse.
      //
      // Se prefiere esto a emitir un token sin sucursal activa: mantener el invariante "todo
      // access token tiene una sucursal válida" es lo que permite que SucursalAccessGuard sea
      // seguro de aplicar globalmente.
      const cuerpo: SucursalRequeridaError = {
        message: "El usuario tiene acceso a varias sucursales; especifica sucursalId",
        codigo: "SUCURSAL_REQUERIDA",
        sucursales,
      };
      throw new BadRequestException(cuerpo);
    }
    return { sucursalId: sucursales[0].sucursalId, rol: sucursales[0].rol };
  }

  private async emitirSesion(
    usuarioId: string,
    empresaId: string,
    nombre: string,
    sucursales: AccesoSucursal[],
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
      sucursales,
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
