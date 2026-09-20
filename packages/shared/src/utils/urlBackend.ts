/**
 * Normaliza la URL del backend a su ORIGEN pelado (sin `/api/v1`, sin barra final).
 *
 * Existe porque este valor se configura a mano en cada despliegue y se ha escrito mal de las dos
 * formas posibles, con consecuencias distintas y difíciles de diagnosticar:
 *
 *  - **Con el sufijo de más.** Un administrador guardó la URL del POS Windows incluyendo
 *    `/api/v1`, y el cliente le volvía a pegar el mismo sufijo: `/api/v1/api/v1/...`, 404 en
 *    todas las llamadas (ver `resolverBackend` en pos-desktop/electron/main.ts).
 *  - **Sin variable para el socket.** El ERP web armaba la URL del tiempo real con su propia
 *    variable `NEXT_PUBLIC_WS_URL`. Como en Next.js las `NEXT_PUBLIC_*` se incrustan al
 *    compilar, un despliegue que definía la del API pero no la del socket compilaba una web que
 *    abría el socket contra `localhost:3000`. El REST funcionaba, la página se veía bien, y el
 *    tiempo real estaba muerto sin ningún síntoma visible.
 *
 * La segunda es la razón por la que las ventas no aparecían solas en la web. Derivando el origen
 * del API desaparece la clase entera de error: si el ERP puede hablar por REST, puede hablar por
 * socket.
 */
export function origenDeApi(urlApi: string): string {
  return urlApi
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v\d+$/i, "")
    .replace(/\/+$/, "");
}

/** La inversa: el origen más el prefijo de la API, sin duplicarlo si ya venía puesto. */
export function urlApiDesdeOrigen(origen: string, prefijo = "/api/v1"): string {
  return `${origenDeApi(origen)}${prefijo}`;
}
