import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import { NEUTRAL, adjustCanvas, isNeutral } from "../utils/imageAdjust";
import type { Adjust } from "../utils/imageAdjust";

interface Props {
  imageUrl: string;
  onClose: () => void;
  onSaved: (path: string, url: string) => void;
}

// ============================================================
// MODELO
// ============================================================

type Point = { x: number; y: number };
type TextBg = "none" | "dark" | "light";

type Obj =
  | { id: number; k: "line"; pts: Point[]; color: string; w: number; dashed: boolean }
  | { id: number; k: "arrow"; a: Point; b: Point; color: string; w: number }
  | { id: number; k: "rect" | "ellipse"; a: Point; b: Point; color: string; w: number }
  | { id: number; k: "blur"; a: Point; b: Point }
  | { id: number; k: "text"; p: Point; text: string; size: number; color: string; bg: TextBg; bold: boolean };

interface Doc {
  base: HTMLCanvasElement; // imagen de trabajo (nunca se modifica: cada recorte/giro crea otra)
  objects: Obj[];
}

type Tool = "select" | "path" | "line" | "arrow" | "rect" | "ellipse" | "text" | "blur" | "crop";

const MAX_WORK = 3000;     // lado máximo de la imagen guardada (suficiente para un PDF)
const MAX_PREVIEW = 1400;  // resolución de la vista en pantalla
const MAX_HISTORY = 60;

const COLORS = ["#f60707", "#ffd400", "#00c853", "#2979ff", "#ffffff", "#000000"];
const WIDTHS: [string, number][] = [["Fino", 2], ["Normal", 4], ["Grueso", 7]];
const RATIOS: [string, number | null][] = [["Libre", null], ["4:3", 4 / 3], ["3:4", 3 / 4], ["16:9", 16 / 9], ["1:1", 1]];

let nextId = 1;
const newId = () => nextId++;

/** Unidad de medida: 1 unidad = 1/800 del lado mayor (así los trazos escalan con la foto). */
const unitOf = (c: { width: number; height: number }) => Math.max(c.width, c.height) / 800;

// ============================================================
// DIBUJO
// ============================================================

function textMetrics(ctx: CanvasRenderingContext2D, o: Extract<Obj, { k: "text" }>, px: number) {
  ctx.font = `${o.bold ? "bold " : ""}${px}px Arial`;
  const lines = o.text.split("\n");
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const lead = px * 1.2;
  return { lines, w, lead, h: lead * lines.length };
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Point, b: Point, lw: number) {
  const head = Math.max(lw * 4, 12);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const shaftEnd = len > head * 0.8 ? head * 0.8 : 0;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x - Math.cos(ang) * shaftEnd, b.y - Math.sin(ang) * shaftEnd);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function pixelate(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, a: Point, b: Point, s: number) {
  const x = Math.min(a.x, b.x) * s, y = Math.min(a.y, b.y) * s;
  const w = Math.abs(b.x - a.x) * s, h = Math.abs(b.y - a.y) * s;
  if (w < 2 || h < 2) return;
  const block = Math.max(6, Math.round(Math.max(w, h) / 14));
  const tmp = document.createElement("canvas");
  tmp.width = Math.max(1, Math.round(w / block));
  tmp.height = Math.max(1, Math.round(h / block));
  const t = tmp.getContext("2d");
  if (!t) return;
  t.drawImage(src, x, y, w, h, 0, 0, tmp.width, tmp.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
  ctx.restore();
}

/** Dibuja los objetos sobre `ctx`. `s` = píxeles del lienzo por píxel de la imagen base. */
function renderObjects(
  ctx: CanvasRenderingContext2D,
  objects: Obj[],
  s: number,
  u: number,
  src: HTMLCanvasElement,
  selectedId: number | null,
) {
  for (const o of objects) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (o.k === "blur") {
      pixelate(ctx, src, o.a, o.b, s);
    } else if (o.k === "text") {
      const px = o.size * u * s;
      const m = textMetrics(ctx, o, px);
      ctx.textBaseline = "top";
      const pad = px * 0.28;
      const x = o.p.x * s, y = o.p.y * s;
      if (o.bg !== "none") {
        ctx.fillStyle = o.bg === "dark" ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.8)";
        ctx.fillRect(x - pad, y - pad, m.w + pad * 2, m.h + pad * 2 - (m.lead - px));
      }
      ctx.fillStyle = o.color;
      if (o.bg === "none") {
        // sin fondo: contorno para que se lea sobre cualquier foto
        ctx.lineWidth = Math.max(2, px * 0.12);
        ctx.strokeStyle = o.color === "#000000" ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.8)";
        m.lines.forEach((l, i) => ctx.strokeText(l, x, y + i * m.lead));
      }
      m.lines.forEach((l, i) => ctx.fillText(l, x, y + i * m.lead));
    } else {
      const lw = o.w * u * s;
      ctx.strokeStyle = o.color;
      ctx.fillStyle = o.color;
      ctx.lineWidth = lw;

      if (o.k === "line") {
        if (o.dashed) ctx.setLineDash([lw * 3, lw * 2]);
        if (o.pts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(o.pts[0].x * s, o.pts[0].y * s);
          for (const p of o.pts.slice(1)) ctx.lineTo(p.x * s, p.y * s);
          ctx.stroke();
        }
      } else if (o.k === "arrow") {
        drawArrow(ctx, { x: o.a.x * s, y: o.a.y * s }, { x: o.b.x * s, y: o.b.y * s }, lw);
      } else if (o.k === "rect") {
        ctx.strokeRect(Math.min(o.a.x, o.b.x) * s, Math.min(o.a.y, o.b.y) * s,
          Math.abs(o.b.x - o.a.x) * s, Math.abs(o.b.y - o.a.y) * s);
      } else if (o.k === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(((o.a.x + o.b.x) / 2) * s, ((o.a.y + o.b.y) / 2) * s,
          (Math.abs(o.b.x - o.a.x) / 2) * s, (Math.abs(o.b.y - o.a.y) / 2) * s, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    if (o.id === selectedId) {
      const bb = bounds(ctx, o, s, u);
      if (bb) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#2563eb";
        ctx.strokeRect(bb.x - 4, bb.y - 4, bb.w + 8, bb.h + 8);
        ctx.restore();
      }
    }
  }
}

/** Caja que ocupa un objeto, en píxeles del lienzo. */
function bounds(ctx: CanvasRenderingContext2D, o: Obj, s: number, u: number) {
  if (o.k === "text") {
    const m = textMetrics(ctx, o, o.size * u * s);
    return { x: o.p.x * s, y: o.p.y * s, w: m.w, h: m.h };
  }
  const pts = o.k === "line" ? o.pts : [o.a, o.b];
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x * s), ys = pts.map((p) => p.y * s);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ---------- selección ----------

function distToSeg(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function hit(ctx: CanvasRenderingContext2D, o: Obj, p: Point, u: number): boolean {
  const tol = 12 * u;
  switch (o.k) {
    case "line":
      return o.pts.some((q, i) => i > 0 && distToSeg(p, o.pts[i - 1], q) <= tol + o.w * u);
    case "arrow":
      return distToSeg(p, o.a, o.b) <= tol + o.w * u;
    case "rect": {
      const x1 = Math.min(o.a.x, o.b.x), x2 = Math.max(o.a.x, o.b.x);
      const y1 = Math.min(o.a.y, o.b.y), y2 = Math.max(o.a.y, o.b.y);
      const inside = p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol;
      const innerOnly = p.x > x1 + tol && p.x < x2 - tol && p.y > y1 + tol && p.y < y2 - tol;
      return inside && !innerOnly;
    }
    case "ellipse": {
      const cx = (o.a.x + o.b.x) / 2, cy = (o.a.y + o.b.y) / 2;
      const rx = Math.abs(o.b.x - o.a.x) / 2 || 1, ry = Math.abs(o.b.y - o.a.y) / 2 || 1;
      const d = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      return Math.abs(d - 1) <= (tol / Math.min(rx, ry)) + 0.05;
    }
    case "blur":
      return p.x >= Math.min(o.a.x, o.b.x) && p.x <= Math.max(o.a.x, o.b.x) &&
        p.y >= Math.min(o.a.y, o.b.y) && p.y <= Math.max(o.a.y, o.b.y);
    case "text": {
      const m = textMetrics(ctx, o, o.size * u);
      return p.x >= o.p.x - tol / 2 && p.x <= o.p.x + m.w + tol / 2 && p.y >= o.p.y - tol / 2 && p.y <= o.p.y + m.h + tol / 2;
    }
  }
}

function moveObj(o: Obj, dx: number, dy: number): Obj {
  const mv = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  switch (o.k) {
    case "line": return { ...o, pts: o.pts.map(mv) };
    case "text": return { ...o, p: mv(o.p) };
    default: return { ...o, a: mv(o.a), b: mv(o.b) };
  }
}

/** Transforma todos los puntos de un objeto (recorte y giro de la imagen). */
function mapObj(o: Obj, f: (p: Point) => Point): Obj {
  switch (o.k) {
    case "line": return { ...o, pts: o.pts.map(f) };
    case "text": return { ...o, p: f(o.p) };
    default: return { ...o, a: f(o.a), b: f(o.b) };
  }
}

// ============================================================
// IMAGEN
// ============================================================

function loadBase(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const k = Math.min(1, MAX_WORK / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      resolve(c);
    };
    img.onerror = () => reject(new Error("No se pudo cargar la imagen."));
    img.src = url;
  });
}

function rotateBase(src: HTMLCanvasElement, cw: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.height;
  c.height = src.width;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(cw ? Math.PI / 2 : -Math.PI / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

function cropBase(src: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(r.w));
  c.height = Math.max(1, Math.round(r.h));
  c.getContext("2d")!.drawImage(src, Math.round(r.x), Math.round(r.y), c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// ============================================================
// COMPONENTE
// ============================================================

export default function ImageAnnotator({ imageUrl, onClose, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [doc, setDoc] = useState<Doc | null>(null);
  const [past, setPast] = useState<Doc[]>([]);
  const [future, setFuture] = useState<Doc[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>("path");
  const [selId, setSelId] = useState<number | null>(null);

  // Estilo actual (también se aplica al objeto seleccionado)
  const [color, setColor] = useState("#f60707");
  const [textColor, setTextColor] = useState("#ffffff");
  const [width, setWidth] = useState(4);
  const [dashed, setDashed] = useState(true);
  const [textInput, setTextInput] = useState("");
  const [textSize, setTextSize] = useState(28);
  const [textBg, setTextBg] = useState<TextBg>("dark");
  const [bold, setBold] = useState(true);

  // Trazos en curso
  const [draftPts, setDraftPts] = useState<Point[]>([]);
  const [dragShape, setDragShape] = useState<{ a: Point; b: Point } | null>(null);
  const [cropRect, setCropRect] = useState<{ a: Point; b: Point } | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);

  const [adj, setAdj] = useState<Adjust>(NEUTRAL);
  const [adjusted, setAdjusted] = useState<HTMLCanvasElement | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const moving = useRef<{ id: number; last: Point; origin: Doc } | null>(null);

  // ---------- carga ----------
  useEffect(() => {
    let cancelled = false;
    loadBase(imageUrl)
      .then((base) => !cancelled && setDoc({ base, objects: [] }))
      .catch((e) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, [imageUrl]);

  const base = doc?.base ?? null;
  const objects = useMemo(() => doc?.objects ?? [], [doc]);
  const u = base ? unitOf(base) : 1;

  // Vista previa con los ajustes (a resolución de pantalla, para que sea fluida)
  const previewScale = base ? Math.min(1, MAX_PREVIEW / Math.max(base.width, base.height)) : 1;

  useEffect(() => {
    if (!base) return;
    const timer = window.setTimeout(() => {
      const pv = document.createElement("canvas");
      pv.width = Math.max(1, Math.round(base.width * previewScale));
      pv.height = Math.max(1, Math.round(base.height * previewScale));
      pv.getContext("2d")?.drawImage(base, 0, 0, pv.width, pv.height);
      setAdjusted(adjustCanvas(pv, adj));
    }, 40);
    return () => window.clearTimeout(timer);
  }, [base, adj, previewScale]);

  // ---------- historial ----------
  const commit = useCallback((next: Doc) => {
    setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), doc!]);
    setFuture([]);
    setDoc(next);
  }, [doc]);

  function undo() {
    if (!past.length || !doc) return;
    setFuture((f) => [doc, ...f]);
    setDoc(past[past.length - 1]);
    setPast(past.slice(0, -1));
    setSelId(null);
    setDraftPts([]);
  }

  function redo() {
    if (!future.length || !doc) return;
    setPast((p) => [...p, doc]);
    setDoc(future[0]);
    setFuture(future.slice(1));
    setSelId(null);
  }

  const setObjects = (objs: Obj[]) => doc && commit({ ...doc, objects: objs });
  const selected = objects.find((o) => o.id === selId) ?? null;

  // ---------- dibujo en pantalla ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !base || !adjusted) return;
    canvas.width = adjusted.width;
    canvas.height = adjusted.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(adjusted, 0, 0);
    const s = previewScale;

    const live: Obj[] = [...objects];
    if (dragShape && (tool === "arrow" || tool === "rect" || tool === "ellipse" || tool === "blur")) {
      live.push(
        tool === "blur"
          ? { id: -1, k: "blur", ...dragShape }
          : { id: -1, k: tool, ...dragShape, color, w: width }
      );
    }
    if (tool === "path" || tool === "line") {
      if (draftPts.length) live.push({ id: -2, k: "line", pts: draftPts, color, w: width, dashed: tool === "path" ? dashed : false });
    }
    renderObjects(ctx, live, s, u, adjusted, tool === "select" ? selId : null);

    // puntos de la línea en construcción
    ctx.fillStyle = color;
    for (const p of draftPts) {
      ctx.beginPath();
      ctx.arc(p.x * s, p.y * s, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // recorte: se oscurece lo que se descarta
    if (tool === "crop" && cropRect) {
      const x = Math.min(cropRect.a.x, cropRect.b.x) * s, y = Math.min(cropRect.a.y, cropRect.b.y) * s;
      const w = Math.abs(cropRect.b.x - cropRect.a.x) * s, h = Math.abs(cropRect.b.y - cropRect.a.y) * s;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, canvas.width, y);
      ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, canvas.width - x - w, h);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }
  }, [adjusted, base, objects, dragShape, draftPts, cropRect, tool, selId, color, width, dashed, previewScale, u]);

  // ---------- punteros ----------
  function toImage(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * (canvas.width / rect.width)) / previewScale,
      y: ((e.clientY - rect.top) * (canvas.height / rect.height)) / previewScale,
    };
  }

  const inBase = (p: Point): Point =>
    base ? { x: Math.max(0, Math.min(base.width, p.x)), y: Math.max(0, Math.min(base.height, p.y)) } : p;

  function constrain(a: Point, b: Point): Point {
    if (tool !== "crop" || !ratio) return b;
    const dx = b.x - a.x, dy = b.y - a.y;
    const w = Math.max(Math.abs(dx), Math.abs(dy) * ratio);
    return { x: a.x + Math.sign(dx || 1) * w, y: a.y + Math.sign(dy || 1) * (w / ratio) };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!doc || !base) return;
    const p = toImage(e);
    const ctx = canvasRef.current!.getContext("2d")!;

    if (tool === "select") {
      const found = [...objects].reverse().find((o) => hit(ctx, o, p, u)) ?? null;
      setSelId(found ? found.id : null);
      if (found) {
        moving.current = { id: found.id, last: p, origin: doc };
        e.currentTarget.setPointerCapture(e.pointerId);
        if (found.k === "text") setTextInput(found.text);
      }
      return;
    }

    if (tool === "text") {
      if (!textInput.trim()) {
        alert("Escribe un texto primero.");
        return;
      }
      const o: Obj = { id: newId(), k: "text", p: inBase(p), text: textInput.trim(), size: textSize, color: textColor, bg: textBg, bold };
      setObjects([...objects, o]);
      setSelId(o.id);
      setTool("select"); // para poder moverlo enseguida
      return;
    }

    if (tool === "path" || tool === "line") {
      setDraftPts([...draftPts, inBase(p)]);
      return;
    }

    // formas de arrastre y recorte
    e.currentTarget.setPointerCapture(e.pointerId);
    const a = inBase(p);
    if (tool === "crop") setCropRect({ a, b: a });
    else setDragShape({ a, b: a });
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!doc) return;
    const p = toImage(e);

    if (moving.current && e.buttons) {
      const m = moving.current;
      const dx = p.x - m.last.x, dy = p.y - m.last.y;
      m.last = p;
      setDoc((d) => d && { ...d, objects: d.objects.map((o) => (o.id === m.id ? moveObj(o, dx, dy) : o)) });
      return;
    }
    if (dragShape && e.buttons) setDragShape({ a: dragShape.a, b: inBase(p) });
    if (cropRect && e.buttons) setCropRect({ a: cropRect.a, b: inBase(constrain(cropRect.a, p)) });
  }

  function onPointerUp() {
    if (moving.current) {
      const origin = moving.current.origin;
      moving.current = null;
      // se guarda en el historial el estado previo al arrastre
      setPast((pp) => [...pp.slice(-(MAX_HISTORY - 1)), origin]);
      setFuture([]);
      return;
    }
    if (dragShape && doc) {
      const big = Math.hypot(dragShape.b.x - dragShape.a.x, dragShape.b.y - dragShape.a.y) > 6 * u;
      if (big && (tool === "arrow" || tool === "rect" || tool === "ellipse" || tool === "blur")) {
        const o: Obj = tool === "blur"
          ? { id: newId(), k: "blur", ...dragShape }
          : { id: newId(), k: tool, ...dragShape, color, w: width };
        setObjects([...objects, o]);
      }
      setDragShape(null);
    }
  }

  // ---------- acciones ----------
  function finishLine() {
    if (draftPts.length >= 2) {
      setObjects([...objects, { id: newId(), k: "line", pts: draftPts, color, w: width, dashed: tool === "path" ? dashed : false }]);
    }
    setDraftPts([]);
  }

  function deleteSelected() {
    if (selId == null) return;
    setObjects(objects.filter((o) => o.id !== selId));
    setSelId(null);
  }

  function clearAll() {
    if (!objects.length && !draftPts.length) return;
    setObjects([]);
    setDraftPts([]);
    setSelId(null);
  }

  function patchSelected(patch: Partial<Obj>) {
    if (selId == null) return;
    setObjects(objects.map((o) => (o.id === selId ? ({ ...o, ...patch } as Obj) : o)));
  }

  const textMode = tool === "text" || (tool === "select" && selected?.k === "text");
  const activeColor = textMode ? (selected?.k === "text" ? selected.color : textColor) : color;
  const changeColor = (c: string) => {
    if (textMode) setTextColor(c);
    else setColor(c);
    if (selected && selected.k !== "blur") patchSelected({ color: c });
  };
  const changeWidth = (w: number) => {
    setWidth(w);
    if (selected && "w" in selected) patchSelected({ w });
  };

  function rotate(cw: boolean) {
    if (!doc) return;
    const H = doc.base.height, W = doc.base.width;
    const f = cw ? (p: Point) => ({ x: H - p.y, y: p.x }) : (p: Point) => ({ x: p.y, y: W - p.x });
    commit({ base: rotateBase(doc.base, cw), objects: doc.objects.map((o) => mapObj(o, f)) });
    setCropRect(null);
    setDraftPts([]);
  }

  function applyCrop() {
    if (!doc || !cropRect) return;
    const x = Math.min(cropRect.a.x, cropRect.b.x), y = Math.min(cropRect.a.y, cropRect.b.y);
    const w = Math.abs(cropRect.b.x - cropRect.a.x), h = Math.abs(cropRect.b.y - cropRect.a.y);
    if (w < 20 || h < 20) {
      alert("Arrastra sobre la imagen para marcar la zona que quieres conservar.");
      return;
    }
    commit({
      base: cropBase(doc.base, { x, y, w, h }),
      objects: doc.objects.map((o) => mapObj(o, (p) => ({ x: p.x - Math.round(x), y: p.y - Math.round(y) }))),
    });
    setCropRect(null);
    setTool("select");
  }

  const dirty = past.length > 0 || !isNeutral(adj) || draftPts.length > 0;

  function close() {
    if (dirty && !confirm("Hay cambios sin guardar. ¿Cerrar de todos modos?")) return;
    onClose();
  }

  // ---------- guardar (a resolución completa, no la de pantalla) ----------
  async function save() {
    if (!doc) return;
    setSaving(true);
    setSaveError(null);
    try {
      let objs = doc.objects;
      if (draftPts.length >= 2) {
        objs = [...objs, { id: newId(), k: "line", pts: draftPts, color, w: width, dashed: tool === "path" ? dashed : false }];
      }

      await new Promise((r) => setTimeout(r, 30)); // deja pintar el aviso "Guardando..."

      const full = adjustCanvas(doc.base, adj);
      const out = document.createElement("canvas");
      out.width = full.width;
      out.height = full.height;
      const ctx = out.getContext("2d")!;
      ctx.drawImage(full, 0, 0);
      renderObjects(ctx, objs, 1, unitOf(out), full, null);

      const blob: Blob | null = await new Promise((res) => out.toBlob(res, "image/jpeg", 0.92));
      if (!blob) throw new Error("No se pudo crear la imagen.");

      const form = new FormData();
      form.append("file", blob, "editada.jpg");
      const { data } = await api.post("/files/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onSaved(data.path, data.url);
      onClose();
    } catch (e) {
      setSaveError(apiErrorMessage(e, "No se pudo guardar la imagen editada."));
    } finally {
      setSaving(false);
    }
  }

  // ---------- atajos de teclado ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (e.key === "Enter" && draftPts.length) finishLine();
      else if (e.key === "Escape") setDraftPts([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ============================================================
  // INTERFAZ
  // ============================================================

  const toolBtn = (t: Tool, label: string) => (
    <button
      key={t}
      type="button"
      className={`${tool === t ? "btn-primary" : "btn-secondary"} text-xs`}
      onClick={() => { setTool(t); setDraftPts([]); setDragShape(null); if (t !== "crop") setCropRect(null); if (t !== "select") setSelId(null); }}
    >
      {label}
    </button>
  );

  const showStyle = ["path", "line", "arrow", "rect", "ellipse", "text"].includes(tool) ||
    (tool === "select" && selected && selected.k !== "blur");
  const showText = tool === "text" || (tool === "select" && selected?.k === "text");
  const showWidth = tool !== "text" && !(tool === "select" && selected?.k === "text") && showStyle;
  const showDash = tool === "path" || (tool === "select" && selected?.k === "line");

  const slider = (label: string, key: keyof Omit<Adjust, "auto">, min: number) => (
    <label className="flex items-center gap-2 text-xs text-slate-600">
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="range" min={min} max={100} value={adj[key]}
        onChange={(e) => setAdj({ ...adj, [key]: Number(e.target.value) })}
        className="w-full"
      />
      <span className="w-8 text-right tabular-nums">{adj[key]}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-0 sm:p-6">
      <div className="flex h-full max-h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[95vh] sm:rounded-xl">
        {/* Cabecera */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="font-semibold text-slate-800">Editar imagen</h3>
            <p className="text-xs text-slate-500">Marca, escribe, recorta y mejora la foto.</p>
          </div>
          <button onClick={close} className="h-9 w-9 rounded-lg text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar">✕</button>
        </div>

        {/* Herramientas */}
        <div className="shrink-0 space-y-2 overflow-y-auto border-b border-slate-200 px-4 py-3" style={{ maxHeight: "38vh" }}>
          <div className="flex flex-wrap items-center gap-1.5">
            {toolBtn("select", "👆 Mover")}
            {toolBtn("path", "✏️ Recorrido")}
            {toolBtn("line", "📏 Línea")}
            {toolBtn("arrow", "↗ Flecha")}
            {toolBtn("rect", "▭ Rectángulo")}
            {toolBtn("ellipse", "◯ Círculo")}
            {toolBtn("text", "🔤 Texto")}
            {toolBtn("blur", "▦ Difuminar")}
            {toolBtn("crop", "✂️ Recortar")}
          </div>

          {showStyle && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c} type="button" aria-label={`Color ${c}`}
                    onClick={() => changeColor(c)}
                    className={`h-7 w-7 rounded-full border-2 ${activeColor === c ? "border-brand-600 ring-2 ring-brand-300" : "border-slate-300"}`}
                    style={{ background: c }}
                  />
                ))}
                <input type="color" value={activeColor} onChange={(e) => changeColor(e.target.value)} className="h-7 w-8 cursor-pointer rounded border border-slate-300 p-0" aria-label="Otro color" />
              </div>

              {showWidth && (
                <select className="input w-auto text-xs" value={width} onChange={(e) => changeWidth(Number(e.target.value))}>
                  {WIDTHS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}

              {showDash && (
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox" checked={tool === "select" && selected?.k === "line" ? selected.dashed : dashed}
                    onChange={(e) => { setDashed(e.target.checked); if (selected?.k === "line") patchSelected({ dashed: e.target.checked }); }}
                  />
                  Punteada
                </label>
              )}
            </div>
          )}

          {showText && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text" className="input min-w-[10rem] flex-1 text-sm" placeholder="Escribe el texto..."
                value={textInput}
                onChange={(e) => { setTextInput(e.target.value); if (selected?.k === "text" && e.target.value.trim()) patchSelected({ text: e.target.value }); }}
              />
              <select
                className="input w-auto text-xs" value={selected?.k === "text" ? selected.size : textSize}
                onChange={(e) => { const v = Number(e.target.value); setTextSize(v); if (selected?.k === "text") patchSelected({ size: v }); }}
              >
                {[18, 24, 28, 36, 44, 56, 72].map((v) => <option key={v} value={v}>{v} px</option>)}
              </select>
              <select
                className="input w-auto text-xs" value={selected?.k === "text" ? selected.bg : textBg}
                onChange={(e) => { const v = e.target.value as TextBg; setTextBg(v); if (selected?.k === "text") patchSelected({ bg: v }); }}
              >
                <option value="dark">Fondo oscuro</option>
                <option value="light">Fondo claro</option>
                <option value="none">Sin fondo</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={selected?.k === "text" ? selected.bold : bold}
                  onChange={(e) => { setBold(e.target.checked); if (selected?.k === "text") patchSelected({ bold: e.target.checked }); }} />
                Negrita
              </label>
              <span className="text-xs text-slate-500">
                {tool === "text" ? "Luego toca la imagen para colocarlo." : "Arrástralo para cambiarlo de lugar."}
              </span>
            </div>
          )}

          {tool === "crop" && (
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto text-xs" value={ratio ?? ""} onChange={(e) => setRatio(e.target.value ? Number(e.target.value) : null)}>
                {RATIOS.map(([l, v]) => <option key={l} value={v ?? ""}>{l}</option>)}
              </select>
              <button className="btn-primary text-xs" onClick={applyCrop} disabled={!cropRect}>✓ Aplicar recorte</button>
              <span className="text-xs text-slate-500">Arrastra sobre la imagen para elegir lo que se conserva.</span>
            </div>
          )}

          {/* Mejora de imagen */}
          <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" open>
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">🖼 Mejorar imagen</summary>
            <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {slider("Brillo", "brightness", -100)}
              {slider("Contraste", "contrast", -100)}
              {slider("Color", "saturation", -100)}
              {slider("Nitidez", "sharpen", 0)}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={`${adj.auto ? "btn-primary" : "btn-secondary"} text-xs`}
                onClick={() => setAdj({ ...adj, auto: !adj.auto })}
                title="Corrige fotos oscuras o apagadas automáticamente"
              >
                ✨ Mejora automática
              </button>
              <button className="btn-secondary text-xs" onClick={() => setAdj({ ...NEUTRAL, sharpen: 60, auto: true })} title="Mejora automática + recuperar nitidez">
                🔍 Recuperar calidad
              </button>
              <button className="btn-secondary text-xs" onClick={() => setAdj(NEUTRAL)} disabled={isNeutral(adj)}>↺ Quitar ajustes</button>
              <button className="btn-secondary text-xs" onClick={() => rotate(false)}>⟲ Girar</button>
              <button className="btn-secondary text-xs" onClick={() => rotate(true)}>⟳ Girar</button>
            </div>
          </details>
        </div>

        {/* Imagen */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-100 p-2 sm:p-3">
          {loadError ? (
            <p role="alert" className="text-sm text-red-600">{loadError}</p>
          ) : !doc ? (
            <p className="text-sm text-slate-500">Cargando imagen...</p>
          ) : (
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={() => (tool === "path" || tool === "line") && finishLine()}
              className={`block h-auto max-h-full max-w-full rounded border border-slate-300 bg-white shadow-sm ${
                tool === "select" ? "cursor-move" : "cursor-crosshair"
              }`}
              style={{ touchAction: tool === "path" || tool === "line" || tool === "text" ? "manipulation" : "none" }}
            />
          )}
        </div>

        {/* Acciones */}
        <div className="shrink-0 space-y-2 border-t border-slate-200 px-4 py-3">
          {saveError && <p role="alert" className="text-xs text-red-600">{saveError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {(tool === "path" || tool === "line") && (
              <>
                <button className="btn-secondary text-xs" onClick={finishLine} disabled={draftPts.length < 2}>✓ Terminar línea</button>
                <button className="btn-secondary text-xs" onClick={() => setDraftPts(draftPts.slice(0, -1))} disabled={!draftPts.length}>↶ Quitar punto</button>
              </>
            )}
            <button className="btn-secondary text-xs" onClick={undo} disabled={!past.length}>↶ Deshacer</button>
            <button className="btn-secondary text-xs" onClick={redo} disabled={!future.length}>↷ Rehacer</button>
            <button className="btn-secondary text-xs" onClick={deleteSelected} disabled={selId == null}>🗑 Borrar selección</button>
            <button className="btn-secondary text-xs" onClick={clearAll} disabled={!objects.length}>🧹 Limpiar marcas</button>

            <div className="flex-1" />

            <button className="btn-secondary" onClick={close} disabled={saving}>Cancelar</button>
            <button className="btn-primary" onClick={save} disabled={saving || !doc}>
              {saving ? "Guardando..." : "💾 Guardar imagen editada"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
