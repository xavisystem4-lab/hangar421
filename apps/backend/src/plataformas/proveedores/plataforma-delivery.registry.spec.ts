import { NotFoundException } from "@nestjs/common";
import { PlataformaDeliveryRegistry } from "./plataforma-delivery.registry";

describe("PlataformaDeliveryRegistry", () => {
  const didi = { codigo: "didi" } as any;
  const uber = { codigo: "uber" } as any;
  const rappi = { codigo: "rappi" } as any;
  const mock = { codigo: "mock" } as any;
  const registry = new PlataformaDeliveryRegistry(didi, uber, rappi, mock);

  it("devuelve el adaptador correcto para cada código registrado", () => {
    expect(registry.obtener("didi")).toBe(didi);
    expect(registry.obtener("uber")).toBe(uber);
    expect(registry.obtener("rappi")).toBe(rappi);
    expect(registry.obtener("mock")).toBe(mock);
  });

  it("lanza NotFoundException ante un código no registrado", () => {
    expect(() => registry.obtener("otra-plataforma")).toThrow(NotFoundException);
  });

  it("listarCodigos() expone los 4 códigos registrados", () => {
    expect(registry.listarCodigos().sort()).toEqual(["didi", "mock", "rappi", "uber"]);
  });
});
