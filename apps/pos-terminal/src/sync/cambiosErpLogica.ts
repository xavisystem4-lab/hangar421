/**
 * Cambios del ERP al instante — lógica pura (sin red ni base), probada en cambiosErp.spec.ts.
 * El ERP mueve una marca por empresa cada vez que alguien cambia catálogo, precios, recetas,
 * insumos, crédito o usuarios (MarcaCambioErp); la tablet la compara con su última descarga.
 */
export interface MarcaErp {
  version: string | null;
  que: string | null;
  dispositivoId: string | null;
}

/** ¿Hay un cambio en el ERP que esta tablet todavía no bajó? */
export function hayCambioNuevo(marca: MarcaErp | null, aplicada: string | null, miDispositivoId: string | null): boolean {
  if (!marca?.version || !aplicada) return false;
  if (new Date(marca.version).getTime() <= new Date(aplicada).getTime()) return false;
  // El cambio lo hizo esta misma tablet: ya lo tiene.
  if (marca.dispositivoId && miDispositivoId && marca.dispositivoId === miDispositivoId) return false;
  return true;
}
