/** Tope para una descarga completa de un módulo. Si una petición se queda colgada, el candado se
 *  libera igual: antes la tablet ya no volvía a bajar nada hasta reiniciar la app. */
export const LIMITE_DESCARGA_MS = 120_000;

/** La promesa, o un error claro si tarda más de `ms`. Pura; probada en conLimite.spec.ts. */
export function conLimite<T>(promesa: Promise<T>, ms: number, que: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    timer = setTimeout(() => rechazar(new Error(`${que}: tardó más de ${Math.round(ms / 1000)} s, se reintentará`)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
}
