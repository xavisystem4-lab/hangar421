import { armarVentaHub, type Mapeos, type VentaLocal } from "./venta-hub";
import { claveOpcion, emparejarPorNombre, normalizarNombre } from "./mapeo";

describe("mapeo por nombre", () => {
  it("normaliza acentos, mayúsculas y espacios", () => {
    expect(normalizarNombre("  Café   LATTE ")).toBe("cafe latte");
    expect(claveOpcion("Leche", "Avena ")).toBe("leche|avena");
  });

  it("empareja por nombre y deja sin equivalente lo que no existe o está duplicado en la nube", () => {
    const m = emparejarPorNombre(
      [{ id: "l-latte", nombre: "Café Latte" }, { id: "l-pan", nombre: "Pan de muerto" }, { id: "l-chai", nombre: "Chai" }],
      [{ id: "n-latte", nombre: "cafe latte" }, { id: "n-chai-1", nombre: "Chai" }, { id: "n-chai-2", nombre: "chai" }],
    );
    expect(m.get("l-latte")).toBe("n-latte");
    expect(m.get("l-pan")).toBeNull();
    expect(m.get("l-chai")).toBeNull(); // dos "Chai" en la nube: decide el admin
  });

  it("desempata por categoría los nombres que se repiten (Latte caliente y Latte frío)", () => {
    const m = emparejarPorNombre(
      [{ id: "l-latte-c", nombre: "Latte", grupos: ["Calientes"] }, { id: "l-latte-f", nombre: "Latte", grupos: ["Fríos"] }, { id: "l-pan", nombre: "Concha", grupos: ["Panadería local"] }],
      [{ id: "n-latte-c", nombre: "Latte", grupos: ["Calientes"] }, { id: "n-latte-f", nombre: "latte", grupos: ["Frios"] }, { id: "n-concha", nombre: "Concha", grupos: ["Pan dulce"] }],
    );
    expect(m.get("l-latte-c")).toBe("n-latte-c");
    expect(m.get("l-latte-f")).toBe("n-latte-f");
    // Categoría distinta pero nombre único en la nube: se empareja por nombre.
    expect(m.get("l-pan")).toBe("n-concha");
  });

  it("baja a la subcategoría cuando la categoría no basta (dos Pistache en Postres)", () => {
    const m = emparejarPorNombre(
      [{ id: "l-p-gal", nombre: "Pistache", grupos: ["Galletas", "Postres"] }, { id: "l-p-rol", nombre: "Pistache", grupos: ["Roles", "Postres"] }],
      [{ id: "n-p-rol", nombre: "Pistache", grupos: ["Roles", "Postres"] }, { id: "n-p-gal", nombre: "Pistache", grupos: ["Galletas", "Postres"] }],
    );
    expect(m.get("l-p-gal")).toBe("n-p-gal");
    expect(m.get("l-p-rol")).toBe("n-p-rol");
  });
});

describe("armarVentaHub", () => {
  const base: VentaLocal = {
    id: "v-1", folio: "20260921-0007", estado: "COBRADO", createdAt: new Date("2026-09-21T15:00:00Z"),
    tipo: "MOSTRADOR", canalOrigen: "POS_WINDOWS", numComensales: 1, notasGenerales: null,
    subtotal: "100.00", impuesto: "16.00", descuentoTotal: "0", total: "116.00",
    meseroId: "u-ana", cajeroId: "u-nuevo",
    mesero: { id: "u-ana", nombre: "Ana" }, cajero: { id: "u-nuevo", nombre: "Nuevo" },
    dispositivo: { identificador: "tablet-mesero-1", nombre: "Tablet 1", tipo: "TABLET_MESERO" },
    items: [{
      id: "i-1", productoId: "l-latte", cantidad: 2, precioUnitario: "50", notas: null, producto: { nombre: "Latte" },
      modificadores: [{ id: "md-1", opcionModificadorId: "l-avena", precioExtra: "8" }, { id: "md-2", opcionModificadorId: "l-rara", precioExtra: "0" }],
    }],
    pagos: [{ id: "p-1", metodo: "EFECTIVO", monto: "116", referencia: null }],
    descuentos: [],
  };
  const mapeos: Mapeos = {
    productos: new Map([["l-latte", "n-latte"]]),
    opciones: new Map([["l-avena", "n-avena"], ["l-rara", null]]),
    usuarios: new Map([["u-ana", "n-ana"]]),
  };

  it("traduce productos, opciones y usuarios a los ids de la nube, con totales y fecha originales", () => {
    const r = armarVentaHub(base, mapeos);
    if (r.tipo !== "LISTA") throw new Error("debía estar lista");
    expect(r.venta).toMatchObject({ folioLocal: "20260921-0007", creadaEn: "2026-09-21T15:00:00.000Z", total: 116, meseroId: "n-ana" });
    expect(r.venta.items[0].productoId).toBe("n-latte");
    // La opción sin equivalente se omite; su importe ya va en el total.
    expect(r.venta.items[0].modificadores).toEqual([{ id: "md-1", opcionModificadorId: "n-avena", precioExtra: 8 }]);
    expect(r.venta.dispositivoOrigen).toEqual({ identificador: "tablet-mesero-1", nombre: "Tablet 1", tipo: "TABLET_MESERO" });
  });

  it("un usuario sin equivalente viaja con su id y se pide su alta", () => {
    const r = armarVentaHub(base, mapeos);
    if (r.tipo !== "LISTA") throw new Error("debía estar lista");
    expect(r.venta.cajeroId).toBe("u-nuevo");
    expect(r.usuariosPorAlta).toEqual([{ id: "u-nuevo", nombre: "Nuevo" }]);
  });

  it("un producto sin equivalente detiene la venta entera: espera a que el admin lo relacione", () => {
    const r = armarVentaHub({ ...base, items: [...base.items, { ...base.items[0], id: "i-2", productoId: "l-pan", producto: { nombre: "Pan de muerto" } }] }, mapeos);
    expect(r).toEqual({ tipo: "ESPERA_MAPEO", productosSinEquivalente: ["Pan de muerto"] });
  });
});
