import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { usePersistentState } from "../store/persistentState";

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

const TITLES: Record<string, string> = {
  "/pruebas": "Pruebas",
  "/plantillas": "Plantillas",
  "/checklist": "CheckList",
  ...Object.fromEntries(FOTO_SUB.map((o) => [o.to, o.label])),
};

export default function Layout() {
  const { pathname } = useLocation();
  const inFoto = pathname.startsWith("/fotografico");
  const [fotoOpen, setFotoOpen] = useState(inFoto);
  const fotoShown = fotoOpen || inFoto;

  // Menú: en celular es un panel que se oculta al elegir una opción;
  // en pantalla grande se puede ocultar/mostrar con el botón ☰.
  const [open, setOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = usePersistentState("layout.sidebar", true);

  // Al cambiar de pantalla se cierra el panel (modo celular).
  useEffect(() => setOpen(false), [pathname]);

  // Escape cierra el panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) setDesktopOpen(!desktopOpen);
    else setOpen(!open);
  };

  const link = (isActive: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${
      isActive ? "bg-brand-600 text-white" : "hover:bg-slate-800 text-slate-300"
    }`;

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {/* Fondo oscuro detrás del panel (solo celular) */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] bg-slate-900 text-slate-300 flex flex-col
          transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:shrink-0
          ${open ? "translate-x-0" : "-translate-x-full"}
          ${desktopOpen ? "lg:translate-x-0" : "lg:hidden"}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h1 className="text-white font-bold text-lg">NetOps Suite</h1>
            <p className="text-xs text-slate-500">Panel de operaciones LAN</p>
          </div>
          <button
            className="lg:hidden rounded-md p-2 text-slate-400 hover:bg-slate-800"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => link(isActive)}>
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
              aria-expanded={fotoShown}
              onClick={() => setFotoOpen(!fotoShown)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm text-left transition-colors ${
                inFoto ? "bg-slate-800 text-white" : "hover:bg-slate-800 text-slate-300"
              }`}
            >
              <span className="text-lg">📷</span>
              <span className="flex-1">
                <span className="block font-medium">Reporte fotográfico</span>
                <span className="block text-[11px] opacity-70">4 formatos</span>
              </span>
              <span className="text-xs">{fotoShown ? "▾" : "▸"}</span>
            </button>
            {fotoShown && (
              <div className="mt-1 ml-5 space-y-1 border-l border-slate-700 pl-3">
                {FOTO_SUB.map((o) => (
                  <NavLink
                    key={o.to}
                    to={o.to}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-2.5 text-sm transition-colors ${
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
        <div className="px-5 py-3 text-[11px] text-slate-600 border-t border-slate-800">
          NetOps Suite v1.0
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior con el botón de menú */}
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
          <button
            className="rounded-lg p-2 text-xl leading-none text-slate-700 hover:bg-slate-100"
            onClick={toggle}
            aria-label="Mostrar u ocultar el menú"
          >
            ☰
          </button>
          <span className="truncate text-sm font-semibold text-slate-700">
            {TITLES[pathname] ?? "NetOps Suite"}
          </span>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-100">
          <div className="mx-auto max-w-5xl p-3 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
