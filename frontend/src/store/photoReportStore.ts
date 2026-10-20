/**
 * photoReportStore.ts
 *
 * Estado del reporte fotográfico FUERA de los componentes de React.
 *
 * Por qué: antes el estado vivía dentro de <RunTab>, que React destruye al
 * cambiar de pestaña ("Descripciones") o de página, y se perdía todo. Aquí
 * vive a nivel de módulo (sobrevive a esos cambios) y además se guarda en
 * localStorage, así también sobrevive a recargar la página o cerrar el
 * navegador.
 */

import { useSyncExternalStore } from "react";
import { api, apiErrorMessage } from "../api/client";
import { NO_LOGO, logoPayload } from "../logo";
import type { LogoSel } from "../logo";
import type { PhotoItem } from "../types";

export { apiErrorMessage };
export { NO_LOGO };
export type { LogoSel };

// ============================================================
// TIPOS
// ============================================================

export type Lado = "site" | "pdi" | "pop" | "cliente";
export const LADOS: Lado[] = ["site", "pdi", "pop", "cliente"];

export interface RowState {
  incluir: boolean;
  /** Solo si el usuario editó el texto; si no, se usa el nombre del ítem. */
  descripcion?: string;
  imagePath: string;
  imageUrl: string;
  lado: Lado;
}

export const DEFAULT_ROW: RowState = {
  incluir: false,
  imagePath: "",
  imageUrl: "",
  lado: "cliente",
};

export interface ReportFields {
  titulo: string;
  proy: string;
  cliente: string;
  sot: string;
  fecha: string;
  cid: string;
  contrata: string;
  logoIzq: LogoSel;
  logoDer: LogoSel;
  /** Estado por ítem, indexado por el id del ítem. */
  rows: Record<string, RowState>;
}

export interface GenResult {
  url: string;
  filename: string;
  pages: number;
  warnings: string[];
}

export interface PhotoReportState extends ReportFields {
  generating: boolean;
  result: GenResult | null;
  error: string | null;
}

// ============================================================
// CARGA / GUARDADO (localStorage)
// ============================================================

const STORAGE_KEY = "netops.fotografico.v1";
const DEFAULT_TITULO = "REPORTE FOTOGRAFICO INSTALACION DE FIBRA";

function todayPE(): string {
  return new Date().toLocaleDateString("es-PE");
}

function freshFields(): ReportFields {
  return {
    titulo: DEFAULT_TITULO,
    proy: "",
    cliente: "",
    sot: "",
    fecha: todayPE(),
    cid: "",
    contrata: "",
    logoIzq: NO_LOGO,
    logoDer: NO_LOGO,
    rows: {},
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function loadLogo(v: unknown): LogoSel {
  if (!v || typeof v !== "object") return NO_LOGO;
  const x = v as Record<string, unknown>;
  return {
    id: typeof x.id === "string" && x.id ? x.id : null,
    path: str(x.path, ""),
    url: str(x.url, ""),
  };
}

function loadRows(v: unknown): Record<string, RowState> {
  const out: Record<string, RowState> = {};
  if (!v || typeof v !== "object") return out;

  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const x = raw as Record<string, unknown>;
    out[id] = {
      incluir: x.incluir === true,
      descripcion: typeof x.descripcion === "string" ? x.descripcion : undefined,
      imagePath: str(x.imagePath, ""),
      imageUrl: str(x.imageUrl, ""),
      lado: LADOS.includes(x.lado as Lado) ? (x.lado as Lado) : "cliente",
    };
  }
  return out;
}

function loadFields(): ReportFields {
  const base = freshFields();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;

    const x = JSON.parse(raw) as Record<string, unknown>;
    return {
      titulo: str(x.titulo, base.titulo),
      proy: str(x.proy, ""),
      cliente: str(x.cliente, ""),
      sot: str(x.sot, ""),
      // Si la fecha guardada es la del día en que se guardó (no la cambió el
      // usuario), se usa la de hoy en vez de quedarse con un día anterior.
      fecha:
        x.fecha === x.savedOn ? base.fecha : str(x.fecha, base.fecha),
      cid: str(x.cid, ""),
      contrata: str(x.contrata, ""),
      logoIzq: loadLogo(x.logoIzq),
      logoDer: loadLogo(x.logoDer),
      rows: loadRows(x.rows),
    };
  } catch {
    return base; // JSON dañado o localStorage no disponible
  }
}

function persist(): void {
  try {
    const fields: ReportFields = {
      titulo: state.titulo,
      proy: state.proy,
      cliente: state.cliente,
      sot: state.sot,
      fecha: state.fecha,
      cid: state.cid,
      contrata: state.contrata,
      logoIzq: state.logoIzq,
      logoDer: state.logoDer,
      rows: state.rows,
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...fields, savedOn: todayPE() })
    );
  } catch {
    // sin espacio / modo privado: se sigue funcionando en memoria
  }
}

let saveTimer: number | undefined;

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 250);
}

// ============================================================
// STORE
// ============================================================

let state: PhotoReportState = {
  ...loadFields(),
  generating: false,
  result: null,
  error: null,
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PhotoReportState {
  return state;
}

function setState(patch: Partial<PhotoReportState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  scheduleSave();
}

if (typeof window !== "undefined") {
  // Guarda lo pendiente si el usuario cierra o recarga la pestaña.
  window.addEventListener("pagehide", persist);
}

export function usePhotoReport(): PhotoReportState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================
// ACCIONES
// ============================================================

export function setField<K extends keyof ReportFields>(
  key: K,
  value: ReportFields[K]
): void {
  setState({ [key]: value } as Partial<PhotoReportState>);
}

export function getRow(rows: Record<string, RowState>, id: string): RowState {
  return rows[id] ?? DEFAULT_ROW;
}

export function updateRow(id: string, patch: Partial<RowState>): void {
  setState({
    rows: { ...state.rows, [id]: { ...getRow(state.rows, id), ...patch } },
  });
}

export function setIncluir(ids: string[], value: boolean): void {
  const rows = { ...state.rows };
  for (const id of ids) {
    rows[id] = { ...getRow(rows, id), incluir: value };
  }
  setState({ rows });
}

/** Descarta el estado de ítems que ya no existen (se borraron en "Descripciones"). */
export function pruneRows(validIds: string[]): void {
  const valid = new Set(validIds);
  const kept = Object.entries(state.rows).filter(([id]) => valid.has(id));
  if (kept.length === Object.keys(state.rows).length) return;
  setState({ rows: Object.fromEntries(kept) });
}

/** Empieza un reporte nuevo. Conserva los logos elegidos. */
export function resetReport(): void {
  setState({
    ...freshFields(),
    logoIzq: state.logoIzq,
    logoDer: state.logoDer,
    result: null,
    error: null,
  });
}

/** Estado que se guarda dentro del PDF para poder reabrirlo. */
function projectOf(tipo: FotoTipo) {
  const { titulo, proy, cliente, sot, fecha, cid, contrata, logoIzq, logoDer, rows } = state;
  return {
    kind: "photo",
    tipo,
    state: { titulo, proy, cliente, sot, fecha, cid, contrata, logoIzq, logoDer, rows },
  };
}

/** Carga en pantalla un reporte leído de un PDF (ver backend /photos/import-pdf). */
export function importReport(saved: unknown): void {
  const x = (saved ?? {}) as Record<string, unknown>;
  setState({
    titulo: str(x.titulo, DEFAULT_TITULO),
    proy: str(x.proy, ""),
    cliente: str(x.cliente, ""),
    sot: str(x.sot, ""),
    fecha: str(x.fecha, todayPE()),
    cid: str(x.cid, ""),
    contrata: str(x.contrata, ""),
    logoIzq: loadLogo(x.logoIzq),
    logoDer: loadLogo(x.logoDer),
    rows: loadRows(x.rows),
    result: null,
    error: null,
  });
}

// ============================================================
// UTILIDADES
// ============================================================

// Misma regla que backend/app/services/naming.py (vista previa; el nombre
// real lo decide el servidor y se muestra al terminar de generar).
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const SOT_PREFIX = /^\s*SOT\s*[-_:.#]*\s*/i;

function cleanPart(text: string): string {
  return text
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "")
    .slice(0, 100)
    .replace(/[ .]+$/, "");
}

/** RF_SOT-<sot>_<cliente>.pdf */
export function previewFilename(sot: string, cliente: string): string {
  const parts = ["RF"];

  const sotClean = cleanPart(sot.replace(SOT_PREFIX, ""));
  if (sotClean) parts.push(`SOT-${sotClean}`);

  const clienteClean = cleanPart(cliente);
  if (clienteClean) parts.push(clienteClean);

  return parts.length === 1 ? "RF_<fecha y hora>.pdf" : `${parts.join("_")}.pdf`;
}

// ============================================================
// GENERAR PDF
// ============================================================

/**
 * Genera el PDF con los ítems marcados, en el mismo orden en que se ven en
 * pantalla (`orderedItems`). La petición vive aquí (no en el componente),
 * así que seguir navegando mientras se genera no la cancela.
 */
export type FotoTipo = "gpon_ont" | "gpon_modulo" | "fibra";

export const FOTO_TIPOS: Record<FotoTipo, string> = {
  gpon_ont: "GPON con ONT",
  gpon_modulo: "GPON con módulo",
  fibra: "Fibra convencional",
};

export const isGpon = (t: FotoTipo) => t !== "fibra";

export async function generatePdf(
  orderedItems: PhotoItem[],
  tipo: FotoTipo = "fibra"
): Promise<void> {
  if (state.generating) return;

  const s = state;
  const selected = orderedItems.filter((it) => getRow(s.rows, it.id).incluir);

  if (selected.length === 0) {
    setState({ error: "Marca al menos un ítem." });
    return;
  }

  const items = selected.map((it, i) => {
    const r = getRow(s.rows, it.id);
    return {
      numero: i + 1,
      descripcion: r.descripcion ?? it.nombre,
      image_path: r.imagePath || null,
      // GPON solo tiene lado cliente (lo guardado en pantalla no se modifica)
      lado: isGpon(tipo) ? "cliente" : r.lado,
    };
  });

  setState({ generating: true, error: null, result: null });

  try {
    const { data } = await api.post("/photos/pdf", {
      tipo,
      project: projectOf(tipo),
      titulo: s.titulo,
      proy: s.proy,
      cliente: s.cliente,
      sot: s.sot,
      fecha: s.fecha,
      cid: s.cid,
      contrata: s.contrata,
      ...logoPayload(s.logoIzq, "logo_izq"),
      ...logoPayload(s.logoDer, "logo_der"),
      items,
    });

    setState({
      generating: false,
      result: {
        url: data.url,
        filename: data.filename,
        pages: data.pages ?? 0,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      },
    });
  } catch (e) {
    setState({
      generating: false,
      error: apiErrorMessage(e, "No se pudo generar el PDF."),
    });
  }
}
