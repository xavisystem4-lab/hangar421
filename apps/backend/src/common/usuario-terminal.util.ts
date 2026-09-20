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
