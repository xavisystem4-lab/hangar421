export {};

declare global {
  interface Window {
    hangar: {
      deviceId(): Promise<string>;
      outbox: {
        encolar(item: unknown): Promise<void>;
        pendientes(limite?: number): Promise<any[]>;
        marcarSincronizado(localId: string): Promise<void>;
        marcarError(localId: string, error: string): Promise<void>;
        contarPendientes(): Promise<number>;
      };
      cache: {
        guardar(coleccion: string, id: string, data: unknown): Promise<void>;
        listar(coleccion: string): Promise<unknown[]>;
      };
      config: {
        obtener(clave: string): Promise<string | null>;
        guardar(clave: string, valor: string): Promise<void>;
      };
      appVersion(): Promise<string>;
      updater: {
        verificar(): Promise<void>;
        instalar(): Promise<void>;
        onEvento(callback: (evento: { tipo: string; data?: unknown }) => void): () => void;
      };
      backend: {
        obtenerUrl(): Promise<string | null>;
        obtenerInfoConexion(): Promise<{ ip: string | null; puerto: number | null; puertoPreferido: number | null }>;
        guardarInfoConexion(ip: string, puertoPreferido: number): Promise<void>;
        obtenerConfigNube(): Promise<{ url: string; modoActual: "cloud" | "standalone" }>;
        guardarConfigNube(url: string): Promise<void>;
        onEstado(callback: (mensaje: string) => void): () => void;
      };
      archivo: {
        guardar(opciones: { nombreSugerido: string; datosBase64: string; filtros: { name: string; extensions: string[] }[] }): Promise<{ guardado: boolean; ruta?: string }>;
      };
      abrirExterno(url: string): Promise<void>;
      impresion: {
        listar(): Promise<{ name: string; displayName: string; isDefault: boolean }[]>;
        imprimir(opciones: { html: string; impresora?: string; anchoMM: number }): Promise<{ ok: boolean; error?: string }>;
      };
    };
  }
}
