import {
  escaparHtml, filasDetalle, filasResumen, formatearDinero, formatearFecha,
  htmlReporte, nombreArchivo, type DatosReporte,
} from "./armarReporte";

const BASE: DatosReporte = {
  sucursal: "Roma Norte",
  desde: "2026-09-01T00:00:00.000Z",
  hasta: "2026-09-30T23:59:59.999Z",
  cajero: null,
  busqueda: null,
  totalVentas: 1234.5,
  cantidadVentas: 10,
  ticketPromedio: 123.45,
  porMetodo: [{ metodo: "Efectivo", total: 1000, cantidad: 8 }],
  topProductos: [{ nombre: "Latte", cantidad: 12, total: 840 }],
  ventas: [
    { folioLocal: 1, createdAt: "2026-09-15T18:30:00.000Z", total: 85, cajero: "Ana", metodos: "EFECTIVO", productos: "1x Latte" },
    { folioLocal: 2, createdAt: "2026-09-16T10:00:00.000Z", total: 250, cajero: "Beto", metodos: "TARJETA", productos: "1x H & T" },
  ],
};

describe("formatearDinero", () => {
  it("siempre lleva dos decimales", () => {
    expect(formatearDinero(1234.5)).toBe("$1234.50");
    expect(formatearDinero(0)).toBe("$0.00");
  });

  it("no revienta con basura", () => {
    expect(formatearDinero(NaN as any)).toBe("$0.00");
    expect(formatearDinero(undefined as any)).toBe("$0.00");
  });
});

describe("formatearFecha", () => {
  it("usa formato día/mes/año", () => {
    expect(formatearFecha("2026-09-15T18:30:00.000Z")).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });

  it("devuelve la entrada si no es una fecha", () => {
    expect(formatearFecha("no-es-fecha")).toBe("no-es-fecha");
  });
});

describe("escaparHtml", () => {
  // "H & T" y "BnE & T" están en el menú: sin escapar, el `&` rompe el marcado del PDF.
  it("escapa el ampersand de los nombres del menú", () => {
    expect(escaparHtml("H & T")).toBe("H &amp; T");
  });

  it("escapa etiquetas y comillas", () => {
    expect(escaparHtml('<b>"x"</b>')).toBe("&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
  });
});

describe("nombreArchivo", () => {
  it("lleva sucursal y rango, para que dos reportes no se pisen", () => {
    const n = nombreArchivo(BASE, "pdf");
    expect(n).toContain("Roma-Norte");
    expect(n.endsWith(".pdf")).toBe(true);
  });

  // Android y Windows rechazan / : * ? " < > | en nombres de archivo.
  it("no deja caracteres que el sistema de archivos rechace", () => {
    const n = nombreArchivo({ ...BASE, sucursal: 'Sucursal / "Centro" : 1' }, "xlsx");
    expect(n).not.toMatch(/[/\\:*?"<>|]/);
  });

  it("aguanta una sucursal vacía", () => {
    expect(nombreArchivo({ ...BASE, sucursal: "" }, "pdf")).toContain("HANGAR421");
  });
});

describe("filasDetalle", () => {
  it("empieza por la cabecera y trae una fila por venta", () => {
    const filas = filasDetalle(BASE);
    expect(filas[0]).toEqual(["Folio", "Fecha", "Cajero", "Métodos de pago", "Productos", "Total"]);
    expect(filas).toHaveLength(3);
  });

  // El total va como número, no como "$85.00": si fuera texto, Excel no podría sumar la columna,
  // que es justo para lo que se exporta.
  it("deja los importes como número para que Excel pueda sumarlos", () => {
    const filas = filasDetalle(BASE);
    expect(typeof filas[1][5]).toBe("number");
    expect(filas[1][5]).toBe(85);
  });
});

describe("filasResumen", () => {
  it("incluye el rango y los totales", () => {
    const plano = filasResumen(BASE).flat().join("|");
    expect(plano).toContain("Roma Norte");
    expect(plano).toContain("Total vendido");
    expect(plano).toContain("Ticket promedio");
  });

  it("solo menciona el filtro de producto si se usó", () => {
    expect(filasResumen(BASE).flat()).not.toContain("Filtro de producto");
    expect(filasResumen({ ...BASE, busqueda: "latte" }).flat()).toContain("Filtro de producto");
  });

  it("dice 'Todos' cuando no se filtró por cajero", () => {
    expect(filasResumen(BASE).flat()).toContain("Todos");
    expect(filasResumen({ ...BASE, cajero: "Ana" }).flat()).toContain("Ana");
  });
});

describe("htmlReporte", () => {
  it("produce un documento completo", () => {
    const html = htmlReporte(BASE);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("mete los totales y el detalle", () => {
    const html = htmlReporte(BASE);
    expect(html).toContain("$1234.50");
    expect(html).toContain("Roma Norte");
    expect(html).toContain("#1");
  });

  it("escapa el contenido de las ventas", () => {
    expect(htmlReporte(BASE)).toContain("H &amp; T");
  });

  // Un reporte sin ventas debe decirlo, no salir con tablas vacías que parecen un fallo.
  it("explica cuando no hay datos en vez de dejar tablas vacías", () => {
    const vacio = htmlReporte({ ...BASE, porMetodo: [], topProductos: [], ventas: [], cantidadVentas: 0, totalVentas: 0 });
    expect(vacio).toContain("Sin pagos en el rango.");
    expect(vacio).toContain("Sin ventas en el rango.");
  });
});
