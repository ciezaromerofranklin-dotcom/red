import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";

const NAV = [
  { to: "/pruebas", label: "Pruebas", icon: "🔌", desc: "SSH/Serial + PDF" },
  { to: "/plantillas", label: "Plantillas", icon: "📝", desc: "Crear y aplicar" },
  { to: "/checklist", label: "CheckList", icon: "☑️", desc: "Estilo Claro" },
];

const FOTO_SUB = [
  { to: "/fotografico/gpon-ont", label: "GPON con ONT" },
  { to: "/fotografico/gpon-modulo", label: "GPON con módulo" },
  { to: "/fotografico/fibra", label: "Fibra convencional" },
  { to: "/fotografico/poder-judicial", label: "RF Poder Judicial" },
];

export default function Layout() {
  const { pathname } = useLocation();
  const inFoto = pathname.startsWith("/fotografico");
  const [fotoOpen, setFotoOpen] = useState(inFoto);
  const open = fotoOpen || inFoto;

  return (
    <div className="flex h-screen">
      <aside className="w-60 bg-slate-900 text-slate-300 flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-slate-800">
          <h1 className="text-white font-bold text-lg">NetOps Suite</h1>
          <p className="text-xs text-slate-500">Panel de operaciones LAN</p>
        </div>
        <nav className="flex-1 py-4 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive ? "bg-brand-600 text-white" : "hover:bg-slate-800 text-slate-300"
                }`
              }
            >
              <span className="text-lg">{item.icon}</span>
              <span>
                <span className="block font-medium">{item.label}</span>
                <span className="block text-[11px] opacity-70">{item.desc}</span>
              </span>
            </NavLink>
          ))}

          <div>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setFotoOpen(!open)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-left transition-colors ${
                inFoto ? "bg-slate-800 text-white" : "hover:bg-slate-800 text-slate-300"
              }`}
            >
              <span className="text-lg">📷</span>
              <span className="flex-1">
                <span className="block font-medium">Reporte fotográfico</span>
                <span className="block text-[11px] opacity-70">4 formatos</span>
              </span>
              <span className="text-xs">{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div className="mt-1 ml-5 space-y-1 border-l border-slate-700 pl-3">
                {FOTO_SUB.map((o) => (
                  <NavLink
                    key={o.to}
                    to={o.to}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-2 text-sm transition-colors ${
                        isActive ? "bg-brand-600 text-white" : "hover:bg-slate-800 text-slate-300"
                      }`
                    }
                  >
                    {o.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        </nav>
        <div className="px-5 py-4 text-[11px] text-slate-600 border-t border-slate-800">
          NetOps Suite v1.0
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-slate-100">
        <div className="max-w-5xl mx-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
