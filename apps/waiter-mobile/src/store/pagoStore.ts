import { create } from "zustand";
import type { PaymentRequestDTO } from "@hangar421/shared";
import { apiFetch } from "../api/http";

interface PagoState {
  /** Solicitud de pago con tarjeta activa para ESTE mesero — null si no hay ninguna en curso.
   *  Al asignarse, la app muestra la pantalla de cobro encima de lo que sea que el mesero esté
   *  viendo (ver App.tsx) — igual de prioritario que una llamada entrante, porque el cliente
   *  está esperando en la mesa. */
  solicitud: PaymentRequestDTO | null;
  procesando: boolean;
  error: string | null;
  setSolicitud: (s: PaymentRequestDTO | null) => void;
  iniciarCobro: () => Promise<void>;
  cancelar: () => Promise<void>;
  limpiar: () => void;
}

export const usePagoStore = create<PagoState>((set, get) => ({
  solicitud: null,
  procesando: false,
  error: null,

  setSolicitud: (s) => set({ solicitud: s, error: null }),

  iniciarCobro: async () => {
    const { solicitud } = get();
    if (!solicitud) return;
    set({ procesando: true, error: null });
    try {
      const actualizada = await apiFetch<PaymentRequestDTO>(`/pagos/solicitudes/${solicitud.id}/iniciar-cobro`, { method: "POST" });
      set({ solicitud: actualizada });
    } catch (e: any) {
      set({ error: e.message ?? "No se pudo iniciar el cobro en la terminal" });
    } finally {
      set({ procesando: false });
    }
  },

  cancelar: async () => {
    const { solicitud } = get();
    if (!solicitud) return;
    set({ procesando: true, error: null });
    try {
      await apiFetch(`/pagos/solicitudes/${solicitud.id}/cancelar`, { method: "POST" });
      set({ solicitud: null });
    } catch (e: any) {
      set({ error: e.message ?? "No se pudo cancelar" });
    } finally {
      set({ procesando: false });
    }
  },

  limpiar: () => set({ solicitud: null, error: null, procesando: false }),
}));
