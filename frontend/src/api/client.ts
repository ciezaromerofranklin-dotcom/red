import axios from "axios";

const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export const api = axios.create({
  baseURL: API_URL ? `${API_URL}/api` : "/api",
});

export function wsUrl(path: string): string {
  const base = API_URL ? new URL(API_URL) : window.location;
  const proto = base.protocol === "https:" ? "wss" : "ws";
  const route = path.startsWith("/") ? path : `/${path}`;

  return `${proto}://${base.host}/api${route}`;
}

export type WsEvent =
  | { type: "log"; message: string }
  | { type: "done"; result: any }
  | { type: "error"; message: string };

/**
 * Abre un WebSocket, envía `params` como primer mensaje, y llama a
 * `onEvent` por cada evento recibido (log en vivo, resultado final, o
 * error). Devuelve una función para cerrar la conexión.
 */
export function runStreaming(
  path: string,
  params: unknown,
  onEvent: (ev: WsEvent) => void
): () => void {
  const ws = new WebSocket(wsUrl(path));
  ws.onopen = () => ws.send(JSON.stringify(params));
  ws.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {
      // ignore
    }
  };
  ws.onerror = () => onEvent({ type: "error", message: "Error de conexión WebSocket." });
  return () => ws.close();
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
