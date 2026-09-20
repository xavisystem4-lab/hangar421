"use client";

import { useEffect, useState } from "react";
import { useAuthCrm } from "@/lib/authClient";
import { opcionesDisponibles, useSucursalActiva, type SeleccionSucursal } from "@/store/sucursalActiva";
import { RolUsuario } from "@hangar421/shared";

/**
 * Pregunta con qué sucursal se va a trabajar. Bloqueante: hasta elegir no se ve ningún dato.
 *
 * Es deliberado que no haya opción por defecto ni "recordar y no preguntar". En un ERP
 * multisucursal, mirar las ventas de Condesa creyendo que son las de Mecánicos es un error caro
 * y silencioso; obligar a una elección consciente al entrar lo evita. Después persiste al
 * navegar y al recargar, y se ve siempre en la cabecera.
 */
export function SelectorSucursal({ onCerrar }: { onCerrar?: () => void }) {
  const { contexto } = useAuthCrm();
  const { elegir, cambiando, error, seleccion, opciones: accesos, cargandoOpciones, refrescarOpciones } = useSucursalActiva();
  const [eligiendo, setEligiendo] = useState<string | null>(null);

  // Se refresca cada vez que se abre el diálogo: una sucursal dada de alta hace un momento debe
  // poder elegirse aquí sin cerrar sesión.
  useEffect(() => {
    refrescarOpciones();
  }, [refrescarOpciones]);

  if (!contexto) return null;
  // Mientras llega la lista del backend se usa la del login como respaldo, para que el diálogo
  // no aparezca vacío un instante al abrirlo.
  const opciones = opcionesDisponibles(accesos ?? contexto.usuario.sucursales ?? [], contexto.rol);
  const esCorporativo = contexto.rol === RolUsuario.ADMIN_CORPORATIVO;

  async function seleccionar(opcion: SeleccionSucursal) {
    setEligiendo(opcion.sucursalId ?? "todas");
    try {
      await elegir(opcion, esCorporativo);
      onCerrar?.();
    } catch {
      // El error ya quedó en el store; se muestra abajo sin cerrar el diálogo.
    } finally {
      setEligiendo(null);
    }
  }

  return (
    <div style={fondo}>
      <div style={tarjeta}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>¿Con qué sucursal quieres trabajar?</h2>
        <p style={{ color: "var(--h421-gray-400)", fontSize: 13, margin: "0 0 18px" }}>
          Todo lo que veas —ventas, tickets, inventario y reportes— será de la sucursal que elijas.
          Puedes cambiarla luego desde la cabecera.
        </p>

        {opciones.length === 0 && cargandoOpciones ? (
          <p style={{ color: "var(--h421-gray-400)", fontSize: 14 }}>Cargando sucursales…</p>
        ) : opciones.length === 0 ? (
          <p style={{ color: "var(--h421-red)", fontSize: 14 }}>
            Tu usuario no tiene ninguna sucursal asignada. Pídele a un administrador que te dé acceso.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {opciones.map((o) => {
              const activa = seleccion?.sucursalId === o.sucursalId;
              const cargandoEsta = eligiendo === (o.sucursalId ?? "todas");
              return (
                <button
                  key={o.sucursalId ?? "todas"}
                  onClick={() => seleccionar(o)}
                  disabled={cambiando}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "16px 18px", borderRadius: 12, fontSize: 16, fontWeight: 700,
                    textAlign: "left", cursor: cambiando ? "wait" : "pointer",
                    background: activa ? "var(--h421-navy)" : "var(--h421-gray-50)",
                    color: activa ? "#fff" : "var(--h421-black)",
                    border: "1px solid var(--h421-gray-200)",
                    opacity: cambiando && !cargandoEsta ? 0.5 : 1,
                  }}
                >
                  <span>
                    {o.sucursalId === null ? "🏢 " : "🏪 "}{o.nombre}
                    {o.sucursalId === null && (
                      <span style={{ display: "block", fontSize: 12, fontWeight: 400, opacity: 0.75, marginTop: 2 }}>
                        Consolidado — solo consulta
                      </span>
                    )}
                  </span>
                  <span>{cargandoEsta ? "…" : activa ? "✓" : "›"}</span>
                </button>
              );
            })}
          </div>
        )}

        {error && <p style={{ color: "var(--h421-red)", fontSize: 13, marginTop: 14 }}>{error}</p>}

        {/* Solo se puede cerrar sin elegir si YA había una elección previa: al entrar por primera
            vez la selección es obligatoria. */}
        {onCerrar && seleccion && (
          <button onClick={onCerrar} style={{ marginTop: 16, width: "100%", padding: 12, background: "var(--h421-gray-200)" }}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

/** Indicador de la cabecera: qué sucursal está activa, y cómo cambiarla. */
export function ChipSucursalActiva({ onCambiar }: { onCambiar: () => void }) {
  const { seleccion } = useSucursalActiva();
  if (!seleccion) return null;

  return (
    <button
      onClick={onCambiar}
      title="Cambiar de sucursal"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px",
        borderRadius: 10, background: "var(--h421-gray-50)", border: "1px solid var(--h421-gray-200)",
        fontWeight: 700, fontSize: 14, cursor: "pointer",
      }}
    >
      {seleccion.sucursalId === null ? "🏢" : "🏪"} {seleccion.nombre}
      <span style={{ color: "var(--h421-gray-400)", fontWeight: 400 }}>▾</span>
    </button>
  );
}

const fondo: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(11,30,51,0.75)", zIndex: 100,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
};
const tarjeta: React.CSSProperties = {
  background: "var(--h421-white)", borderRadius: 16, padding: 28,
  width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto",
};
