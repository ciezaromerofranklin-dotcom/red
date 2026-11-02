import { useState } from "react";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import Spinner from "../components/Spinner";

export default function LoginPage() {
  const { login, notice } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await login(username, password);
    } catch (err) {
      const e = err as { response?: { status?: number } };
      if (e.response?.status === 404) {
        setError("El servidor todavía no tiene el sistema de acceso: actualiza también el backend a la versión nueva.");
      } else if (!e.response) {
        setError("No hay conexión con el servidor. Revisa que el backend esté encendido.");
      } else {
        setError(apiErrorMessage(err, "No se pudo iniciar sesión."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-800">NetOps Suite</h1>
          <p className="text-xs text-slate-500">Inicia sesión para continuar</p>
        </div>
        {notice && !error && <div role="alert" className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2">{notice}</div>}
        <div>
          <label className="label" htmlFor="u">Usuario</label>
          <input id="u" className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="p">Contraseña</label>
          <input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div role="alert" className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
        <button className="btn-primary w-full" type="submit" disabled={busy || !username || !password}>
          {busy ? <><Spinner /> Entrando...</> : "Entrar"}
        </button>
      </form>
    </div>
  );
}
