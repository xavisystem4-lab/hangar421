/** Corre solo contra los módulos de lógica pura (transacciones SQL, cola de sync, hash de auth
 *  offline, runner de migraciones) — no hay runner de componentes RN aquí, igual que en
 *  apps/waiter-mobile (que solo usa "tsc --noEmit"). Mismo patrón (ts-jest, sin babel) que
 *  packages/shared ya declara en sus devDependencies. */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Mismo criterio de nombre que packages/shared/src/calculos.spec.ts (*.spec.ts, no *.test.ts).
  moduleNameMapper: {
    "^@hangar421/shared$": "<rootDir>/../../packages/shared/src/index.ts",
  },
};
