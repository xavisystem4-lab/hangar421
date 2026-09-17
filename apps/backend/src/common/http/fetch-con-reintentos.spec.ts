// Verifica el único mecanismo de timeout/reintento del repo para llamadas salientes a APIs
// externas — usado por los adaptadores de plataformas de delivery. Errores aquí significan
// colgarse indefinidamente contra una API externa lenta, o tirar la toalla ante un 5xx pasajero.

import { ErrorFetchConReintentos, fetchConReintentos } from "./fetch-con-reintentos";

function mockRespuesta(status: number, ok = status >= 200 && status < 300): Response {
  return { ok, status, text: async () => "{}" } as unknown as Response;
}

describe("fetchConReintentos", () => {
  const OPCIONES_RAPIDAS = { timeoutMs: 50, reintentos: 2, backoffBaseMs: 5 };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("devuelve la respuesta directo si el primer intento sale bien", async () => {
    const fetchMock = jest.fn().mockResolvedValue(mockRespuesta(200));
    (global as any).fetch = fetchMock;

    const res = await fetchConReintentos("https://ejemplo.test", {}, OPCIONES_RAPIDAS);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no reintenta un 4xx normal (credenciales inválidas, payload mal formado)", async () => {
    const fetchMock = jest.fn().mockResolvedValue(mockRespuesta(401));
    (global as any).fetch = fetchMock;

    const res = await fetchConReintentos("https://ejemplo.test", {}, OPCIONES_RAPIDAS);

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reintenta un 429 (rate limit) hasta agotar los intentos y devuelve la última respuesta", async () => {
    const fetchMock = jest.fn().mockResolvedValue(mockRespuesta(429, false));
    (global as any).fetch = fetchMock;

    const res = await fetchConReintentos("https://ejemplo.test", {}, OPCIONES_RAPIDAS);

    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3); // intento inicial + 2 reintentos
  });

  it("reintenta un 5xx y se recupera si un intento posterior sale bien", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(mockRespuesta(503, false))
      .mockResolvedValueOnce(mockRespuesta(200));
    (global as any).fetch = fetchMock;

    const res = await fetchConReintentos("https://ejemplo.test", {}, OPCIONES_RAPIDAS);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reintenta un error de red y lanza ErrorFetchConReintentos si nunca se recupera", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("fetch failed"));
    (global as any).fetch = fetchMock;

    await expect(fetchConReintentos("https://ejemplo.test", {}, OPCIONES_RAPIDAS)).rejects.toThrow(
      ErrorFetchConReintentos,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("respeta timeoutMs: aborta una llamada que nunca resuelve y lo cuenta como reintentable", async () => {
    const fetchMock = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    });
    (global as any).fetch = fetchMock;

    await expect(
      fetchConReintentos("https://ejemplo.test", {}, { timeoutMs: 10, reintentos: 1, backoffBaseMs: 5 }),
    ).rejects.toThrow(/tiempo de espera agotado/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
