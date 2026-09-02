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
    };
  }
}
