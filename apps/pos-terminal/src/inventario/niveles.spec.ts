import {
  agruparPorProveedor, diferenciaConteo, generarListaCompras, nivelDe, ordenarPorUrgencia,
  type ExistenciaInsumo,
} from "./niveles";

const base = (p: Partial<ExistenciaInsumo>): ExistenciaInsumo => ({
  insumoId: "i1", nombre: "Café en grano", unidadMedida: "kg",
  existencia: 10, minimo: 5, maximo: null, costoUnitario: 100, proveedorNombre: "Tostadores SA",
  ...p,
});

describe("nivelDe", () => {
  it("agotado cuando no queda nada", () => {
    expect(nivelDe(base({ existencia: 0 }))).toBe("agotado");
    expect(nivelDe(base({ existencia: -1 }))).toBe("agotado");
  });

  // La mitad del mínimo o menos es "hay que comprar hoy", no "compra esta semana": son dos
  // urgencias distintas para quien hace el pedido.
  it("crítico a la mitad del mínimo o menos", () => {
    expect(nivelDe(base({ existencia: 2.5, minimo: 5 }))).toBe("critico");
    expect(nivelDe(base({ existencia: 1, minimo: 5 }))).toBe("critico");
  });

  it("bajo entre la mitad del mínimo y el mínimo", () => {
    expect(nivelDe(base({ existencia: 4, minimo: 5 }))).toBe("bajo");
  });

  it("justo en el mínimo todavía no está bajo", () => {
    expect(nivelDe(base({ existencia: 5, minimo: 5 }))).toBe("ok");
  });

  it("exceso por encima del máximo", () => {
    expect(nivelDe(base({ existencia: 30, minimo: 5, maximo: 20 }))).toBe("exceso");
  });

  // Sin mínimo configurado no hay contra qué comparar. Pintarlo en rojo llenaría la pantalla de
  // falsas alarmas el primer día, antes de que nadie haya configurado nada.
  it("un insumo sin mínimo nunca está bajo", () => {
    expect(nivelDe(base({ existencia: 1, minimo: 0 }))).toBe("ok");
    expect(nivelDe(base({ existencia: 0.1, minimo: 0 }))).toBe("ok");
  });
});

describe("ordenarPorUrgencia", () => {
  it("pone primero lo que hay que atender", () => {
    const items = [
      base({ insumoId: "ok", nombre: "Azúcar", existencia: 50 }),
      base({ insumoId: "agotado", nombre: "Leche", existencia: 0 }),
      base({ insumoId: "bajo", nombre: "Vasos", existencia: 4, minimo: 5 }),
      base({ insumoId: "critico", nombre: "Tapas", existencia: 1, minimo: 5 }),
    ];
    expect(ordenarPorUrgencia(items).map((i) => i.insumoId)).toEqual(["agotado", "critico", "bajo", "ok"]);
  });

  it("no muta el arreglo original", () => {
    const items = [base({ insumoId: "a", existencia: 50 }), base({ insumoId: "b", existencia: 0 })];
    ordenarPorUrgencia(items);
    expect(items[0].insumoId).toBe("a");
  });
});

describe("generarListaCompras", () => {
  it("solo incluye lo que está por debajo del mínimo", () => {
    const lista = generarListaCompras([
      base({ insumoId: "ok", existencia: 50, minimo: 5 }),
      base({ insumoId: "bajo", existencia: 2, minimo: 5 }),
    ]);
    expect(lista.map((l) => l.insumoId)).toEqual(["bajo"]);
  });

  // Reponer justo hasta el mínimo dejaría el insumo en la frontera y otra vez en la lista al día
  // siguiente: se repone al doble del mínimo cuando no hay máximo.
  it("repone al doble del mínimo si no hay máximo", () => {
    const [l] = generarListaCompras([base({ existencia: 2, minimo: 5, maximo: null })]);
    expect(l.sugerido).toBe(8); // 5*2 − 2
  });

  it("repone hasta el máximo cuando está definido", () => {
    const [l] = generarListaCompras([base({ existencia: 2, minimo: 5, maximo: 12 })]);
    expect(l.sugerido).toBe(10); // 12 − 2
  });

  // No se compra media caja, y quedarse corto es peor que pasarse por una unidad.
  it("redondea hacia arriba", () => {
    const [l] = generarListaCompras([base({ existencia: 1.2, minimo: 3, maximo: null })]);
    expect(l.sugerido).toBe(5); // ceil(6 − 1.2)
  });

  it("calcula el costo estimado con el costo unitario", () => {
    const [l] = generarListaCompras([base({ existencia: 0, minimo: 5, costoUnitario: 12.5 })]);
    expect(l.sugerido).toBe(10);
    expect(l.costoEstimado).toBe(125);
  });

  // Un insumo agotado sin mínimo configurado daría "comprar 0", que confunde más que ayuda:
  // no hay nada que pedir hasta que alguien le ponga un mínimo.
  it("descarta las líneas con cantidad cero", () => {
    expect(generarListaCompras([base({ existencia: 0, minimo: 0, maximo: null })])).toHaveLength(0);
  });

  it("ordena por urgencia y agrupa por proveedor dentro de cada nivel", () => {
    const lista = generarListaCompras([
      base({ insumoId: "bajo", nombre: "Vasos", existencia: 4, minimo: 5, proveedorNombre: "B" }),
      base({ insumoId: "agotado", nombre: "Leche", existencia: 0, minimo: 5, proveedorNombre: "Z" }),
    ]);
    expect(lista[0].insumoId).toBe("agotado");
  });

  it("agrupa los que no tienen proveedor bajo una etiqueta legible", () => {
    const [l] = generarListaCompras([base({ existencia: 0, minimo: 2, proveedorNombre: null })]);
    expect(l.proveedorNombre).toBe("Sin proveedor asignado");
  });
});

describe("agruparPorProveedor", () => {
  it("junta las líneas y suma el costo de cada proveedor", () => {
    const lista = generarListaCompras([
      base({ insumoId: "a", nombre: "Café", existencia: 0, minimo: 1, costoUnitario: 10, proveedorNombre: "Tostadores" }),
      base({ insumoId: "b", nombre: "Leche", existencia: 0, minimo: 1, costoUnitario: 5, proveedorNombre: "Tostadores" }),
      base({ insumoId: "c", nombre: "Vasos", existencia: 0, minimo: 1, costoUnitario: 2, proveedorNombre: "Empaques" }),
    ]);
    const grupos = agruparPorProveedor(lista);
    expect(grupos.map((g) => g.proveedor)).toEqual(["Empaques", "Tostadores"]);
    expect(grupos.find((g) => g.proveedor === "Tostadores")!.costo).toBe(30); // (2*10)+(2*5)
  });
});

describe("diferenciaConteo", () => {
  it("positiva cuando sobra respecto al sistema", () => {
    expect(diferenciaConteo(12, 10)).toBe(2);
  });

  it("negativa cuando falta", () => {
    expect(diferenciaConteo(8, 10)).toBe(-2);
  });

  // Los insumos van en gramos y mililitros: sin redondear, 0.3−0.1 saldría 0.19999999999999998
  // y la pantalla mostraría una diferencia donde no la hay.
  it("no arrastra residuos de coma flotante", () => {
    expect(diferenciaConteo(0.3, 0.1)).toBe(0.2);
    expect(diferenciaConteo(0.1 + 0.2, 0.3)).toBe(0);
  });
});
