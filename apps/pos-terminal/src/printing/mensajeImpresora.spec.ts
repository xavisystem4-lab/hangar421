jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }), { virtual: true });
import { mensajeImpresora } from "../../modules/hangar-usb-printer";

describe("mensajeImpresora", () => {
  it("deja solo el motivo del error nativo de Expo", () => {
    expect(
      mensajeImpresora(new Error("Call to function 'HangarUsbPrinter.imprimirPrueba' has been rejected.\n→ Caused by: No hay impresora USB conectada. Revisa el cable OTG y que esté encendida.")),
    ).toBe("No hay impresora USB conectada. Revisa el cable OTG y que esté encendida.");
  });

  it("no toca mensajes que ya vienen limpios", () => {
    expect(mensajeImpresora(new Error("Permiso USB denegado"))).toBe("Permiso USB denegado");
  });
});
