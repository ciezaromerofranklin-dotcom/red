import axios from "axios";

const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export const api = axios.create({
  baseURL: API_URL ? `${API_URL}/api` : "/api",
});

// ---------------------------------------------------------------------------
// Sesión: el token se guarda en el navegador y se envía en cada petición.
// ---------------------------------------------------------------------------
const TOKEN_KEY = "netops.token";
export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

/** Evento que se dispara cuando el servidor dice que la sesión ya no vale (venció, cuenta desactivada, límite diario...). */
export const UNAUTHORIZED_EVENT = "netops:unauthorized";

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.set("Authorization", `Bearer ${t}`);
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const isLogin = String(err?.config?.url || "").includes("/auth/login");
    if (status === 401 && !isLogin && getToken()) {
      setToken(null);
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: err.response?.data?.detail || "Tu sesión terminó." }));
    }
    return Promise.reject(err);
  }
);

/** Para enlaces y <a href> que el navegador abre solo (descargas de PDF): agrega el token a la URL. */
export function authUrl(url: string): string {
  const t = getToken();
  if (!t || !url) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(t);
}

export function wsUrl(path: string): string {
  const base = API_URL ? new URL(API_URL) : window.location;
  const proto = base.protocol === "https:" ? "wss" : "ws";
  const route = path.startsWith("/") ? path : `/${path}`;
  const t = getToken();

  return `${proto}://${base.host}/api${route}${t ? `?token=${encodeURIComponent(t)}` : ""}`;
}

export type WsEvent =
  | { type: "log"; message: string }
  | { type: "done"; result: any }
  | { type: "error"; message: string };

/**
 * Abre un WebSocket, envía `params` como primer mensaje, y llama a
 * `onEvent` por cada evento recibido (log en vivo, resultado final, o
 * error). Devuelve una función para CANCELAR: avisa al servidor con "stop"
 * (para que detenga el tráfico/la prueba en curso y devuelva lo medido hasta ahí).
 *
 * Si la conexión se corta antes de recibir "done" o "error" (servidor caído,
 * proxy que cierra conexiones inactivas, etc.) se emite un error: antes la
 * pantalla se quedaba en "Ejecutando..." para siempre.
 */
export function runStreaming(
  path: string,
  params: unknown,
  onEvent: (ev: WsEvent) => void
): () => void {
  let finished = false;
  const emit = (ev: WsEvent) => {
    if (finished) return;
    if (ev.type === "done" || ev.type === "error") finished = true;
    onEvent(ev);
  };

  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(path));
  } catch {
    emit({ type: "error", message: "No se pudo abrir la conexión con el servidor." });
    return () => {};
  }
  ws.onopen = () => ws.send(JSON.stringify(params));
  ws.onmessage = (ev) => {
    try {
      emit(JSON.parse(ev.data));
    } catch {
      // ignore
    }
  };
  ws.onerror = () => emit({
    type: "error",
    message: "No hay conexión con el servidor (¿está corriendo el backend? ¿la dirección es correcta?).",
  });
  ws.onclose = () => emit({
    type: "error",
    message: "Se perdió la conexión con el servidor antes de terminar.",
  });
  return () => {
    // El servidor responde con el resultado parcial ("done") y cierra; si no
    // contesta en 15 s se cierra a la fuerza (onclose emite el error).
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send("stop");
    } catch {
      // ignore
    }
    setTimeout(() => { if (!finished) ws.close(); }, 15000);
  };
}

/** Extrae un mensaje legible de un error de axios / FastAPI. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const err = e as {
    response?: { data?: { detail?: unknown } };
    message?: string;
  };

  const detail = err?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;

  if (Array.isArray(detail)) {
    const msgs = detail.map((d) =>
      d && typeof d === "object" && "msg" in d
        ? String((d as { msg: unknown }).msg)
        : String(d)
    );
    if (msgs.length) return msgs.join("; ");
  }

  return err?.message ? `${fallback} (${err.message})` : fallback;
}
