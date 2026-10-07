import { filtrarEmpleadas, sucursalesDeEmpleadas, textoReinicio, type EmpleadaConCredito } from "./creditoEmpleado";

const e = (usuarioId: string, nombre: string, sucursalId: string | null, sucursalNombre: string | null): EmpleadaConCredito => ({
  usuarioId, nombre, sucursalId, sucursalNombre, limite: 500, saldo: 500, proximoReinicio: new Date(2026, 9, 9, 21, 0),
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
