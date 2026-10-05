import { useCallback, useState } from "react";
import { useAuthLocalStore } from "../store/authLocalStore";
import { ModalAutorizacion } from "../components/ModalAutorizacion";
import { GRUPOS_PERMISOS, tienePermiso, type PermisoTerminal } from "../auth/permisosTerminal";

const ETIQUETA = new Map(GRUPOS_PERMISOS.flatMap((g) => g.permisos.map((p) => [p.clave, p.etiqueta] as const)));

/**
 * Ejecuta una acción si quien tiene la sesión tiene el permiso; si no, pide antes el PIN de un
 * supervisor o administrador (decisión del negocio: quitar una función no debe parar la tienda
 * si hay un gerente cerca).
 *
 * Uso: `const { exigir, modalPermiso } = useExigirPermiso();` → `exigir(PERMISO, accion)` en el
 * onPress, y `{modalPermiso}` en el JSX de la pantalla.
 */
export function useExigirPermiso() {
  const usuario = useAuthLocalStore((s) => s.usuario);
  const [pendiente, setPendiente] = useState<{ permiso: PermisoTerminal; accion: () => void } | null>(null);

  const exigir = useCallback(
    (permiso: PermisoTerminal, accion: () => void) => {
      if (tienePermiso(usuario, permiso)) accion();
      else setPendiente({ permiso, accion });
    },
    [usuario],
  );

  const modalPermiso =
    pendiente && usuario ? (
      <ModalAutorizacion
        titulo={ETIQUETA.get(pendiente.permiso) ?? "Autorización"}
        descripcion={`${usuario.nombre} no tiene permiso para esta función en esta tablet. Hace falta el PIN de un supervisor o administrador.`}
        solicitanteId={usuario.id}
        onCancelar={() => setPendiente(null)}
        onAutorizado={() => {
          const { accion } = pendiente;
          setPendiente(null);
          accion();
        }}
      />
    ) : null;

  return { exigir, modalPermiso, puede: (permiso: PermisoTerminal) => tienePermiso(usuario, permiso) };
}
