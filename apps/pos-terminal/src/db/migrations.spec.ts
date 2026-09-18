import { MIGRACIONES } from "./migrations";

// expo-sqlite es un módulo nativo — no corre bajo Jest/Node sin el runtime real de Expo, así que
// esta prueba valida los invariantes ESTRUCTURALES del arreglo de migraciones (versiones únicas,
// consecutivas, ordenadas) sin abrir una base de datos real. La prueba de ejecución real contra
// un archivo SQLite temporal llega en Fase 1, cuando se agregue infraestructura de test para
// módulos nativos (ver docs/pendiente en el plan).
describe("MIGRACIONES", () => {
  it("tiene al menos una migración", () => {
    expect(MIGRACIONES.length).toBeGreaterThan(0);
  });

  it("tiene versiones únicas", () => {
    const versiones = MIGRACIONES.map((m) => m.version);
    expect(new Set(versiones).size).toBe(versiones.length);
  });

  it("empieza en 1 y es consecutiva (sin huecos)", () => {
    const versiones = [...MIGRACIONES.map((m) => m.version)].sort((a, b) => a - b);
    versiones.forEach((v, i) => expect(v).toBe(i + 1));
  });

  it("cada migración tiene nombre y función up()", () => {
    for (const m of MIGRACIONES) {
      expect(m.nombre.length).toBeGreaterThan(0);
      expect(typeof m.up).toBe("function");
    }
  });
});
