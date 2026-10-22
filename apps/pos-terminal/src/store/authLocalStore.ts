import { create } from "zustand";
import { abrirBaseDeDatos } from "../db/database";
import { listarUsuariosLocales, obtenerUsuarioLocal, validarPinLocal, type UsuarioLocal } from "../db/usuariosLocalesRepo";
import {
  activarSucursal,
  adoptarUsuarioErp,
  sucursalesDelUsuario,
  usuariosParaLogin,
  type SucursalTerminal,
  type UsuarioLogin,
} from "../db/multisucursalRepo";
import { obtenerSucursalErp } from "../db/dispositivoLocal";
import { ErrorErp } from "../api/erpHttp";
import { asegurarSesionEnSucursalActiva, verificarPinEnErp } from "../sync/terminalErp";
import { ESPERA_ERP_LOGIN_MS, decidirLogin, type RespuestaErpPin } from "../auth/pinEnLinea";

interface AuthLocalState {
  usuario: UsuarioLocal | null;
  usuariosDisponibles: UsuarioLogin[];
  /** Terminal multisucursal: la persona ya validó su PIN y tiene que elegir sucursal. */
  eligiendoSucursal: { usuario: UsuarioLocal; opciones: SucursalTerminal[] } | null;
  /** Sucursales entre las que puede moverse quien tiene la sesión (vacío = terminal de una
   *  sola sucursal). Alimenta "Cambiar de sucursal" en la cabecera. */
  misSucursales: SucursalTerminal[];
  cargando: boolean;
  error: string | null;
  cargarUsuarios: () => Promise<void>;
  entrar: (usuarioLocalId: string, pin: string) => Promise<void>;
  elegirSucursal: (sucursal: SucursalTerminal) => Promise<void>;
  salir: () => void;
}

/** Sesión LOCAL, sin JWT de larga duración — a propósito (ver Decisión #3 del plan): no hay un
 *  token robable que sobreviva el cierre de la app. Cada apertura pide PIN de nuevo y lo valida
 *  contra `pin_cache` (100% offline, ver validarPinLocal). El estado de sesión solo vive en
 *  memoria durante el proceso; no se persiste en AsyncStorage/SQLite.
 *
 *  Terminal multisucursal (código de empresa): tras el PIN, la persona elige entre las
 *  sucursales que tiene asignadas en el ERP, y esa elección es la sucursal de la sesión. Quien
 *  nunca entró en esta tablet valida su PIN contra el ERP la primera vez (necesita red); a
 *  partir de ahí entra sin conexión como cualquier otro. */
export const useAuthLocalStore = create<AuthLocalState>((set, get) => ({
  usuario: null,
  usuariosDisponibles: [],
  eligiendoSucursal: null,
  misSucursales: [],
  cargando: true,
  error: null,

  cargarUsuarios: async () => {
    const db = await abrirBaseDeDatos();
    const multisucursal = await usuariosParaLogin(db);
    const usuarios =
      multisucursal ?? (await listarUsuariosLocales(db)).map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol, requiereConexion: false }));
    set({ usuariosDisponibles: usuarios, cargando: false });
  },

  entrar: async (usuarioLocalId, pin) => {
    set({ error: null });
    const db = await abrirBaseDeDatos();
    const opcion = get().usuariosDisponibles.find((u) => u.id === usuarioLocalId);

    if (opcion?.requiereConexion) {
      try {
        const verificado = await verificarPinEnErp(usuarioLocalId, pin);
        await adoptarUsuarioErp(db, verificado, pin);
      } catch (e: any) {
        const mensaje =
          e instanceof ErrorErp && e.status === 409
            ? e.codigo === "USUARIO_INACTIVO_ERP"
              ? "Tu usuario está apagado en el ERP. Pide a un administrador que lo active."
              : e.codigo === "SIN_SUCURSAL_ERP"
                ? "Tu usuario no tiene esta sucursal en el ERP."
                : "Tu PIN no está en el ERP: pide a un administrador que te lo ponga en ERP → Usuarios."
            : e instanceof ErrorErp && (e.status === 401 || e.status === 403)
            ? "PIN incorrecto"
            : e instanceof ErrorErp && e.status === 429
              ? "Demasiados intentos. Espera un minuto."
              : "Es tu primera entrada en esta tablet: necesita conexión a internet para validar tu PIN.";
        set({ error: mensaje });
        throw new Error(mensaje);
      }
    } else {
      const local = await validarPinLocal(db, usuarioLocalId, pin);
      // Usuario del ERP: con red se valida también allá (un PIN cambiado en el ERP manda).
      const fila = await db.getFirstAsync<{ erp_usuario_id: string | null }>("SELECT erp_usuario_id FROM usuarios_locales WHERE id = ?", usuarioLocalId);
      let respuesta: RespuestaErpPin = "sin-red";
      let verificado: Awaited<ReturnType<typeof verificarPinEnErp>> | null = null;
      if (fila?.erp_usuario_id) {
        try {
          verificado = await Promise.race([
            verificarPinEnErp(fila.erp_usuario_id, pin),
            new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error("timeout")), ESPERA_ERP_LOGIN_MS)),
          ]);
          respuesta = "ok";
        } catch (e: any) {
          // Solo cuenta como rechazo el "PIN incorrecto" del ERP; un 401 de la sesión de la tablet
          // (token vencido) no debe dejar fuera a nadie: se sigue con la copia local.
          respuesta = e instanceof ErrorErp && e.status === 401 && /PIN incorrecto/i.test(String(e.cuerpo?.message ?? e.message)) ? "rechazado" : "sin-red";
        }
      }
      const decision = decidirLogin(local, respuesta);
      if (decision === "entrar-con-erp" && verificado) {
        try { await adoptarUsuarioErp(db, verificado, pin); } catch { /* entra igual: el ERP ya lo validó */ }
      } else if (decision === "pin-cambio") {
        set({ error: "Tu PIN cambió en el ERP: usa el nuevo." });
        throw new Error("PIN cambiado");
      } else if (decision === "rechazar") {
        set({ error: "PIN incorrecto" });
        throw new Error("PIN incorrecto");
      }
    }

    const usuario = await obtenerUsuarioLocal(db, usuarioLocalId);
    if (!usuario) {
      set({ error: "Ese usuario ya no tiene acceso en esta tablet" });
      throw new Error("Usuario sin acceso");
    }
    const opciones = await sucursalesDelUsuario(db, usuarioLocalId);
    if (opciones.length === 0) {
      // Terminal de una sola sucursal: como siempre.
      set({ usuario, misSucursales: [] });
      return;
    }
    set({ eligiendoSucursal: { usuario, opciones }, misSucursales: opciones });
    // Con una sola sucursal no hay nada que preguntar.
    if (opciones.length === 1) await get().elegirSucursal(opciones[0]);
  },

  /** Fija la sucursal de la sesión (sin red): marcador, precios y rol de esa persona ahí. La
   *  sesión de la terminal con el ERP se mueve en segundo plano cuando haya red. */
  elegirSucursal: async (sucursal) => {
    const db = await abrirBaseDeDatos();
    const base = get().eligiendoSucursal?.usuario ?? get().usuario;
    if (!base) return;
    if ((await obtenerSucursalErp(db)) !== sucursal.id) await activarSucursal(db, sucursal);
    const asignacion = await db.getFirstAsync<{ rol: string }>(
      "SELECT rol FROM usuarios_sucursales WHERE usuario_id = ? AND sucursal_id = ?",
      base.id, sucursal.id,
    );
    set({ usuario: { ...base, rol: asignacion?.rol ?? base.rol }, eligiendoSucursal: null, error: null });
    asegurarSesionEnSucursalActiva().catch(() => undefined);
  },

  salir: () => set({ usuario: null, eligiendoSucursal: null, misSucursales: [] }),
}));
