/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "./seed-demo-data";

/**
 * Arranque automático para el backend embebido (POS Windows en modo standalone, ver
 * electron/backend-manager.ts): si la base de datos local está vacía, aplica el esquema
 * inicial (migration.sql, sin depender del CLI de Prisma) y carga los datos demo — así el
 * instalador queda listo para usarse sin ningún paso manual.
 *
 * Se activa solo con AUTO_BOOTSTRAP=true (nunca corre contra el backend cloud real).
 */
export async function autoBootstrap(prisma: PrismaClient, log: (msg: string) => void = console.log) {
  const esquemaListo = await tablaExiste(prisma, "empresas");
  if (!esquemaListo) {
    log("[bootstrap] Base de datos local vacía — aplicando esquema inicial...");
    await aplicarMigraciones(prisma, log);
  }

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

/** Aplica cada migration.sql (dentro de migrations/) en orden, sin necesitar el CLI de Prisma (que no se
 *  empaqueta en el instalador). Solo se usa en la base local embebida, nunca en producción
 *  cloud (ahí se usa `prisma migrate deploy`, ver docs/deployment.md). */
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

    log(`[bootstrap] Aplicando migración ${carpeta}...`);
    const sql = fs.readFileSync(sqlPath, "utf-8");
    for (const statement of dividirEnStatements(sql)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
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
