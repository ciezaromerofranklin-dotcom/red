/**
 * Foto con sello: al tomar la foto con la cámara se le imprime una franja con
 * cliente, fecha y hora, dirección y coordenadas, para que quede como
 * evidencia dentro del PDF.
 */

export interface Place {
  lat: number;
  lng: number;
  accuracy?: number;
  address?: string[];
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

interface Addr {
  road?: string; pedestrian?: string; footway?: string;
  suburb?: string; neighbourhood?: string; city_district?: string;
  city?: string; town?: string; village?: string;
  county?: string; state?: string; state_district?: string;
}

/** Dirección en líneas cortas: calle, ciudad, provincia, región (como en el sello de ejemplo). */
async function reverseAddress(lat: number, lng: number): Promise<string[] | undefined> {
  try {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}&accept-language=es`,
      { signal: ctl.signal }
    );
    window.clearTimeout(timer);
    if (!r.ok) return undefined;
    const j = (await r.json()) as { display_name?: string; address?: Addr };
    const a = j.address;
    if (!a) return j.display_name ? [j.display_name] : undefined;

    const parts = [
      a.road || a.pedestrian || a.footway || a.neighbourhood || a.suburb,
      a.city || a.town || a.village || a.city_district,
      a.county,
      a.state || a.state_district,
    ].filter((x): x is string => !!x);
    const unique = parts.filter((x, i) => parts.indexOf(x) === i);
    return unique.length ? unique : j.display_name ? [j.display_name] : undefined;
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

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const two = (n: number) => String(n).padStart(2, "0");

/**
 * Líneas del sello, de arriba hacia abajo:
 *   19 oct 2026 16:25:49 / calle / ciudad / provincia / región / lat lng / CLIENTE
 */
export function stampLines(cliente: string, place: Place | null, when = new Date()): string[] {
  const fecha = `${when.getDate()} ${MESES[when.getMonth()]} ${when.getFullYear()}`;
  const hora = `${two(when.getHours())}:${two(when.getMinutes())}:${two(when.getSeconds())}`;

  const lines: string[] = [`${fecha} ${hora}`];
  if (place) {
    if (place.address) lines.push(...place.address);
    lines.push(`${place.lat.toFixed(7)} ${place.lng.toFixed(7)}`);
  } else {
    lines.push("Ubicación no disponible");
  }
  // El cliente respeta los saltos de línea que escribió el usuario.
  cliente
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((l) => lines.push(l.toUpperCase()));
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

  // Estilo del sello: letra cursiva blanca con sombra, pegada abajo a la derecha, sin franja.
  const size = Math.max(16, Math.round(Math.min(w, h) * 0.05));
  const lead = Math.round(size * 1.18);
  const pad = Math.round(size * 0.3);
  const family = '"Dancing Script", "Segoe Script", "Brush Script MT", cursive';
  try {
    await document.fonts.load(`600 ${size}px "Dancing Script"`);
  } catch {
    /* sin la letra descargada se usa una cursiva del sistema */
  }
  ctx.font = `600 ${size}px ${family}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";

  // Cada dato se parte en las líneas que necesite (un cliente largo ocupa 2 o más).
  const rows = lines.flatMap((l) => wrap(ctx, l, w - 2 * pad));

  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = Math.max(3, Math.round(size * 0.14));
  ctx.shadowOffsetX = Math.max(1, Math.round(size * 0.04));
  ctx.shadowOffsetY = Math.max(1, Math.round(size * 0.04));
  const baseline = h - pad - Math.round(size * 0.2);
  rows.forEach((r, i) => {
    const y = baseline - (rows.length - 1 - i) * lead;
    ctx.fillText(r, w - pad, y);
  });

  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.88));
  if (!blob) return file;

  const base = (file.name || "foto").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}
