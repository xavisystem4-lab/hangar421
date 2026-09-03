import { TipoDispositivo } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * El POS Windows (y la app de meseros) generan su propio identificador de dispositivo local
 * (huella de instalación, ver `electron/db.ts` -> `obtenerDeviceId()`: un UUID aleatorio que se
 * guarda en su SQLite local la primera vez que arrancan) y lo mandan como `dispositivoId` en
 * cada pedido/sync — pero varias tablas (`pedidos.dispositivoId`, `sync_queue_items.dispositivoId`,
 * `audit_logs.dispositivoId`) tienen ese campo como llave foránea real hacia `Dispositivo.id`
 * (la PK, no el identificador). Como ese dispositivo nunca queda registrado por su cuenta, esa
 * huella jamás coincide con ningún `Dispositivo.id` real — cualquier inserción con ese valor
 * revienta con una violación de llave foránea (Prisma P2003), que al no estar contemplada se va
 * como 500 genérico ("Error interno del servidor") en vez de fallar con un mensaje claro o,
 * mejor, simplemente funcionar.
 *
 * La causa raíz: nadie registra el dispositivo. Esta función resuelve esa huella cliente a un
 * `Dispositivo.id` real, registrándolo sobre la marcha (upsert por `identificador`, que sí tiene
 * `@unique`) la primera vez que se ve — así el dispositivo queda dado de alta solo, sin pasos
 * manuales, y cualquier pedido/sync que lo use como FK deja de fallar.
 */
export async function resolverDispositivoId(
  prisma: PrismaService,
  identificadorCliente: string | null | undefined,
  sucursalId: string | null | undefined,
): Promise<string | undefined> {
  if (!identificadorCliente) return undefined;

  const existente = await prisma.dispositivo.findUnique({ where: { identificador: identificadorCliente } });
  if (existente) return existente.id;

  // Sin sucursalId no se puede registrar (el modelo lo pide) — se deja sin dispositivo antes que
  // reventar; quien llame decide si eso es aceptable (el campo es opcional en pedidos/audit_logs).
  if (!sucursalId) return undefined;

  try {
    const creado = await prisma.dispositivo.create({
      data: {
        sucursalId,
        nombre: `Dispositivo ${identificadorCliente.slice(0, 8)}`,
        tipo: TipoDispositivo.OTRO,
        identificador: identificadorCliente,
      },
    });
    return creado.id;
  } catch (e: any) {
    // Carrera: dos requests casi simultáneas registrando el mismo dispositivo nuevo — la
    // segunda choca contra el índice único de `identificador` (P2002); se recupera el que
    // ganó la carrera en vez de fallar.
    if (e?.code === "P2002") {
      const ganador = await prisma.dispositivo.findUnique({ where: { identificador: identificadorCliente } });
      if (ganador) return ganador.id;
    }
    throw e;
  }
}
