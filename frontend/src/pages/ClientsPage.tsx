import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import { MESES, MODULO_LABEL, dayLabel, parseIso, shortDate } from "../utils/fechas";

export interface ClientRec {
  id: string; user_id: string; usuario?: string; username?: string;
  sot: string; cliente: string; cid: string; fecha: string | null; fecha_texto: string;
  datos: Record<string, any>; modulos: string[]; updated_at: string | null;
}
interface YearInfo { year: number; count: number }
interface UserLite { id: string; username: string; nombre: string }

function Badges({ mods }: { mods: string[] }) {
  return <>{mods.map((m) => <span key={m} className="inline-block rounded bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 mr-1">{MODULO_LABEL[m] ?? m}</span>)}</>;
}

/**
 * Clientes registrados, agrupados por la FECHA que se escribió en cada trabajo (no la de creación).
 *  - Usuario (/mis-clientes): año → mes → día, solo los suyos.
 *  - Administrador (/admin/clientes): año → mes con el nombre de cada persona, su SOT y su cliente.
 */
export default function ClientsPage({ admin = false }: { admin?: boolean }) {
  const [params] = useSearchParams();
  const base = admin ? "/admin/clients" : "/clients";

  const [years, setYears] = useState<YearInfo[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [userId, setUserId] = useState(params.get("user") || "");
  const [q, setQ] = useState("");
  const [recs, setRecs] = useState<ClientRec[]>([]);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ClientRec | null>(null);

  const userParam = admin && userId ? { user_id: userId } : {};

  useEffect(() => {
    if (admin) api.get("/admin/users").then((r) => setUsers(r.data)).catch(() => {});
  }, [admin]);

  function loadYears() {
    return api.get(`${base}/years`, { params: userParam }).then((r) => {
      const list = r.data as YearInfo[];
      setYears(list);
      setYear((cur) => (cur !== null && list.some((y) => y.year === cur) ? cur : (list.find((y) => y.year > 0) ?? list[0])?.year ?? null));
    }).catch((e) => setError(apiErrorMessage(e, "No se pudieron cargar los años.")));
  }
  useEffect(() => { loadYears(); }, [userId]);

  function loadRecs() {
    if (year === null) { setRecs([]); return; }
    api.get(base, { params: { year, q, ...userParam } })
      .then((r) => { setRecs(r.data); setError(""); })
      .catch((e) => setError(apiErrorMessage(e, "No se pudieron cargar los clientes.")));
  }
  useEffect(() => {
    const t = window.setTimeout(loadRecs, 250);
    return () => window.clearTimeout(t);
  }, [year, q, userId]);

  // Mes (1-12; 0 = sin fecha) -> clientes
  const byMonth = useMemo(() => {
    const m = new Map<number, ClientRec[]>();
    for (const r of recs) {
      const key = parseIso(r.fecha)?.m ?? 0;
      m.set(key, [...(m.get(key) ?? []), r]);
    }
    return Array.from(m.entries()).sort((a, b) => b[0] - a[0]);
  }, [recs]);

  // Abre por defecto el mes más reciente.
  useEffect(() => {
    if (byMonth.length) setOpen((o) => (Object.keys(o).length ? o : { [byMonth[0][0]]: true }));
  }, [byMonth.length]);

  async function remove(r: ClientRec) {
    if (!confirm(`¿Borrar el cliente SOT ${r.sot}${r.cliente ? " — " + r.cliente : ""}? Esto solo borra el registro, no los PDF ya generados.`)) return;
    try { await api.delete(`/clients/${r.id}`); loadYears(); loadRecs(); }
    catch (e) { alert(apiErrorMessage(e, "No se pudo borrar.")); }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      await api.put(`/clients/${editing.id}`, { sot: editing.sot, cliente: editing.cliente, cid: editing.cid, fecha: editing.fecha_texto });
      setEditing(null); loadYears(); loadRecs();
    } catch (err) { alert(apiErrorMessage(err, "No se pudo guardar.")); }
  }

  const total = years.reduce((n, y) => n + y.count, 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">{admin ? "Clientes de todos los usuarios" : "Mis clientes"}</h2>
        <p className="text-slate-500 text-sm">
          Ordenados por la fecha que escribieron en cada trabajo. Se guardan y se actualizan solos cada vez que se genera algo con el mismo SOT.
          {" "}{total} en total.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          {years.length === 0 && <span className="text-sm text-slate-500">Todavía no hay clientes registrados. Aparecen al generar un PDF con un SOT.</span>}
          {years.map((y) => (
            <button key={y.year} onClick={() => { setYear(y.year); setOpen({}); }}
              className={`rounded-lg px-4 py-2 text-sm font-semibold border ${year === y.year ? "bg-brand-600 text-white border-brand-600" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"}`}>
              {y.year === 0 ? "Sin fecha" : y.year} <span className="opacity-70 font-normal">({y.count})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <input className="input flex-1 min-w-[200px]" placeholder="Buscar por SOT, cliente o CID..." value={q} onChange={(e) => setQ(e.target.value)} />
          {admin && (
            <select className="input w-56" value={userId} onChange={(e) => { setUserId(e.target.value); setOpen({}); }}>
              <option value="">Todos los usuarios</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.nombre || u.username}</option>)}
            </select>
          )}
        </div>
      </div>

      {error && <div role="alert" className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {byMonth.map(([m, list]) => (
        <div key={m} className="card p-0 overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 text-left"
            onClick={() => setOpen((o) => ({ ...o, [m]: !o[m] }))}>
            <span className="font-semibold text-slate-800">{m === 0 ? "Sin fecha válida" : `${MESES[m - 1]} ${year}`}</span>
            <span className="text-sm text-slate-500">{list.length} cliente{list.length === 1 ? "" : "s"} {open[m] ? "▾" : "▸"}</span>
          </button>
          {open[m] && (admin ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500 border-b">
                <th className="px-4 py-2">Fecha</th><th className="px-2 py-2">Usuario</th><th className="px-2 py-2">SOT</th><th className="px-2 py-2">Cliente</th><th className="px-2 py-2 hidden md:table-cell">Pantallas</th><th></th>
              </tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2 whitespace-nowrap">{shortDate(r.fecha)}</td>
                    <td className="px-2 py-2 font-medium">{r.usuario}</td>
                    <td className="px-2 py-2 font-mono">{r.sot}</td>
                    <td className="px-2 py-2">{r.cliente || <span className="text-slate-400">—</span>}</td>
                    <td className="px-2 py-2 hidden md:table-cell"><Badges mods={r.modulos} /></td>
                    <td className="px-2 py-2 text-right">
                      <button className="text-xs text-slate-500 hover:text-red-600" onClick={() => remove(r)}>borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div>
              {Array.from(new Set(list.map((r) => r.fecha ?? ""))).map((day) => (
                <div key={day}>
                  <div className="px-4 py-1.5 text-xs font-semibold text-slate-500 bg-white border-y first-letter:uppercase">{day ? dayLabel(day) : "Sin fecha válida"}</div>
                  {list.filter((r) => (r.fecha ?? "") === day).map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b last:border-0 hover:bg-slate-50 text-sm">
                      <span className="font-mono font-semibold w-24">{r.sot}</span>
                      <span className="flex-1 min-w-[160px]">{r.cliente || <span className="text-slate-400">sin nombre</span>}{r.cid ? <span className="text-slate-400"> · CID {r.cid}</span> : null}</span>
                      <span><Badges mods={r.modulos} /></span>
                      <span className="text-xs">
                        <button className="text-slate-500 hover:text-brand-700 mr-3" onClick={() => setEditing({ ...r })}>editar</button>
                        <button className="text-slate-500 hover:text-red-600" onClick={() => remove(r)}>borrar</button>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <form onSubmit={saveEdit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-md space-y-3">
            <h3 className="font-semibold text-slate-800">Editar cliente</h3>
            <div><label className="label">SOT</label><input className="input" value={editing.sot} onChange={(e) => setEditing({ ...editing, sot: e.target.value })} /></div>
            <div><label className="label">Cliente</label><input className="input" value={editing.cliente} onChange={(e) => setEditing({ ...editing, cliente: e.target.value })} /></div>
            <div><label className="label">CID</label><input className="input" value={editing.cid} onChange={(e) => setEditing({ ...editing, cid: e.target.value })} /></div>
            <div><label className="label">Fecha (como la escribes en los trabajos)</label><input className="input" value={editing.fecha_texto} onChange={(e) => setEditing({ ...editing, fecha_texto: e.target.value })} placeholder="ej. 29 de Agosto de 2026" /></div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button type="submit" className="btn-primary">Guardar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
