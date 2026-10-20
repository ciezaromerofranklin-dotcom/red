/**
 * Ajustes de imagen por píxel (no dependen de ctx.filter, que Safari/iOS no
 * soporta). Trabajan sobre los bytes RGBA de un ImageData.
 */

export interface Adjust {
  brightness: number; // -100..100
  contrast: number;   // -100..100
  saturation: number; // -100..100
  sharpen: number;    // 0..100  (recuperar nitidez)
  auto: boolean;      // niveles + brillo automáticos
}

export const NEUTRAL: Adjust = { brightness: 0, contrast: 0, saturation: 0, sharpen: 0, auto: false };

export const isNeutral = (a: Adjust) =>
  !a.auto && !a.brightness && !a.contrast && !a.saturation && !a.sharpen;

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Niveles automáticos: estira el histograma (0,5 %–99,5 %) y aclara fotos oscuras. */
function autoLevels(d: Uint8ClampedArray): { lut: Uint8ClampedArray[] } {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const step = Math.max(1, Math.floor(d.length / 4 / 400_000)) * 4; // muestreo para fotos grandes
  let n = 0;
  for (let i = 0; i < d.length; i += step) {
    hist[0][d[i]]++;
    hist[1][d[i + 1]]++;
    hist[2][d[i + 2]]++;
    n++;
  }

  const lo = [0, 0, 0];
  const hi = [255, 255, 255];
  for (let c = 0; c < 3; c++) {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[c][v];
      if (acc >= n * 0.005) { lo[c] = v; break; }
    }
    acc = 0;
    for (let v = 255; v >= 0; v--) {
      acc += hist[c][v];
      if (acc >= n * 0.005) { hi[c] = v; break; }
    }
    if (hi[c] - lo[c] < 40) { lo[c] = 0; hi[c] = 255; } // imagen casi plana: no estirar
  }

  // Brillo medio tras estirar -> gamma para acercarlo a ~0.46
  let sum = 0;
  for (let v = 0; v < 256; v++) {
    const m = (hist[0][v] + hist[1][v] + hist[2][v]) / 3;
    sum += m * v;
  }
  const mean = sum / Math.max(1, n) / 255;
  const gamma = Math.min(1.8, Math.max(0.6, Math.log(0.46) / Math.log(Math.max(0.02, Math.min(0.98, mean)))));

  const lut = [0, 1, 2].map((c) => {
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const x = Math.min(1, Math.max(0, (v - lo[c]) / Math.max(1, hi[c] - lo[c])));
      t[v] = Math.round(Math.pow(x, gamma) * 255);
    }
    return t;
  });
  return { lut };
}

export function adjustImageData(data: Uint8ClampedArray, w: number, h: number, a: Adjust): void {
  if (isNeutral(a)) return;

  const auto = a.auto ? autoLevels(data).lut : null;

  // Brillo y contraste en una sola tabla
  const c255 = a.contrast * 2.55;
  const factor = (259 * (c255 + 255)) / (255 * (259 - c255));
  const bOff = a.brightness * 1.8;
  const bc = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) bc[v] = clamp(factor * (v - 128) + 128 + bOff);

  const sat = 1 + a.saturation / 100;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    if (auto) { r = auto[0][r]; g = auto[1][g]; b = auto[2][b]; }
    r = bc[r]; g = bc[g]; b = bc[b];
    if (sat !== 1) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = clamp(gray + (r - gray) * sat);
      g = clamp(gray + (g - gray) * sat);
      b = clamp(gray + (b - gray) * sat);
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }

  if (a.sharpen > 0 && w > 2 && h > 2) sharpen(data, w, h, (a.sharpen / 100) * 1.1);
}

/** Máscara de nitidez 3×3 (realza bordes y detalle). */
function sharpen(data: Uint8ClampedArray, w: number, h: number, amount: number): void {
  const src = new Uint8ClampedArray(data); // copia: se lee la original
  const center = 1 + 4 * amount;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v =
          src[i + c] * center -
          amount * (src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c]);
        data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
}

/** Copia de `src` con los ajustes aplicados (o la misma si no hay cambios). */
export function adjustCanvas(src: HTMLCanvasElement, a: Adjust): HTMLCanvasElement {
  if (isNeutral(a)) return src;
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  adjustImageData(img.data, out.width, out.height, a);
  ctx.putImageData(img, 0, 0);
  return out;
}
