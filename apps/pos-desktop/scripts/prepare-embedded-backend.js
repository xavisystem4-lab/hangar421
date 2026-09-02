#!/usr/bin/env node
/**
 * Prepara apps/pos-desktop/resources/backend/ — todo lo que el instalador necesita para
 * correr el backend HANGAR 421 embebido sin depender de nada externo:
 *   resources/backend/dist/           <- apps/backend/dist (compilado)
 *   resources/backend/prisma/         <- schema.prisma + migrations/ (para el bootstrap
 *                                         automático, ver src/bootstrap/auto-bootstrap.ts)
 *   resources/backend/node_modules/   <- dependencias de producción del backend, instaladas
 *                                         de cero aquí (standalone, no el node_modules
 *                                         hoisteado del monorepo) + @hangar421/shared copiado
 *   resources/backend/node/           <- el binario de Node actualmente en uso (el mismo con
 *                                         el que corre este script), para no depender de
 *                                         Electron-como-Node (problemas de ABI con módulos
 *                                         nativos, ver electron/backend-manager.ts)
 *
 * Se corre en CI (.github/workflows/release-pos.yml) antes de `electron-builder`, y puede
 * correrse igual en Windows para un build local (ver docs/installation.md).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../..");
const BACKEND_DIR = path.join(ROOT, "apps/backend");
const SHARED_DIR = path.join(ROOT, "packages/shared");
const OUT_DIR = path.join(__dirname, "../resources/backend");

function log(msg) {
  console.log(`[prepare-embedded-backend] ${msg}`);
}

function copiarDir(origen, destino, opciones = {}) {
  fs.rmSync(destino, { recursive: true, force: true });
  fs.cpSync(origen, destino, { recursive: true, ...opciones });
}

function main() {
  if (!fs.existsSync(path.join(BACKEND_DIR, "dist", "main.js"))) {
    throw new Error(`No se encontró apps/backend/dist/main.js — corre "npm run build --workspace=apps/backend" primero.`);
  }
  if (!fs.existsSync(path.join(SHARED_DIR, "dist", "index.js"))) {
    throw new Error(`No se encontró packages/shared/dist/index.js — corre "npm run build:shared" primero.`);
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  log("Copiando dist del backend...");
  copiarDir(path.join(BACKEND_DIR, "dist"), path.join(OUT_DIR, "dist"));

  log("Copiando prisma/ (schema + migraciones)...");
  copiarDir(path.join(BACKEND_DIR, "prisma"), path.join(OUT_DIR, "prisma"), {
    filter: (src) => !src.includes(`${path.sep}migrations${path.sep}dev.db`),
  });

  log("Generando package.json standalone con las dependencias de producción...");
  const backendPkg = JSON.parse(fs.readFileSync(path.join(BACKEND_DIR, "package.json"), "utf-8"));
  const { "@hangar421/shared": _omitido, ...dependenciasProduccion } = backendPkg.dependencies;
  const prismaVersion = backendPkg.devDependencies.prisma; // para generar el engine correcto
  fs.writeFileSync(
    path.join(OUT_DIR, "package.json"),
    JSON.stringify(
      {
        name: "hangar421-backend-embebido",
        private: true,
        version: backendPkg.version,
        dependencies: { ...dependenciasProduccion, prisma: prismaVersion },
      },
      null,
      2,
    ),
  );

  log("Instalando dependencias de producción (npm install --omit=dev)...");
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: OUT_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  log("Copiando @hangar421/shared (build CJS) dentro del node_modules standalone...");
  const sharedDestino = path.join(OUT_DIR, "node_modules", "@hangar421", "shared");
  fs.mkdirSync(path.dirname(sharedDestino), { recursive: true });
  fs.mkdirSync(sharedDestino, { recursive: true });
  copiarDir(path.join(SHARED_DIR, "dist"), path.join(sharedDestino, "dist"));
  fs.writeFileSync(
    path.join(sharedDestino, "package.json"),
    JSON.stringify({ name: "@hangar421/shared", version: "0.1.0", main: "dist/index.js", types: "dist/index.d.ts" }, null, 2),
  );

  log("Generando el cliente de Prisma (motor nativo para esta plataforma)...");
  execFileSync("npx", ["prisma", "generate", "--schema=./prisma/schema.prisma"], {
    cwd: OUT_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  log("Quitando el CLI de prisma (ya generó el cliente, no se necesita en runtime)...");
  for (const paquete of ["prisma", "@prisma/engines", "@prisma/fetch-engine", "@prisma/get-platform"]) {
    fs.rmSync(path.join(OUT_DIR, "node_modules", paquete), { recursive: true, force: true });
  }

  log("Copiando el binario de Node...");
  const nodeDestDir = path.join(OUT_DIR, "node");
  fs.mkdirSync(nodeDestDir, { recursive: true });
  const nodeBin = process.platform === "win32" ? "node.exe" : "node";
  fs.copyFileSync(process.execPath, path.join(nodeDestDir, nodeBin));
  if (process.platform !== "win32") fs.chmodSync(path.join(nodeDestDir, nodeBin), 0o755);

  log(`Listo: ${OUT_DIR}`);
}

main();
