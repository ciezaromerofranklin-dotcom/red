import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { UNAUTHORIZED_EVENT, api, getToken, setToken } from "../api/client";

export interface AuthUser {
  id: string;
  username: string;
  nombre: string;
  rol: "admin" | "user";
  expires_at: string | null;
  daily_minutes_limit: number;
  minutes_today: number;
}

interface Ctx {
  user: AuthUser | null;
  loading: boolean;
  /** Mensaje para mostrar en la pantalla de acceso (p. ej. «Tu acceso terminó el ...»). */
  notice: string;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(!!getToken());
  const [notice, setNotice] = useState("");

  // Al abrir la página: si hay una sesión guardada, se comprueba con el servidor.
  useEffect(() => {
    if (!getToken()) return;
    api.get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  // El servidor avisó que la sesión ya no sirve.
  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      setUser(null);
      setNotice(String((e as CustomEvent).detail || "Tu sesión terminó."));
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  // «Latido»: mientras la pantalla está abierta y visible, avisa cada minuto para sumar el tiempo de uso.
  useEffect(() => {
    if (!user) return;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      api.post("/auth/heartbeat").then((r) => setUser((u) => (u ? { ...u, ...r.data } : u))).catch(() => {});
    };
    const id = window.setInterval(beat, 60_000);
    return () => window.clearInterval(id);
  }, [user?.id]);

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post("/auth/login", { username, password });
    setToken(data.token);
    setNotice("");
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setNotice("");
  }, []);

  const value = useMemo<Ctx>(
    () => ({ user, loading, notice, isAdmin: user?.rol === "admin", login, logout }),
    [user, loading, notice, login, logout]
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return c;
}
