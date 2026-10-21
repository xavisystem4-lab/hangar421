import { empleadasDeSucursal, filtrarEmpleadas, motivoNoDisponible, sucursalesDeEmpleadas, textoReinicio, type EmpleadaConCredito } from "./creditoEmpleado";

const e = (usuarioId: string, nombre: string, sucursalId: string | null, sucursalNombre: string | null): EmpleadaConCredito => ({
  usuarioId, nombre, sucursalId, sucursalNombre, limite: 500, saldo: 500, proximoReinicio: new Date(2026, 9, 9, 21, 0),
  sucursalesPermitidas: sucursalId ? [sucursalId] : [], horarios: [],
});

const lista = [
  e("1", "Diana López", "s-mec", "Mecánicos"),
  e("2", "Andrea Ruiz", "s-mec", "Mecánicos"),
  e("3", "Daniela Soto", "s-bj", "Benito Juárez"),
  e("4", "Dalia Pérez", "s-bj", "Benito Juárez"),
];

describe("filtrarEmpleadas", () => {
  it("sin texto ni sucursal devuelve todas", () => {
    expect(filtrarEmpleadas(lista, "", null)).toHaveLength(4);
  });

  it("busca por nombre sin importar mayúsculas ni acentos", () => {
    expect(filtrarEmpleadas(lista, "  DIAN ", null).map((x) => x.usuarioId)).toEqual(["1"]);
    expect(filtrarEmpleadas(lista, "perez", null).map((x) => x.usuarioId)).toEqual(["4"]);
    expect(filtrarEmpleadas(lista, "lopez", null).map((x) => x.usuarioId)).toEqual(["1"]);
  });

  it("filtra por sucursal", () => {
    expect(filtrarEmpleadas(lista, "", "s-bj").map((x) => x.usuarioId)).toEqual(["3", "4"]);
  });

  it("combina nombre y sucursal", () => {
    // "an" está en Diana, Andrea (Mecánicos) y Daniela (Benito Juárez), pero no en Dalia.
    expect(filtrarEmpleadas(lista, "an", null).map((x) => x.usuarioId)).toEqual(["1", "2", "3"]);
    expect(filtrarEmpleadas(lista, "an", "s-mec").map((x) => x.usuarioId)).toEqual(["1", "2"]);
    expect(filtrarEmpleadas(lista, "an", "s-bj").map((x) => x.usuarioId)).toEqual(["3"]);
  });
});

describe("sucursalesDeEmpleadas", () => {
  it("lista cada sucursal una vez, por nombre, ignorando empleadas sin sucursal", () => {
    expect(sucursalesDeEmpleadas([...lista, e("5", "Sin sucursal", null, null)])).toEqual([
      { id: "s-bj", nombre: "Benito Juárez" },
      { id: "s-mec", nombre: "Mecánicos" },
    ]);
  });
});

describe("textoReinicio", () => {
  it("dice el día y la hora en formato de 12 horas", () => {
    expect(textoReinicio(new Date(2026, 9, 9, 21, 0))).toBe("viernes 9:00 PM"); // viernes 9-oct-2026
    expect(textoReinicio(new Date(2026, 9, 10, 17, 0))).toBe("sábado 5:00 PM");
    expect(textoReinicio(new Date(2026, 9, 11, 0, 5))).toBe("domingo 12:05 AM");
    expect(textoReinicio(new Date(2026, 9, 12, 12, 30))).toBe("lunes 12:30 PM");
  });
});

describe("crédito solo en su sucursal y en su horario", () => {
  it("empleadasDeSucursal deja solo las de esta sucursal", () => {
    const mec = empleadasDeSucursal(lista, "s-mec");
    expect(mec.length).toBeGreaterThan(0);
    expect(mec.every((x) => x.sucursalId === null || x.sucursalesPermitidas.includes("s-mec") || x.sucursalesPermitidas.length === 0)).toBe(true);
    expect(mec.some((x) => x.sucursalId && x.sucursalId !== "s-mec")).toBe(false);
  });

  it("motivoNoDisponible: fuera de horario", () => {
    const diana = { ...e("1", "Diana", "s-mec", "Mecánicos"), horarios: [1, 2, 3, 4, 5].map((d) => ({ diaSemana: d, horaInicio: "06:00", horaFin: "15:36" })) };
    expect(motivoNoDisponible(diana, "s-mec", new Date(2026, 9, 19, 10, 0))).toBeNull();
    expect(motivoNoDisponible(diana, "s-mec", new Date(2026, 9, 19, 16, 0))).toMatch(/Fuera de su horario/);
    expect(motivoNoDisponible({ ...diana, saldo: 0 }, "s-mec", new Date(2026, 9, 19, 10, 0))).toBe("Ya usó todo su crédito");
  });
});
