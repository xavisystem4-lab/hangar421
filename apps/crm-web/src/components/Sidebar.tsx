"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { RolUsuario } from "@hangar421/shared";
import { useAuthCrm } from "@/lib/authClient";
import { useThemeStore } from "@/store/themeStore";

// `roles` refleja los mismos roles que exige el backend en cada @Roles() del controlador
// correspondiente (sucursales/inventario/usuarios/catalogo .controller.ts) — así el menú no
// muestra accesos que de todos modos el backend va a rechazar con 403.
const ITEMS: { href: string; label: string; icon: string; roles?: RolUsuario[] }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/reportes", label: "Reportes", icon: "📈", roles: ["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL", "SUPERVISOR"] as RolUsuario[] },
  { href: "/sucursales", label: "Sucursales", icon: "🏬", roles: ["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL"] as RolUsuario[] },
  { href: "/mesas", label: "Mesas", icon: "🪑", roles: ["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL"] as RolUsuario[] },
  { href: "/catalogo", label: "Catálogo", icon: "☕", roles: ["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL"] as RolUsuario[] },
  { href: "/inventario", label: "Inventario", icon: "📦", roles: ["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL", "SUPERVISOR"] as RolUsuario[] },
  { href: "/usuarios", label: "Usuarios", icon: "👥", roles: ["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL"] as RolUsuario[] },
  { href: "/plataformas", label: "Plataformas", icon: "🛵", roles: ["ADMIN_CORPORATIVO", "ADMIN_SUCURSAL"] as RolUsuario[] },
];

/** `abierto`/`onCerrar`: solo importan en celular/tablet (≤860px, ver globals.css) donde el menú
 *  se guarda fuera de pantalla y se abre con el botón ☰ de (dashboard)/layout.tsx; en escritorio
 *  el CSS lo ignora por completo y el menú se ve fijo como siempre. Se cierra solo al elegir una
 *  opción (`onCerrar` en cada Link) para no tapar la pantalla después de navegar. */
export function Sidebar({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { contexto, logout } = useAuthCrm();
  const rol = contexto?.rol as RolUsuario | undefined;
  const items = ITEMS.filter((item) => !item.roles || (rol && item.roles.includes(rol)));
  const { tema, alternar } = useThemeStore();

  return (
    <aside className="h421-sidebar" data-abierto={abierto} style={{ width: 220, background: "var(--h421-navy)", color: "#fff", display: "flex", flexDirection: "column", padding: "20px 12px" }}>
      <div style={{ padding: "0 8px 20px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="HANGAR 421" style={{ height: 24, width: "auto" }} />
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>CRM</div>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {items.map((item) => (
          <Link key={item.href} href={item.href} onClick={onCerrar}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10,
              background: pathname === item.href ? "rgba(255,255,255,0.12)" : "transparent",
            }}>
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <button
        onClick={alternar}
        title={tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "#fff", marginBottom: 8 }}
      >
        <span>{tema === "oscuro" ? "☀️" : "🌙"}</span>
        <span>{tema === "oscuro" ? "Modo claro" : "Modo oscuro"}</span>
      </button>

      <div style={{ fontSize: 13, opacity: 0.8, padding: "0 8px" }}>
        <div>{contexto?.usuario.nombre}</div>
        <button onClick={() => { logout(); router.replace("/login"); }} style={{ marginTop: 8, background: "transparent", color: "#fff", padding: 0, textDecoration: "underline" }}>
          Cerrar sesión
        </button>
      </div>

      <div style={{ padding: "16px 8px 0", marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.12)", fontSize: 11, opacity: 0.55 }}>
        <div>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0"}</div>
        <div>Desarrollado por Soft Gala</div>
      </div>
    </aside>
  );
}
