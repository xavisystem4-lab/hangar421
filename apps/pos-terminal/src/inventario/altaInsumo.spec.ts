import { BORRADOR_VACIO, normalizarNombre, validarInsumo, type BorradorInsumo } from "./altaInsumo";

const b = (p: Partial<BorradorInsumo>): BorradorInsumo => ({ ...BORRADOR_VACIO, ...p });
const existentes = [
  { id: "i1", nombre: "Leche entera" },
  { id: "i2", nombre: "Café en grano" },
];

describe("normalizarNombre", () => {
  it("ignora mayúsculas, acentos y espacios de más", () => {
    expect(normalizarNombre("  CAFÉ   en Grano ")).toBe("cafe en grano");
  });
});

describe("validarInsumo", () => {
  it("acepta un insumo nuevo y convierte los números", () => {
    const r = validarInsumo(b({ nombre: " Vasos  12oz ", unidadMedida: "pz", costoUnitario: "1,50", minimo: "100", maximo: "500" }), existentes);
    expect(r).toEqual({
      ok: true,
      datos: { nombre: "Vasos 12oz", unidadMedida: "pz", costoUnitario: 1.5, proveedorId: null, minimo: 100, maximo: 500 },
    });
  });

  it("deja mínimo y máximo sin definir si no se capturan, y costo en 0", () => {
    const r = validarInsumo(b({ nombre: "Popotes" }), existentes);
    expect(r.ok && r.datos).toMatchObject({ costoUnitario: 0, minimo: undefined, maximo: undefined });
  });

  it("rechaza un nombre que ya está en el inventario aunque cambie el formato", () => {
    const r = validarInsumo(b({ nombre: "leche  ENTERA" }), existentes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Leche entera");
  });

  it("al editar no se compara contra sí mismo", () => {
    expect(validarInsumo(b({ nombre: "Leche Entera" }), existentes, "i1").ok).toBe(true);
    expect(validarInsumo(b({ nombre: "Café en grano" }), existentes, "i1").ok).toBe(false);
  });

  it("rechaza nombre vacío, unidad desconocida y números inválidos", () => {
    expect(validarInsumo(b({ nombre: " " }), existentes).ok).toBe(false);
    expect(validarInsumo(b({ nombre: "Azúcar", unidadMedida: "taza" }), existentes).ok).toBe(false);
    expect(validarInsumo(b({ nombre: "Azúcar", costoUnitario: "abc" }), existentes).ok).toBe(false);
    expect(validarInsumo(b({ nombre: "Azúcar", minimo: "-1" }), existentes).ok).toBe(false);
  });

  it("rechaza un máximo menor que el mínimo", () => {
    expect(validarInsumo(b({ nombre: "Azúcar", minimo: "10", maximo: "5" }), existentes).ok).toBe(false);
  });
});
