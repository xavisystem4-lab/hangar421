/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { seedDemoData, cargarCatalogoHangar421, CATALOGO_VERSION } from "./seed-demo-data";

/**
 * Arranque automático para el backend embebido (POS Windows en modo standalone, ver
 * electron/backend-manager.ts): aplica cualquier migración pendiente (migration.sql, sin
 * depender del CLI de Prisma) y, si la base está vacía, carga los datos demo — así el
 * instalador queda listo para usarse sin ningún paso manual, tanto en la primera instalación
 * como al actualizar una que ya tenía datos locales (ver `aplicarMigraciones`: reintentar
 * migraciones ya aplicadas es seguro, así que corre siempre, no solo en base vacía).
 *
 * Se activa solo con AUTO_BOOTSTRAP=true (nunca corre contra el backend cloud real).
 */
export async function autoBootstrap(prisma: PrismaClient, log: (msg: string) => void = console.log) {
  const esquemaListo = await tablaExiste(prisma, "empresas");
  log(esquemaListo ? "[bootstrap] Revisando migraciones pendientes..." : "[bootstrap] Base de datos local vacía — aplicando esquema inicial...");
  await aplicarMigraciones(prisma, log);

  const hayDatos = await prisma.empresa
    .count()
    .then((n) => n > 0)
    .catch(() => false);

  if (!hayDatos) {
    log("[bootstrap] Sin datos — cargando datos demo de HANGAR 421...");
    await seedDemoData(prisma);
    log("[bootstrap] Datos demo listos.");
  } else {
    log("[bootstrap] Base de datos ya inicializada — sincronizando catálogo...");
    await sincronizarCatalogo(prisma, log);
  }
}

/** Sincroniza el catálogo (categorías, modificadores, productos) de cada empresa contra el menú
 *  vigente de HANGAR 421 Coffee Shop, sin tocar usuarios, sucursales ni pedidos.
 *  `cargarCatalogoHangar421` es idempotente (upsert por nombre, nunca duplica) y desactiva
 *  cualquier categoría/producto que no sea parte del menú vigente (de un catálogo demo/anterior,
 *  o de una corrida previa que se haya interrumpido a medias) — por eso vale la pena que pueda
 *  correr en cualquier arranque, no solo la primera vez que sube `CATALOGO_VERSION`.
 *
 *  Pero antes se llamaba SIEMPRE, para cada empresa, en TODO arranque — una batería completa de
 *  upserts (categorías + modificadores + productos, por sucursal) que no cambia nada la inmensa
 *  mayoría de las veces, ya que `CATALOGO_VERSION` solo sube con una actualización del POS. Eso
 *  bloqueaba `app.listen()` (ver main.ts, `autoBootstrap` corre antes de escuchar el puerto) con
 *  trabajo real pero innecesario en cada arranque normal — parte de por qué el arranque del POS
 *  se sentía lento. Ahora se compara primero el marcador de versión guardado por empresa y solo
 *  se hace la resincronización pesada cuando de verdad quedó desactualizado. */
async function sincronizarCatalogo(prisma: PrismaClient, log: (msg: string) => void) {
  const empresas = await prisma.empresa.findMany();
  let actualizadas = 0;
  for (const empresa of empresas) {
    const config = (empresa.configJson as { catalogoVersion?: number } | null) ?? {};
    if (config.catalogoVersion === CATALOGO_VERSION) continue;

    const sucursales = await prisma.sucursal.findMany({ where: { empresaId: empresa.id }, select: { id: true } });
    await cargarCatalogoHangar421(prisma, empresa.id, sucursales.map((s) => s.id));
    await prisma.empresa.update({ where: { id: empresa.id }, data: { configJson: { ...config, catalogoVersion: CATALOGO_VERSION } } });
    actualizadas++;
  }
  log(actualizadas > 0 ? `[bootstrap] Catálogo sincronizado (${actualizadas} empresa(s) actualizadas).` : "[bootstrap] Catálogo ya al día — nada que sincronizar.");
}

async function tablaExiste(prisma: PrismaClient, tabla: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) as "exists"`,
      tabla,
    );
    return rows[0]?.exists ?? false;
  } catch {
    return false;
  }
}

/** Aplica cada migration.sql (dentro de migrations/) en orden, sin necesitar el CLI de Prisma
 *  (que no se empaqueta en el instalador) — y sin volver a repetir una migración que una corrida
 *  anterior de esta misma función ya dejó aplicada (ver `_hangar_migrations_aplicadas` abajo).
 *
 *  Antes NO había ninguna tabla de control propia (no confundir con `_prisma_migrations`, que es
 *  del CLI de Prisma y este backend embebido nunca usa) — así que se reintentaba TODO el
 *  historial completo de migraciones en TODO arranque, ignorando los errores "ya existe" de cada
 *  statement ya aplicado en una instalación previa. Funcionaba, pero con costo real y creciente:
 *  ~154 sentencias (y subiendo con cada migración nueva que se agregue), cada una un round-trip
 *  a Postgres, la enorme mayoría fallando con una excepción que hay que armar y descartar — todo
 *  esto bloqueando `app.listen()` (ver main.ts) en CADA arranque del POS, no solo tras actualizar
 *  a una versión con migraciones nuevas. Es lo que hacía sentir lento el arranque de la app.
 *
 *  Ahora se guarda qué migración ya se aplicó y se saltan por completo (cero round-trips) las que
 *  ya están registradas — un arranque normal, sin migraciones nuevas, ya no ejecuta ni un solo
 *  statement de este historial. La primera vez que corre esta versión sobre una instalación ya
 *  inicializada (que nunca tuvo esta tabla), sigue reintentando el historial completo una única
 *  vez — el manejo de "ya existe" se conserva justamente para ese caso — y a partir de ahí queda
 *  todo registrado. Cualquier otro error (sintaxis, conexión, etc.) sí se relanza. Solo se usa en
 *  la base local embebida, nunca en producción cloud (ahí se usa `prisma migrate deploy`, ver
 *  docs/deployment.md). */
async function aplicarMigraciones(prisma: PrismaClient, log: (msg: string) => void) {
  const prismaDir = process.env.BACKEND_PRISMA_DIR ?? path.join(__dirname, "../../prisma");
  const migrationsDir = path.join(prismaDir, "migrations");

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`No se encontró el directorio de migraciones: ${migrationsDir}`);
  }

  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "_hangar_migrations_aplicadas" (nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`,
  );
  const yaAplicadas = new Set(
    (
      await prisma.$queryRawUnsafe<{ nombre: string }[]>(`SELECT nombre FROM "_hangar_migrations_aplicadas"`)
    ).map((r) => r.nombre),
  );

  const carpetas = fs
    .readdirSync(migrationsDir)
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory())
    .sort();

  let aplicadasAhora = 0;
  for (const carpeta of carpetas) {
    if (yaAplicadas.has(carpeta)) continue;
    aplicadasAhora++;

    const sqlPath = path.join(migrationsDir, carpeta, "migration.sql");
    if (fs.existsSync(sqlPath)) {
      const sql = fs.readFileSync(sqlPath, "utf-8");
      let cambiosNuevos = 0;
      for (const statement of dividirEnStatements(sql)) {
        try {
          await prisma.$executeRawUnsafe(statement);
          cambiosNuevos++;
        } catch (e) {
          if (!esErrorYaExiste(e)) throw e;
        }
      }
      if (cambiosNuevos > 0) log(`[bootstrap] Migración ${carpeta}: ${cambiosNuevos} cambio(s) nuevo(s) aplicado(s).`);
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "_hangar_migrations_aplicadas" (nombre) VALUES ($1) ON CONFLICT DO NOTHING`, carpeta);
  }
  log(aplicadasAhora > 0 ? `[bootstrap] ${aplicadasAhora} migración(es) nueva(s) registrada(s).` : "[bootstrap] Migraciones ya al día — nada que aplicar.");
}

/** SQLSTATE de Postgres para "ya existe" (tabla/tipo/columna/esquema) — esperados al reintentar
 *  migraciones antiguas sobre una base ya inicializada; con mensaje como respaldo por si algún
 *  driver no llena `meta.code`. */
function esErrorYaExiste(e: unknown): boolean {
  const codigo = (e as { meta?: { code?: string } } | undefined)?.meta?.code;
  const YA_EXISTE = new Set(["42P07", "42710", "42701", "42P06", "42P04", "42723"]);
  if (codigo && YA_EXISTE.has(codigo)) return true;
  const mensaje = String((e as { message?: string } | undefined)?.message ?? "");
  return /already exists|ya existe/i.test(mensaje);
}

/** Prisma ejecuta cada raw query como un prepared statement — Postgres no permite múltiples
 *  sentencias en uno solo, así que el .sql se divide por ";" de fin de línea. El migration.sql
 *  generado por Prisma para este esquema no usa bloques $$ (sin funciones/triggers), por lo
 *  que dividir por ";" es seguro aquí. Cada bloque suele llevar un comentario `-- CreateX` en
 *  su primera línea (no solo statements que empiezan con "--" sin más) — se limpian todas las
 *  líneas de comentario del bloque, no solo la primera, antes de descartar bloques vacíos. */
function dividirEnStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/g)
    .map((bloque) =>
      bloque
        .split("\n")
        .filter((linea) => !linea.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);
}
