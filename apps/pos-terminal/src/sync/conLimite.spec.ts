import { conLimite } from "./conLimite";

describe("conLimite", () => {
  it("deja pasar lo que termina a tiempo", async () => {
    await expect(conLimite(Promise.resolve(7), 1000, "Prueba")).resolves.toBe(7);
  });

  it("corta lo que se queda colgado con un mensaje claro", async () => {
    jest.useFakeTimers();
    const colgada = new Promise<number>(() => undefined);
    const p = conLimite(colgada, 120_000, "Inventario");
    jest.advanceTimersByTime(120_001);
    await expect(p).rejects.toThrow("Inventario: tardó más de 120 s");
    jest.useRealTimers();
  });
});
