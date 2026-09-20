import { origenDeApi, urlApiDesdeOrigen } from "./urlBackend";

describe("origenDeApi", () => {
  it("quita el prefijo de la API", () => {
    expect(origenDeApi("https://erp.ejemplo.com/api/v1")).toBe("https://erp.ejemplo.com");
  });

  it("quita también la barra final", () => {
    expect(origenDeApi("https://erp.ejemplo.com/api/v1/")).toBe("https://erp.ejemplo.com");
    expect(origenDeApi("https://erp.ejemplo.com/")).toBe("https://erp.ejemplo.com");
  });

  it("deja intacto un origen que ya venía pelado", () => {
    expect(origenDeApi("https://erp.ejemplo.com")).toBe("https://erp.ejemplo.com");
  });

  it("tolera espacios alrededor (se pega desde un campo de texto)", () => {
    expect(origenDeApi("  https://erp.ejemplo.com/api/v1  ")).toBe("https://erp.ejemplo.com");
  });

  it("acepta otras versiones de la API", () => {
    expect(origenDeApi("https://erp.ejemplo.com/api/v2")).toBe("https://erp.ejemplo.com");
  });

  it("conserva el puerto y el esquema de un backend local", () => {
    expect(origenDeApi("http://localhost:3000/api/v1")).toBe("http://localhost:3000");
  });

  it("no recorta una ruta que solo SE PARECE al prefijo", () => {
    // `/api/v1` en medio no es el sufijo: quitarlo rompería un backend servido bajo una subruta.
    expect(origenDeApi("https://ejemplo.com/api/v1/algo")).toBe("https://ejemplo.com/api/v1/algo");
  });

  it("no se come una subruta legítima que termina en algo parecido", () => {
    expect(origenDeApi("https://ejemplo.com/hangar")).toBe("https://ejemplo.com/hangar");
  });
});

describe("urlApiDesdeOrigen", () => {
  it("añade el prefijo a un origen pelado", () => {
    expect(urlApiDesdeOrigen("https://erp.ejemplo.com")).toBe("https://erp.ejemplo.com/api/v1");
  });

  it("no lo duplica si ya venía puesto — el error real de producción", () => {
    expect(urlApiDesdeOrigen("https://erp.ejemplo.com/api/v1")).toBe("https://erp.ejemplo.com/api/v1");
  });

  it("tampoco lo duplica con barra final", () => {
    expect(urlApiDesdeOrigen("https://erp.ejemplo.com/api/v1/")).toBe("https://erp.ejemplo.com/api/v1");
  });
});
