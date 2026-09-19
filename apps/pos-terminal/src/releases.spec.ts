import { esVersionMasNueva, elegirReleaseMasNuevo, versionDeTag } from "./releases";

describe("esVersionMasNueva", () => {
  it("detecta una versión mayor", () => {
    expect(esVersionMasNueva("0.1.3", "0.1.2")).toBe(true);
    expect(esVersionMasNueva("0.2.0", "0.1.9")).toBe(true);
    expect(esVersionMasNueva("1.0.0", "0.9.9")).toBe(true);
  });

  it("no ofrece actualizar a la misma versión ni a una anterior", () => {
    expect(esVersionMasNueva("0.1.2", "0.1.2")).toBe(false);
    expect(esVersionMasNueva("0.1.1", "0.1.2")).toBe(false);
  });

  // El motivo de comparar número a número en vez de como texto: alfabéticamente "0.10.0" queda
  // ANTES que "0.2.9", así que una comparación de strings dejaría de ofrecer actualizaciones
  // justo al pasar de la versión 9 a la 10 — y en silencio.
  it("compara numéricamente, no alfabéticamente", () => {
    expect(esVersionMasNueva("0.10.0", "0.2.9")).toBe(true);
    expect(esVersionMasNueva("0.2.9", "0.10.0")).toBe(false);
    expect(esVersionMasNueva("0.1.10", "0.1.9")).toBe(true);
  });

  it("tolera versiones con distinto número de partes o basura", () => {
    expect(esVersionMasNueva("0.2", "0.1.9")).toBe(true);
    expect(esVersionMasNueva("0.1.2", "0.1.2.0")).toBe(false);
    expect(esVersionMasNueva("no-es-version", "0.0.0")).toBe(false);
  });
});

describe("elegirReleaseMasNuevo", () => {
  const release = (tag: string, draft = false) => ({ tag_name: tag, draft });

  // En este repositorio conviven tres apps. Filtrar mal ofrecería al cajero el APK de Meseros
  // o el instalador de Windows.
  it("ignora los releases de las otras apps del repositorio", () => {
    const elegido = elegirReleaseMasNuevo([
      release("v0.2.69"), // POS Windows
      release("waiter-v0.1.13"), // Meseros
      release("pos-terminal-v0.1.2"),
    ]);
    expect(elegido?.tag_name).toBe("pos-terminal-v0.1.2");
  });

  it("elige por versión, no por el orden en que llegan", () => {
    const elegido = elegirReleaseMasNuevo([
      release("pos-terminal-v0.1.2"),
      release("pos-terminal-v0.1.10"),
      release("pos-terminal-v0.1.9"),
    ]);
    expect(elegido?.tag_name).toBe("pos-terminal-v0.1.10");
  });

  it("descarta los borradores", () => {
    const elegido = elegirReleaseMasNuevo([
      release("pos-terminal-v0.9.9", true),
      release("pos-terminal-v0.1.2"),
    ]);
    expect(elegido?.tag_name).toBe("pos-terminal-v0.1.2");
  });

  // Los releases de esta app se publican SIEMPRE como prerelease, para que el auto-actualizador
  // del POS Windows no intente "actualizarse" hacia este APK. Descartarlos dejaría la lista
  // vacía y el botón diría "Al día" para siempre.
  it("acepta prerelease — todos los de esta app lo son", () => {
    const elegido = elegirReleaseMasNuevo([{ tag_name: "pos-terminal-v0.1.3", draft: false, prerelease: true }]);
    expect(elegido?.tag_name).toBe("pos-terminal-v0.1.3");
  });

  it("devuelve null si no hay ninguno de esta app", () => {
    expect(elegirReleaseMasNuevo([release("waiter-v0.1.13"), release("v0.2.69")])).toBeNull();
    expect(elegirReleaseMasNuevo([])).toBeNull();
  });
});

describe("versionDeTag", () => {
  it("quita el prefijo de esta app", () => {
    expect(versionDeTag("pos-terminal-v0.1.3")).toBe("0.1.3");
  });
});
