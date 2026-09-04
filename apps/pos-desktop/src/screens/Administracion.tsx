import { useState } from "react";
import { AdminReportes } from "./admin/AdminReportes";
import { AdminInventario } from "./admin/AdminInventario";
import { AdminUsuarios } from "./admin/AdminUsuarios";
import { AdminConexion } from "./admin/AdminConexion";

type Modulo = "reportes" | "inventario" | "usuarios" | "conexion";

const MODULOS: { id: Modulo; etiqueta: string }[] = [
  { id: "reportes", etiqueta: "Reportes" },
  { id: "inventario", etiqueta: "Inventario" },
  { id: "usuarios", etiqueta: "Usuarios" },
  { id: "conexion", etiqueta: "Conexión Meseros" },
];

/** Reportes/Inventario/Usuarios, con todos sus filtros, sin salir del POS — mismos módulos
 *  que el CRM web (ver src/screens/admin/*), solo visible para roles administrativos (el botón
 *  "Administración" en BarraSuperior ya filtra por rol antes de poder llegar acá). */
export function Administracion() {
  const [modulo, setModulo] = useState<Modulo>("reportes");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 10, padding: "14px 16px", background: "var(--h421-white)", borderBottom: "1px solid var(--h421-gray-200)" }}>
        {MODULOS.map((m) => {
          const activo = modulo === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setModulo(m.id)}
              style={{
                background: activo ? "var(--h421-navy)" : "var(--h421-gray-50)",
                color: activo ? "#fff" : "var(--h421-black)",
                padding: "10px 20px",
                borderRadius: 10,
                fontSize: 14,
              }}
            >
              {m.etiqueta}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        {modulo === "reportes" && <AdminReportes />}
        {modulo === "inventario" && <AdminInventario />}
        {modulo === "usuarios" && <AdminUsuarios />}
        {modulo === "conexion" && <AdminConexion />}
      </div>
    </div>
  );
}
