import { PrismaService } from "../prisma/prisma.service";

/** Prefijo del username del usuario-terminal. Lo comparte con VinculacionService, que es quien
 *  lo crea al canjear un código de vinculación. */
export const PREFIJO_USUARIO_TERMINAL = "terminal.";

/**
 * Resuelve el usuario al que atribuir una operación de terminal, cayendo al usuario-terminal de
 * la sucursal cuando el que manda el cliente no existe en el ERP.
 *
 * El caso real: un cajero dado de alta en la tablet SIN conexión tiene un id uuid7 generado en
 * el dispositivo que el ERP nunca ha visto. En `Pedido` eso se resuelve dejando el campo vacío
 * (`meseroId`/`cajeroId` son opcionales), pero `Turno.usuarioId` es OBLIGATORIO: no hay "vacío"
 * posible, así que la apertura de turno reventaba con
 * `Foreign key constraint violated: turnos_usuarioId_fkey` y el corte se quedaba atascado en la
 * cola reintentándose indefinidamente.
 *
 * El usuario-terminal ya existía justo para esto: lo crea VinculacionService, uno por sucursal,
 * y su propio comentario dice que existe "para que la auditoría, LOS TURNOS y los pedidos
 * apunten a la terminal y no a la persona que la dio de alta". Simplemente no se estaba usando
 * desde el camino de sincronización.
 *
 * No tiene contraseña ni PIN, igual que el que crea la vinculación: es una identidad que solo
 * puede usarse desde aquí, nunca para iniciar sesión.
 */
export async function resolverUsuarioDeTerminal(
  prisma: PrismaService,
  usuarioId: string | null | undefined,
  sucursalId: string,
): Promise<string> {
  if (usuarioId) {
    const existente = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true } });
    if (existente) return existente.id;
  }

  const username = `${PREFIJO_USUARIO_TERMINAL}${sucursalId}`;
  const terminal = await prisma.usuario.findUnique({ where: { username }, select: { id: true } });
  if (terminal) return terminal.id;

  // La sucursal todavía no tiene usuario-terminal (se enlazó con credenciales de administrador
  // en vez de con un código). Se crea con la misma convención que VinculacionService para que
  // ambos caminos converjan en la misma identidad, no en dos.
  const sucursal = await prisma.sucursal.findUniqueOrThrow({
    where: { id: sucursalId },
    select: { empresaId: true, nombre: true },
  });

  try {
    const creado = await prisma.usuario.create({
      data: {
        empresaId: sucursal.empresaId,
        nombre: `Punto de Venta — ${sucursal.nombre}`,
        username,
        activo: true,
        sucursales: { create: { sucursalId, rol: "CAJERO", activo: true } },
      },
      select: { id: true },
    });
    return creado.id;
  } catch (e: any) {
    // Carrera contra VinculacionService creando el mismo usuario: gana uno y el otro choca con
    // el índice único de `username`. Se recupera el ganador en vez de fallar.
    if (e?.code === "P2002") {
      const ganador = await prisma.usuario.findUnique({ where: { username }, select: { id: true } });
      if (ganador) return ganador.id;
    }
    throw e;
  }
}

/** Roles que una terminal puede dar de alta por sincronización. Los de administración se otorgan
 *  solo desde el ERP: una terminal vinculada con código opera como cajero y no debe poder crear
 *  administradores. Un "Admin" local del APK (el que autoriza con su PIN en la tablet) llega como
 *  SUPERVISOR, que es lo que hace ahí. */
const ROL_DESDE_TERMINAL: Record<string, string> = {
  CAJERO: "CAJERO",
  MESERO: "MESERO",
  COCINA: "COCINA",
  SUPERVISOR: "SUPERVISOR",
  ADMIN_SUCURSAL: "SUPERVISOR",
  ADMIN_CORPORATIVO: "SUPERVISOR",
};

/**
 * Registra en el ERP un usuario dado de alta en una terminal, con el MISMO id que tiene allí.
 *
 * Antes solo se registraba si en el momento del alta había conexión Y la sesión era de
 * administrador; una tablet vinculada con código opera como cajero, así que esos usuarios no
 * llegaban nunca al ERP y sus ventas quedaban sin atribución. Conservar el id es lo que hace que
 * las ventas y turnos que ya lo nombran (encolados antes o después) queden atribuidos a la persona.
 *
 * Sin contraseña ni PIN: el PIN en texto plano nunca sale de la terminal, así que esta identidad
 * sirve para atribuir operaciones, no para iniciar sesión. Si hace falta que entre en otro lado,
 * un admin le asigna PIN desde el ERP. Idempotente: si ya existe, solo asegura su acceso a la
 * sucursal.
 */
export async function registrarUsuarioDesdeTerminal(
  prisma: PrismaService,
  datos: { id: string; empresaId: string; sucursalId: string; nombre: string; rol?: string },
): Promise<void> {
  const nombre = datos.nombre?.trim();
  if (!nombre) throw new Error("El usuario no trae nombre");
  const rol = ROL_DESDE_TERMINAL[datos.rol ?? "CAJERO"] ?? "CAJERO";

  const existente = await prisma.usuario.findUnique({ where: { id: datos.id }, select: { id: true } });
  if (!existente) {
    await prisma.usuario.create({
      data: {
        id: datos.id,
        empresaId: datos.empresaId,
        nombre,
        // Único y estable: se deriva del id, que ya es único. No lo elige la terminal.
        username: `apk.${datos.id}`,
        activo: true,
      },
    });
  }
  await prisma.usuarioSucursal.upsert({
    where: { usuarioId_sucursalId: { usuarioId: datos.id, sucursalId: datos.sucursalId } },
    // Un usuario que ya existía conserva el rol que le haya dado el ERP.
    update: { activo: true },
    create: { usuarioId: datos.id, sucursalId: datos.sucursalId, rol: rol as any, activo: true },
  });
}
