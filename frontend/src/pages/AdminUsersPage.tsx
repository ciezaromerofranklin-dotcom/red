import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { dateTimeLabel, shortDate } from "../utils/fechas";

interface UserRow {
  id: string; username: string; nombre: string; rol: "admin" | "user"; activo: boolean;
  expires_at: string | null; expired: boolean; daily_minutes_limit: number; minutes_today: number;
  last_login_at: string | null; last_seen_at: string | null; clients: number;
}

interface Form {
  id?: string; username: string; nombre: string; password: string; rol: "admin" | "user"; activo: boolean;
  expires_at: string; days: string; daily_minutes_limit: string;
}
const EMPTY: Form = { username: "", nombre: "", password: "", rol: "user", activo: true, expires_at: "", days: "", daily_minutes_limit: "0" };

function Status({ u }: { u: UserRow }) {
  if (!u.activo) return <span className="rounded bg-slate-200 text-slate-600 text-[11px] px-2 py-0.5">Desactivado</span>;
  if (u.expired) return <span className="rounded bg-red-100 text-red-700 text-[11px] px-2 py-0.5">Vencido</span>;
  return <span className="rounded bg-green-100 text-green-700 text-[11px] px-2 py-0.5">Activo</span>;
}

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  function load() {
    api.get("/admin/users").then((r) => { setUsers(r.data); setError(""); })
      .catch((e) => setError(apiErrorMessage(e, "No se pudo cargar la lista de usuarios.")));
  }
  useEffect(load, []);

  const edit = (u: UserRow) => {
    setFormError("");
    setForm({ id: u.id, username: u.username, nombre: u.nombre, password: "", rol: u.rol, activo: u.activo,
      expires_at: u.expires_at ?? "", days: "", daily_minutes_limit: String(u.daily_minutes_limit) });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormError("");
    try {
      if (form.id) {
        await api.put(`/admin/users/${form.id}`, {
          nombre: form.nombre, password: form.password || undefined, rol: form.rol, activo: form.activo,
          expires_at: form.expires_at || undefined, clear_expiry: !form.expires_at && !form.days,
          extend_days: form.days ? Number(form.days) : undefined,
          daily_minutes_limit: Number(form.daily_minutes_limit) || 0,
        });
      } else {
        await api.post("/admin/users", {
          username: form.username, nombre: form.nombre, password: form.password, rol: form.rol, activo: form.activo,
          expires_at: form.expires_at || undefined, days: form.days ? Number(form.days) : undefined,
          daily_minutes_limit: Number(form.daily_minutes_limit) || 0,
        });
      }
      setForm(null);
      load();
    } catch (err) { setFormError(apiErrorMessage(err, "No se pudo guardar.")); }
  }

  async function toggleActive(u: UserRow) {
    try { await api.put(`/admin/users/${u.id}`, { activo: !u.activo }); load(); }
    catch (e) { alert(apiErrorMessage(e, "No se pudo cambiar el estado.")); }
  }

  async function remove(u: UserRow) {
    if (!confirm(`¿Borrar al usuario «${u.username}»?\n\nTambién se borran sus ${u.clients} cliente(s) registrado(s) y su registro de uso. Los PDF que ya generó no se tocan.`)) return;
    try { await api.delete(`/admin/users/${u.id}`); load(); }
    catch (e) { alert(apiErrorMessage(e, "No se pudo borrar.")); }
  }

  const isNew = !!form && !form.id;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Usuarios</h2>
          <p className="text-slate-500 text-sm">Crea cuentas, ponles fecha de terminación y límite de uso diario, o desactívalas cuando quieras.</p>
        </div>
        <button className="btn-primary" onClick={() => { setFormError(""); setForm({ ...EMPTY }); }}>+ Nuevo usuario</button>
      </div>

      {error && <div role="alert" className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b bg-slate-50">
              <th className="px-4 py-2">Usuario</th><th className="px-2 py-2">Estado</th><th className="px-2 py-2">Termina</th>
              <th className="px-2 py-2">Uso hoy</th><th className="px-2 py-2">Último acceso</th><th className="px-2 py-2">Clientes</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <div className="font-medium">{u.nombre || u.username} {u.rol === "admin" && <span className="ml-1 rounded bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5">ADMIN</span>}</div>
                  <div className="text-xs text-slate-400 font-mono">{u.username}</div>
                </td>
                <td className="px-2 py-2"><Status u={u} /></td>
                <td className="px-2 py-2 whitespace-nowrap">{u.rol === "admin" ? <span className="text-slate-400">—</span> : u.expires_at ? shortDate(u.expires_at) : <span className="text-slate-400">sin fecha</span>}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {u.minutes_today} min{u.daily_minutes_limit > 0 ? <span className="text-slate-400"> / {u.daily_minutes_limit}</span> : null}
                </td>
                <td className="px-2 py-2 text-xs text-slate-500 whitespace-nowrap">{dateTimeLabel(u.last_login_at)}</td>
                <td className="px-2 py-2">
                  {u.clients > 0 ? <Link className="underline text-brand-700" to={`/admin/clientes?user=${u.id}`}>{u.clients}</Link> : 0}
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap text-xs">
                  <button className="text-slate-600 hover:text-brand-700 mr-3" onClick={() => edit(u)}>editar</button>
                  {u.id !== me?.id && (
                    <>
                      <button className="text-slate-600 hover:text-brand-700 mr-3" onClick={() => toggleActive(u)}>{u.activo ? "desactivar" : "activar"}</button>
                      <button className="text-slate-600 hover:text-red-600" onClick={() => remove(u)}>borrar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setForm(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg space-y-3 max-h-[90dvh] overflow-y-auto">
            <h3 className="font-semibold text-slate-800">{isNew ? "Nuevo usuario" : `Editar ${form.username}`}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="label">Usuario (para entrar)</label>
                <input className="input" value={form.username} disabled={!isNew} autoComplete="off" onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
              <div><label className="label">Nombre (el que verás en los reportes)</label>
                <input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
              <div><label className="label">{isNew ? "Contraseña (mínimo 6)" : "Contraseña nueva (opcional)"}</label>
                <input className="input" type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
              <div><label className="label">Rol</label>
                <select className="input" value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Form["rol"] })} disabled={!!form.id && form.id === me?.id}>
                  <option value="user">Usuario</option><option value="admin">Administrador (puede todo)</option>
                </select></div>
            </div>

            {form.rol === "user" && (
              <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                <p className="text-xs font-semibold text-slate-600">Límites de uso</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="label">Fecha de terminación</label>
                    <input className="input" type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value, days: "" })} />
                    <p className="text-[11px] text-slate-400 mt-1">Hasta ese día puede entrar. Vacío = sin vencimiento.</p></div>
                  <div><label className="label">{isNew ? "…o días de acceso desde hoy" : "Alargar el acceso (días)"}</label>
                    <input className="input" inputMode="numeric" placeholder="ej. 30" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value.replace(/\D/g, ""), ...(e.target.value ? { expires_at: isNew ? "" : form.expires_at } : {}) })} />
                    {!isNew && (
                      <div className="flex gap-1 mt-1">
                        {[7, 30, 90].map((n) => <button type="button" key={n} className="btn-secondary text-[11px] px-2 py-0.5" onClick={() => setForm({ ...form, days: String(n) })}>+{n}</button>)}
                      </div>
                    )}</div>
                  <div className="sm:col-span-2"><label className="label">Límite de uso por día (minutos, 0 = sin límite)</label>
                    <input className="input" inputMode="numeric" value={form.daily_minutes_limit} onChange={(e) => setForm({ ...form, daily_minutes_limit: e.target.value.replace(/\D/g, "") })} />
                    <p className="text-[11px] text-slate-400 mt-1">Cuenta el tiempo con la pantalla abierta. Al llegar al límite se le cierra la sesión hasta mañana.</p></div>
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.activo} disabled={!!form.id && form.id === me?.id} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Cuenta activa
            </label>
            {formError && <p role="alert" className="text-xs text-red-600">{formError}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={!form.username || (isNew && form.password.length < 6)}>{isNew ? "Crear usuario" : "Guardar cambios"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
