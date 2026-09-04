// Soporte de monorepo (npm workspaces) para Metro — ver guía oficial:
// https://docs.expo.dev/guides/monorepos/
// Sin esto, Metro solo busca dependencias dentro de apps/waiter-mobile/node_modules y no
// encuentra @hangar421/shared (que vive como symlink de workspace en <raíz>/node_modules,
// apuntando a packages/shared).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Vigila también el resto del monorepo (para que cambios en packages/shared disparen refresh).
config.watchFolders = [workspaceRoot];

// Busca módulos primero en el proyecto y, si no están ahí, en el node_modules del workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Sin esto, Metro prioriza el node_modules físicamente más cercano al archivo que hace el
// import (algoritmo estándar de Node) por encima de `nodeModulesPaths` — y `expo` trae su
// propia copia anidada de react-native (node_modules/expo/node_modules/react-native, una
// versión mucho más nueva que la del proyecto) que ganaba esa carrera y rompía el bundle con
// errores de sintaxis. `disableHierarchicalLookup` fuerza a Metro a resolver SIEMPRE según
// `nodeModulesPaths` de arriba (donde apps/waiter-mobile/node_modules/react-native@0.74.5,
// la versión real del proyecto, va primero).
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
