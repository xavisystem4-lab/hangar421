/** Config de Jest para el backend. Mapea @hangar421/shared a su fuente TS
 *  (no requiere buildear el paquete compartido antes de testear). */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: { "^.+\\.(t|j)s$": "ts-jest" },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@hangar421/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
  },
};
