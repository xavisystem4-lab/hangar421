import { elegirProductoErp } from "../db/catalogoSyncRepo";
import { quitarTurnoDelPayload } from "../db/outboxRepo";
import { textoResumenSubida } from "./subirAlErp";

jest.mock("../db/database", () => ({ abrirBaseDeDatos: jest.fn() }));
jest.mock("../api/erpHttp", () => ({ obtenerTokensErp: jest.fn(), erpFetch: jest.fn() }));
jest.mock("./pullEngine", () => ({ refrescarCatalogo: jest.fn() }));
jest.mock("./syncEngine", () => ({ procesarCola: jest.fn() }));
jest.mock("../store/syncStatusStore", () => ({ useSyncStatusStore: { getState: () => ({}) } }));

const ERP = [
  { id: "erp-capuccino", nombre: "Capuccino", precio_base: 90 },
  { id: "erp-latte-amanecer", nombre: "Latte Amanecer", precio_base: 125 },
  { id: "erp-bagel-1", nombre: "Solo Bagel", precio_base: 45 },
  { id: "erp-bagel-2", nombre: "Solo Bagel", precio_base: 55 },
];

describe("elegirProductoErp", () => {
  it("prefiere nombre + precio exactos", () => {
    expect(elegirProductoErp({ nombre: "Latte Amanecer", precio_base: 125 }, ERP)).toBe("erp-latte-amanecer");
    expect(elegirProductoErp({ nombre: "Solo Bagel", precio_base: 55 }, ERP)).toBe("erp-bagel-2");
  });

  it("acepta solo el nombre (sin acentos ni mayúsculas) si en el ERP es único", () => {
    expect(elegirProductoErp({ nombre: "capuccíno ", precio_base: 85 }, ERP)).toBe("erp-capuccino");
  });

  it("no adivina cuando el nombre se repite con otros precios o no existe", () => {
    expect(elegirProductoErp({ nombre: "Solo Bagel", precio_base: 50 }, ERP)).toBeNull();
    expect(elegirProductoErp({ nombre: "Latte Maple y Sal", precio_base: 100 }, ERP)).toBeNull();
  });
});

describe("quitarTurnoDelPayload", () => {
  it("quita solo el turno y conserva lo demás", () => {
    expect(JSON.parse(quitarTurnoDelPayload(JSON.stringify({ turnoId: "t-1", items: [1], tipo: "MOSTRADOR" }))!)).toEqual({ items: [1], tipo: "MOSTRADOR" });
  });

  it("no toca payloads sin turno o ilegibles", () => {
    expect(quitarTurnoDelPayload(JSON.stringify({ items: [] }))).toBeNull();
    expect(quitarTurnoDelPayload("{roto")).toBeNull();
  });
});

describe("textoResumenSubida", () => {
  it("reporta subida completa", () => {
    const t = textoResumenSubida({ sinEnlace: false, enviados: 4, pendientes: 0, corregidas: 1, problemas: [], errorGeneral: null });
    expect(t.titulo).toBe("Subida completa");
    expect(t.detalle).toContain("Se subieron 4");
    expect(t.detalle).toContain("Se corrigieron 1");
  });

  it("explica lo que el ERP sigue rechazando", () => {
    const t = textoResumenSubida({
      sinEnlace: false,
      enviados: 0,
      pendientes: 2,
      corregidas: 0,
      problemas: [{ localId: "1", entidad: "PEDIDO", entidadId: "v", intentos: 3, ultimoError: "Producto inexistente", createdAt: "", folioLocal: 12 }],
      errorGeneral: null,
    });
    expect(t.titulo).toBe("No se pudo subir");
    expect(t.detalle).toContain("Venta #12: Producto inexistente");
  });

  it("avisa cuando la terminal no está enlazada", () => {
    expect(textoResumenSubida({ sinEnlace: true, enviados: 0, pendientes: 3, corregidas: 0, problemas: [], errorGeneral: null }).titulo).toBe("Terminal sin enlazar");
  });
});
