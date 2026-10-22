import { consultarErp, decidirLogin } from "./pinEnLinea";

describe("entrada con PIN: la copia local manda", () => {
  it("con el PIN local correcto se entra siempre, diga lo que diga el ERP", () => {
    expect(decidirLogin(true, "rechazado")).toBe("entrar-local");
    expect(decidirLogin(true, "sin-red")).toBe("entrar-local");
    expect(decidirLogin(true, "ok")).toBe("entrar-local");
  });
  it("PIN local distinto: entra solo si el ERP lo da por bueno (PIN nuevo puesto en el ERP)", () => {
    expect(decidirLogin(false, "ok")).toBe("entrar-con-erp");
    expect(decidirLogin(false, "rechazado")).toBe("rechazar");
    expect(decidirLogin(false, "sin-red")).toBe("rechazar");
  });
  it("al ERP solo se pregunta si el PIN local no coincide", () => {
    expect(consultarErp(true, true)).toBe(false);
    expect(consultarErp(false, true)).toBe(true);
    expect(consultarErp(false, false)).toBe(false);
  });
});
