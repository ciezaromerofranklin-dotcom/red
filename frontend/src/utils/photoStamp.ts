/**
 * Foto con sello: al tomar la foto con la cámara se le imprime una franja con
 * cliente, fecha y hora, dirección y coordenadas, para que quede como
 * evidencia dentro del PDF.
 */

export interface Place {
  lat: number;
  lng: number;
  accuracy?: number;
  address?: string;
}

let lastPlace: { at: number; place: Place } | null = null;
const CACHE_MS = 60_000;

function position(timeoutMs: number): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
    );
  });
}

async function reverseAddress(lat: number, lng: number): Promise<string | undefined> {
  try {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=es`,
      { signal: ctl.signal }
    );
    window.clearTimeout(timer);
    if (!r.ok) return undefined;
    const j = (await r.json()) as { display_name?: string };
    return j.display_name || undefined;
  } catch {
    return undefined; // sin internet o servicio caído: se sella solo con coordenadas
  }
}

/** Ubicación actual (con dirección si se puede). null si no hay permiso o señal. */
export async function getPlace(): Promise<Place | null> {
  if (lastPlace && Date.now() - lastPlace.at < CACHE_MS) return lastPlace.place;

  const pos = await position(8000);
  if (!pos) return null;

  const place: Place = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
  };
  place.address = await reverseAddress(place.lat, place.lng);
  lastPlace = { at: Date.now(), place };
  return place;
}

export function stampLines(cliente: string, place: Place | null, when = new Date()): string[] {
  const fecha = when.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = when.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  const lines: string[] = [];
  if (cliente.trim()) lines.push(`Cliente: ${cliente.trim()}`);
  lines.push(`Fecha: ${fecha}   Hora: ${hora}`);
  if (place) {
    if (place.address) lines.push(`Dirección: ${place.address}`);
    lines.push(`Coordenadas: ${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`);
  } else {
    lines.push("Ubicación no disponible");
  }
  return lines;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la foto."));
    };
    img.src = url;
  });
}

/** Devuelve una copia JPEG de la foto con la franja de datos al pie. */
export async function stampImage(file: File, lines: string[]): Promise<File> {
  const img = await loadImage(file);

  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);

  const size = Math.max(13, Math.round(Math.min(w, h) * 0.028));
  const lead = Math.round(size * 1.3);
  const pad = Math.round(size * 0.6);
  ctx.font = `600 ${size}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = "top";

  // Cada dato se parte en las líneas que necesite (el cliente largo ocupa 2).
  const rows = lines.flatMap((l) => wrap(ctx, l, w - 2 * pad));
  const bandH = rows.length * lead + 2 * pad - (lead - size);

  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(0, h - bandH, w, bandH);

  ctx.fillStyle = "#fff";
  rows.forEach((r, i) => ctx.fillText(r, pad, h - bandH + pad + i * lead));

  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.88));
  if (!blob) return file;

  const base = (file.name || "foto").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}
