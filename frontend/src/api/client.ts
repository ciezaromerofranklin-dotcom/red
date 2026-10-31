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
