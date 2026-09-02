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
    log("[bootstrap] Base de datos ya inicializada, se omite la siembra de datos demo.");
    await actualizarCatalogoSiHaceFalta(prisma, log);
  }
}

/** Si una instalación ya tenía datos (por ejemplo, de una versión anterior del POS con el menú
 *  demo viejo) y `CATALOGO_VERSION` subió desde entonces, reemplaza el catálogo (categorías,
 *  productos, modificadores) de cada empresa por el vigente — sin tocar usuarios, sucursales
 *  ni pedidos. Los productos/categorías viejos se desactivan (`activo:false`, ya filtrados en
 *  todas las consultas del catálogo) en vez de borrarse, para no chocar con pedidos históricos
 *  que los referencien. */
async function actualizarCatalogoSiHaceFalta(prisma: PrismaClient, log: (msg: string) => void) {
  const empresas = await prisma.empresa.findMany();
  for (const empresa of empresas) {
    const config = (empresa.configJson as { catalogoVersion?: number } | null) ?? {};
    const version = config.catalogoVersion ?? 0;
    if (version >= CATALOGO_VERSION) continue;

    log(`[bootstrap] Actualizando catálogo de "${empresa.nombre}" (v${version} → v${CATALOGO_VERSION})...`);
    await prisma.categoriaProducto.updateMany({ where: { empresaId: empresa.id }, data: { activo: false } });
    await prisma.producto.updateMany({ where: { empresaId: empresa.id }, data: { activo: false } });

    const sucursales = await prisma.sucursal.findMany({ where: { empresaId: empresa.id }, select: { id: true } });
    await cargarCatalogoHangar421(prisma, empresa.id, sucursales.map((s) => s.id));
    await prisma.empresa.update({ where: { id: empresa.id }, data: { configJson: { ...config, catalogoVersion: CATALOGO_VERSION } } });
    log(`[bootstrap] Catálogo de "${empresa.nombre}" actualizado.`);
  }
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
 *  (que no se empaqueta en el instalador). Corre en TODO arranque, no solo en base vacía —
 *  como no hay tabla `_prisma_migrations` (nunca pasó por el CLI), no hay forma de saber qué
 *  ya se aplicó, así que se reintenta todo el historial completo cada vez y se ignoran los
 *  errores "ya existe" (statement ya aplicado en una versión anterior del instalador) — así
 *  una actualización sobre una base local ya inicializada (de una versión previa del POS)
 *  recibe las columnas/tablas nuevas de las migraciones agregadas después. Cualquier otro
 *  error (sintaxis, conexión, etc.) sí se relanza. Solo se usa en la base local embebida,
 *  nunca en producción cloud (ahí se usa `prisma migrate deploy`, ver docs/deployment.md). */
async function aplicarMigraciones(prisma: PrismaClient, log: (msg: string) => void) {
  const prismaDir = process.env.BACKEND_PRISMA_DIR ?? path.join(__dirname, "../../prisma");
  const migrationsDir = path.join(prismaDir, "migrations");

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`No se encontró el directorio de migraciones: ${migrationsDir}`);
  }

  const carpetas = fs
    .readdirSync(migrationsDir)
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory())
    .sort();

  for (const carpeta of carpetas) {
    const sqlPath = path.join(migrationsDir, carpeta, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;

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
