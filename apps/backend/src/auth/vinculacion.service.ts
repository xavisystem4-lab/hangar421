import { BadRequestException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import * as crypto from "crypto";
import { RolUsuario, TipoDispositivo } from "@hangar421/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";

/** Alfabeto sin caracteres ambiguos: no lleva O/0, I/1/L ni U (que se confunde con V al
 *  dictarla por teléfono). El código se teclea a mano en una tablet, muchas veces leído en voz
 *  alta desde otra pantalla — un 0 confundido con una O cuesta un intento y una llamada. */
const ALFABETO = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const LONGITUD = 8;

/** 15 minutos: suficiente para que un admin lo dicte por teléfono o lo mande por chat, y poco
 *  para que sirva de algo si se filtra. */
const VIGENCIA_MS = 15 * 60_000;

/** Prefijo del usuario-terminal de cada sucursal. No es una persona: no tiene contraseña ni PIN,
 *  así que no puede iniciar sesión por ningún login interactivo. */
const PREFIJO_USUARIO_TERMINAL = "terminal.";

@Injectable()
export class VinculacionService {
  private readonly logger = new Logger("Vinculacion");

  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  /** `randomInt` y no `Math.random()`: es un secreto de un solo uso y la aleatoriedad tiene que
   *  ser criptográfica. Con 30^8 combinaciones (~6.5e11) y el rate-limit del endpoint público,
   *  adivinarlo antes de que caduque no es viable. */
  private generarCodigo(): string {
    let codigo = "";
    for (let i = 0; i < LONGITUD; i++) codigo += ALFABETO[crypto.randomInt(ALFABETO.length)];
    return codigo;
  }

  /** Genera un código para enlazar una terminal a `sucursalId`. Lo llama un admin desde el ERP. */
  async crear(params: {
    empresaId: string;
    sucursalId: string;
    creadoPorId: string;
    rol?: RolUsuario;
  }): Promise<{ codigo: string; expiraAt: Date; sucursal: string }> {
    // La sucursal tiene que ser de la empresa de quien lo genera. EmpresaScopeGuard ya compara
    // el empresaId declarado contra el del token, pero no que la sucursal pertenezca a esa
    // empresa — sin esto, un admin podría emitir un código hacia la sucursal de otro.
    const sucursal = await this.prisma.sucursal.findFirst({
      where: { id: params.sucursalId, empresaId: params.empresaId, activo: true },
    });
    if (!sucursal) throw new BadRequestException("La sucursal no existe o no pertenece a tu empresa");

    const codigo = this.generarCodigo();
    const expiraAt = new Date(Date.now() + VIGENCIA_MS);

    await this.prisma.codigoVinculacion.create({
      data: {
        codigo,
        empresaId: params.empresaId,
        sucursalId: params.sucursalId,
        creadoPorId: params.creadoPorId,
        rol: (params.rol ?? RolUsuario.CAJERO) as any,
        expiraAt,
      },
    });

    return { codigo, expiraAt, sucursal: sucursal.nombre };
  }

  /**
   * Canjea un código y devuelve una sesión para la terminal. Endpoint PÚBLICO: es el único
   * camino por el que un dispositivo sin credenciales puede obtener acceso, así que cada
   * comprobación de aquí es la única barrera.
   *
   * El canje es de un solo uso y se cierra con un UPDATE condicional (`usadoAt: null` en el
   * WHERE), no con un "leer y luego escribir": dos terminales canjeando el mismo código a la
   * vez tienen que dejar exactamente una ganadora.
   */
  async vincular(params: {
    codigo: string;
    dispositivoId: string;
    nombreDispositivo?: string;
  }): Promise<{ sucursalId: string; sucursal: string; empresaId: string; accessToken: string; refreshToken: string }> {
    const codigo = params.codigo.trim().toUpperCase().replace(/[\s-]/g, "");
    if (!codigo || !params.dispositivoId) throw new BadRequestException("Falta el código o el identificador del dispositivo");

    const registro = await this.prisma.codigoVinculacion.findUnique({
      where: { codigo },
      include: { sucursal: true },
    });

    // Un solo mensaje para "no existe", "ya se usó" y "caducó": distinguirlos le diría a quien
    // prueba códigos al azar cuáles existen.
    const invalido = () => new UnauthorizedException("Código inválido o expirado");
    if (!registro || registro.usadoAt || registro.expiraAt < new Date()) {
      this.logger.warn(`Canje rechazado para el dispositivo ${params.dispositivoId}`);
      throw invalido();
    }

    const marcado = await this.prisma.codigoVinculacion.updateMany({
      where: { id: registro.id, usadoAt: null },
      data: { usadoAt: new Date(), dispositivoId: params.dispositivoId },
    });
    if (marcado.count === 0) throw invalido(); // otra terminal lo canjeó entre la lectura y aquí

    const usuarioTerminal = await this.resolverUsuarioTerminal(registro.empresaId, registro.sucursalId, registro.rol as RolUsuario);

    // Registra la terminal como Dispositivo de la sucursal (informativo, para que el admin la
    // vea en el ERP). Un fallo aquí no debe tumbar un canje ya consumido.
    await this.prisma.dispositivo
      .upsert({
        where: { identificador: params.dispositivoId },
        update: { sucursalId: registro.sucursalId, ultimaConexion: new Date(), activo: true },
        create: {
          sucursalId: registro.sucursalId,
          nombre: params.nombreDispositivo?.trim() || "Punto de Venta",
          tipo: TipoDispositivo.POS_TERMINAL as any,
          identificador: params.dispositivoId,
          ultimaConexion: new Date(),
        },
      })
      .catch((e) => this.logger.warn(`No se pudo registrar el dispositivo ${params.dispositivoId}: ${e.message}`));

    const sesion = await this.auth.emitirSesionParaTerminal(
      usuarioTerminal.id,
      registro.empresaId,
      usuarioTerminal.nombre,
      registro.sucursalId,
      registro.rol as RolUsuario,
      params.dispositivoId,
    );

    this.logger.log(`Terminal ${params.dispositivoId} vinculada a la sucursal ${registro.sucursal.nombre}`);

    return {
      sucursalId: registro.sucursalId,
      sucursal: registro.sucursal.nombre,
      empresaId: registro.empresaId,
      accessToken: sesion.accessToken,
      refreshToken: sesion.refreshToken,
    };
  }

  /** Usuario-terminal de la sucursal: uno por sucursal, creado la primera vez que se vincula una
   *  terminal ahí. Sin passwordHash ni pinHash a propósito — `loginConCredenciales` y
   *  `loginConPin` rechazan a quien no los tenga, así que esta identidad solo puede nacer de un
   *  canje de código. Que exista como Usuario real es lo que permite que la auditoría, los
   *  turnos y los pedidos apunten a "la terminal" y no a la persona que la dio de alta. */
  private async resolverUsuarioTerminal(empresaId: string, sucursalId: string, rol: RolUsuario) {
    const username = `${PREFIJO_USUARIO_TERMINAL}${sucursalId}`;
    const existente = await this.prisma.usuario.findUnique({ where: { username } });
    if (existente) {
      // Reactiva y reasegura el acceso por si la sucursal se desactivó y se volvió a usar.
      await this.prisma.usuarioSucursal.upsert({
        where: { usuarioId_sucursalId: { usuarioId: existente.id, sucursalId } },
        update: { activo: true, rol: rol as any },
        create: { usuarioId: existente.id, sucursalId, rol: rol as any, activo: true },
      });
      return existente;
    }

    const sucursal = await this.prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });
    return this.prisma.usuario.create({
      data: {
        empresaId,
        nombre: `Punto de Venta — ${sucursal.nombre}`,
        username,
        activo: true,
        sucursales: { create: { sucursalId, rol: rol as any, activo: true } },
      },
    });
  }
}
