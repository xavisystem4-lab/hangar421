import { decidirLogin } from "./pinEnLinea";

describe("decidirLogin", () => {
  it("con red manda el ERP", () => {
    expect(decidirLogin(false, "ok")).toBe("entrar-con-erp"); // PIN nuevo: entra y se guarda
    expect(decidirLogin(true, "ok")).toBe("entrar-con-erp");
    expect(decidirLogin(true, "rechazado")).toBe("pin-cambio"); // PIN viejo: ya no entra
    expect(decidirLogin(false, "rechazado")).toBe("rechazar");
  });
  it("sin red manda la copia local", () => {
    expect(decidirLogin(true, "sin-red")).toBe("entrar-local");
    expect(decidirLogin(false, "sin-red")).toBe("rechazar");
  });
});
