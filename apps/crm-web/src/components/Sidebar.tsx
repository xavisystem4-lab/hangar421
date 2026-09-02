"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthCrm } from "@/lib/authClient";

const ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/sucursales", label: "Sucursales", icon: "🏬" },
  { href: "/catalogo", label: "Catálogo", icon: "☕" },
  { href: "/inventario", label: "Inventario", icon: "📦" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { contexto, logout } = useAuthCrm();

  return (
    <aside style={{ width: 220, background: "var(--h421-navy)", color: "#fff", display: "flex", flexDirection: "column", padding: "20px 12px" }}>
      <div style={{ padding: "0 8px 20px" }}>
        <strong style={{ color: "var(--h421-amber)", fontSize: 18, letterSpacing: 1 }}>HANGAR 421</strong>
        <div style={{ fontSize: 12, opacity: 0.7 }}>CRM</div>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {ITEMS.map((item) => (
          <Link key={item.href} href={item.href}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10,
              background: pathname === item.href ? "rgba(255,255,255,0.12)" : "transparent",
            }}>
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <div style={{ fontSize: 13, opacity: 0.8, padding: "0 8px" }}>
        <div>{contexto?.usuario.nombre}</div>
        <button onClick={() => { logout(); router.replace("/login"); }} style={{ marginTop: 8, background: "transparent", color: "#fff", padding: 0, textDecoration: "underline" }}>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
