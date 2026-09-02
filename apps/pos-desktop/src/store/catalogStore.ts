import { create } from "zustand";
import type { CategoriaProducto, Mesa, Producto } from "@hangar421/shared";
import { apiFetch } from "../api/http";

interface CatalogoState {
  categorias: CategoriaProducto[];
  productos: Producto[];
  mesas: Mesa[];
  cargando: boolean;
  cargar: (empresaId: string, sucursalId: string) => Promise<void>;
  refrescarMesas: (sucursalId: string) => Promise<void>;
}

export const useCatalogoStore = create<CatalogoState>((set) => ({
  categorias: [],
  productos: [],
  mesas: [],
  cargando: false,

  cargar: async (empresaId, sucursalId) => {
    set({ cargando: true });
    try {
      const [categorias, productos, mesas] = await Promise.all([
        apiFetch<CategoriaProducto[]>(`/catalogo/categorias?empresaId=${empresaId}`),
        apiFetch<Producto[]>(`/catalogo/productos?empresaId=${empresaId}&sucursalId=${sucursalId}`),
        apiFetch<Mesa[]>(`/mesas?sucursalId=${sucursalId}`),
      ]);
      set({ categorias, productos, mesas, cargando: false });
      // se cachea localmente para operar el catálogo aunque se pierda la conexión
      await Promise.all([
        ...categorias.map((c) => window.hangar.cache.guardar("categorias", c.id, c)),
        ...productos.map((p) => window.hangar.cache.guardar("productos", p.id, p)),
        ...mesas.map((m) => window.hangar.cache.guardar("mesas", m.id, m)),
      ]);
    } catch {
      // sin conexión: se recurre a la copia local guardada en la última sincronización
      const [categorias, productos, mesas] = await Promise.all([
        window.hangar.cache.listar("categorias") as Promise<CategoriaProducto[]>,
        window.hangar.cache.listar("productos") as Promise<Producto[]>,
        window.hangar.cache.listar("mesas") as Promise<Mesa[]>,
      ]);
      set({ categorias, productos, mesas, cargando: false });
    }
  },

  refrescarMesas: async (sucursalId) => {
    try {
      const mesas = await apiFetch<Mesa[]>(`/mesas?sucursalId=${sucursalId}`);
      set({ mesas });
      await Promise.all(mesas.map((m) => window.hangar.cache.guardar("mesas", m.id, m)));
    } catch {
      const mesas = (await window.hangar.cache.listar("mesas")) as Mesa[];
      set({ mesas });
    }
  },
}));
