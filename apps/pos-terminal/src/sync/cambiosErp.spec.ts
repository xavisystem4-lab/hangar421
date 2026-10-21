import { hayCambioNuevo } from "./cambiosErpLogica";

describe("hayCambioNuevo", () => {
  const marca = (version: string | null, dispositivoId: string | null = null) => ({ version, que: "Catálogo y precios", dispositivoId });

  it("avisa si el ERP cambió después de la última descarga", () => {
    expect(hayCambioNuevo(marca("2026-10-21T15:00:00.000Z"), "2026-10-21T14:00:00.000Z", "tab-1")).toBe(true);
  });
  it("no avisa si ya se bajó", () => {
    expect(hayCambioNuevo(marca("2026-10-21T14:00:00.000Z"), "2026-10-21T14:00:00.000Z", "tab-1")).toBe(false);
    expect(hayCambioNuevo(marca("2026-10-21T13:00:00.000Z"), "2026-10-21T14:00:00.000Z", "tab-1")).toBe(false);
  });
  it("no avisa a la tablet que hizo el cambio", () => {
    expect(hayCambioNuevo(marca("2026-10-21T15:00:00.000Z", "tab-1"), "2026-10-21T14:00:00.000Z", "tab-1")).toBe(false);
  });
  it("sin marca o sin descarga previa no avisa", () => {
    expect(hayCambioNuevo(marca(null), "2026-10-21T14:00:00.000Z", "tab-1")).toBe(false);
    expect(hayCambioNuevo(marca("2026-10-21T15:00:00.000Z"), null, "tab-1")).toBe(false);
    expect(hayCambioNuevo(null, "x", "tab-1")).toBe(false);
  });
});
