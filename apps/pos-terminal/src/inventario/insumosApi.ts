import { erpFetch, obtenerTokensErp } from "../api/erpHttp";
import { abrirBaseDeDatos } from "../db/database";
import { obtenerSucursalErp } from "../db/dispositivoLocal";
import { obtenerEmpresaErp, refrescarInventario } from "../sync/pullEngine";
import { asegurarSesionEnSucursalActiva } from "../sync/terminalErp";
import type { InsumoValidado } from "./altaInsumo";

/**
 * Alta y edición de insumos desde la terminal.
 *
 * A diferencia de los movimientos (entrada, merma, conteo), el insumo es CATÁLOGO: se edita
 * centralmente y baja a todas las terminales (ver CLAUDE.md, last-write-wins para catálogo). Por
 * eso no pasa por el outbox: va directo a los mismos endpoints que usa el ERP web y necesita
 * conexión. Al terminar se vuelve a bajar el inventario para que el insumo aparezca ya en
 * Existencias y Conteo.
 */

export interface ProveedorErp {
  id: string;
  nombre: string;
}

async function contexto() {
  const db = await abrirBaseDeDatos();
  const [empresaId, sucursalId, tokens] = await Promise.all([obtenerEmpresaErp(db), obtenerSucursalErp(db), obtenerTokensErp()]);
  if (!empresaId || !sucursalId || !tokens) {
    throw new Error("Esta terminal no está conectada al ERP. Conéctala en Admin → Sincronización para dar de alta insumos.");
  }
  await asegurarSesionEnSucursalActiva();
  return { empresaId, sucursalId };
}

export async function listarProveedores(): Promise<ProveedorErp[]> {
  const { empresaId } = await contexto();
  const lista = await erpFetch<any[]>(`/proveedores?empresaId=${empresaId}`);
  return lista.filter((p) => p.activo !== false).map((p) => ({ id: p.id, nombre: p.nombre }));
}

/** El ERP aplica mínimo y máximo a TODAS las sucursales de la empresa al crear el insumo. */
export async function crearInsumo(datos: InsumoValidado): Promise<void> {
  const { empresaId } = await contexto();
  await erpFetch("/inventario/insumos", {
    method: "POST",
    body: JSON.stringify({
      empresaId,
      nombre: datos.nombre,
      unidadMedida: datos.unidadMedida,
      costoUnitario: datos.costoUnitario,
      proveedorId: datos.proveedorId ?? undefined,
      minimo: datos.minimo,
      maximo: datos.maximo,
    }),
  });
  await refrescarInventario();
}

/** Al editar, mínimo y máximo se fijan solo para la sucursal de esta terminal — cada sucursal
 *  consume a su ritmo y así lo maneja también el ERP web. */
export async function actualizarInsumo(id: string, datos: InsumoValidado): Promise<void> {
  const { sucursalId } = await contexto();
  await erpFetch(`/inventario/insumos/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      nombre: datos.nombre,
      unidadMedida: datos.unidadMedida,
      costoUnitario: datos.costoUnitario,
      proveedorId: datos.proveedorId,
    }),
  });
  if (datos.minimo !== undefined || datos.maximo !== undefined) {
    await erpFetch("/inventario/minimos", {
      method: "POST",
      body: JSON.stringify({ sucursalId, insumoId: id, minimo: datos.minimo ?? 0, maximo: datos.maximo }),
    });
  }
  await refrescarInventario();
}

/** Baja lógica (o reactivación): el ERP nunca borra el insumo, conserva su historial. */
export async function cambiarActivoInsumo(id: string, activo: boolean): Promise<void> {
  await contexto();
  await erpFetch(`/inventario/insumos/${id}`, { method: "PATCH", body: JSON.stringify({ activo }) });
  await refrescarInventario();
}
