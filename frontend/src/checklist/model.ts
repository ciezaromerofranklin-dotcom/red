/**
 * model.ts — modelo del CheckList en pantalla.
 *
 * Cada fila es una COPIA editable de un ítem del perfil: se puede cambiar el nombre,
 * el comando, el orden, repetirla, quitarla o agregar otras nuevas sin tocar el perfil
 * guardado (para eso están «Guardar como perfil» / «Actualizar perfil»).
 */

import { useCallback } from "react";
import { usePersistentState } from "../store/persistentState";
import type { ChecklistItem } from "../types";

export interface Img { path: string; url: string }

export interface Row {
  id: string;             // id del ítem del perfil, o "n-…" si se creó en esta pantalla
  seccion: string;
  nombre: string;
  comando: string;        // puede llevar {VARIABLES}
  modo: "auto" | "manual";
  incluir: boolean;
  images: Img[];
  output: string | null;  // salida del comando (solo en memoria)
}

export type SetRows = (v: Row[] | ((prev: Row[]) => Row[])) => void;

export const newId = () =>
  "n-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

export function rowFromItem(it: ChecklistItem): Row {
  return { id: it.id, seccion: it.seccion, nombre: it.nombre, comando: it.comando || "", modo: it.modo, incluir: true, images: [], output: null };
}

// ---------------------------------------------------------------------------
// Filas por perfil (cada perfil conserva su avance al cambiar de uno a otro)
// ---------------------------------------------------------------------------
const EMPTY: Row[] = [];
const stripOutputs = (m: Record<string, Row[]>) =>
  Object.fromEntries(Object.entries(m).map(([k, rs]) => [k, rs.map((r) => ({ ...r, output: null }))]));

export function useChecklistRows() {
  const [servicio, setServicio] = usePersistentState<string>("checklist2.servicio", "");
  const [byProfile, setByProfile] = usePersistentState<Record<string, Row[]>>("checklist2.rows", {}, { serialize: stripOutputs });
  const rows = byProfile[servicio] ?? EMPTY;
  const setRows: SetRows = useCallback((v) => {
    setByProfile((prev) => {
      const cur = prev[servicio] ?? EMPTY;
      const next = typeof v === "function" ? (v as (p: Row[]) => Row[])(cur) : v;
      return { ...prev, [servicio]: next };
    });
  }, [servicio, setByProfile]);
  /** Guarda filas bajo OTRO perfil (p. ej. al «guardar como perfil nuevo» se conserva lo ya capturado). */
  const setRowsFor = useCallback((clave: string, next: Row[]) => setByProfile((prev) => ({ ...prev, [clave]: next })), [setByProfile]);
  return { servicio, setServicio, rows, setRows, setRowsFor, hasRows: servicio in byProfile };
}

// ---------------------------------------------------------------------------
// Variables {NOMBRE}
// ---------------------------------------------------------------------------
export type VendorKey = "cisco_ios" | "huawei" | "fortinet" | "";

export interface VarDef { label: string; ej: Partial<Record<Exclude<VendorKey, "">, string>>; ayuda?: string }

export const VAR_DEFS: Record<string, VarDef> = {
  WAN_IF:      { label: "Interfaz WAN", ej: { huawei: "GigabitEthernet0/0/4", cisco_ios: "GigabitEthernet0/0/0" } },
  WAN_SUBIF:   { label: "Subinterfaz WAN (VLAN)", ej: { huawei: "GigabitEthernet0/0/4.10", cisco_ios: "GigabitEthernet0/0/0.10" } },
  LAN_IF:      { label: "Interfaz LAN", ej: { huawei: "GigabitEthernet0/0/1", cisco_ios: "GigabitEthernet0/1/1" } },
  LAN_VLANIF:  { label: "Interfaz de la LAN (Vlan)", ej: { huawei: "Vlanif 1", cisco_ios: "Vlan1" } },
  WAN_NH:      { label: "IP del siguiente salto (PE)", ej: { huawei: "10.31.165.201", cisco_ios: "10.31.189.153", fortinet: "10.31.242.25" } },
  BGP_PEER:    { label: "IP del vecino BGP", ej: { huawei: "10.88.19.1", cisco_ios: "10.31.189.153", fortinet: "10.31.242.25" },
                 ayuda: "Si la dejas vacía se usa la IP del siguiente salto." },
  LAN_IP:      { label: "IP de la LAN a probar", ej: { fortinet: "192.168.1.1" } },
  MRA_IP:      { label: "IP del servidor / probe MRA", ej: {} },
  LOOPBACK_IP: { label: "IP Loopback de gestión (origen del ping)", ej: { huawei: "10.232.53.44" } },
  HA_PRINCIPAL_IP: { label: "IP del equipo principal (HA)", ej: {} },
  HA_CONT_IP:  { label: "IP del equipo de contingencia (HA)", ej: {} },
  PARAM:       { label: "Parámetro (interfaz o IP)", ej: {} },
};

const VAR_RE = /\{([A-Z][A-Z0-9_]*)\}/g;

export const varLabel = (k: string) => VAR_DEFS[k]?.label ?? k;

export function varsIn(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(VAR_RE), (m) => m[1])));
}

/** Variables que piden los comandos de los ítems automáticos incluidos, en orden de aparición. */
export function varsNeeded(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.incluir || r.modo !== "auto") continue;
    for (const k of varsIn(r.comando)) seen.add(k);
  }
  return Array.from(seen);
}

/** Valores efectivos: BGP_PEER vacío usa el siguiente salto. */
export function effectiveVars(vars: Record<string, string>): Record<string, string> {
  const v = { ...vars };
  if (!(v.BGP_PEER || "").trim() && (v.WAN_NH || "").trim()) v.BGP_PEER = v.WAN_NH;
  return v;
}

/** Reemplaza {VAR} por su valor; las que no tienen valor se dejan como están. */
export function applyVars(text: string, vars: Record<string, string>): string {
  const v = effectiveVars(vars);
  return text.replace(VAR_RE, (m, k) => (v[k] || "").trim() || m);
}

// ---------------------------------------------------------------------------
// Orden: secciones y filas
// ---------------------------------------------------------------------------
export const sectionsOf = (rows: Row[]) => Array.from(new Set(rows.map((r) => r.seccion)));

/** Mantiene las filas agrupadas por sección (en orden de aparición). */
export function regroup(rows: Row[]): Row[] {
  const order = sectionsOf(rows);
  return order.flatMap((s) => rows.filter((r) => r.seccion === s));
}

export function moveRowBy(rows: Row[], id: string, delta: -1 | 1): Row[] {
  const sec = rows.find((r) => r.id === id)?.seccion;
  const idxs = rows.map((r, i) => (r.seccion === sec ? i : -1)).filter((i) => i >= 0);
  const pos = idxs.findIndex((i) => rows[i].id === id);
  const to = pos + delta;
  if (pos < 0 || to < 0 || to >= idxs.length) return rows;
  const next = rows.slice();
  [next[idxs[pos]], next[idxs[to]]] = [next[idxs[to]], next[idxs[pos]]];
  return next;
}

/** Arrastrar: la fila pasa a quedar justo antes de la fila destino (y toma su sección). */
export function moveRowTo(rows: Row[], fromId: string, toId: string): Row[] {
  if (fromId === toId) return rows;
  const from = rows.find((r) => r.id === fromId);
  const target = rows.find((r) => r.id === toId);
  if (!from || !target) return rows;
  const without = rows.filter((r) => r.id !== fromId);
  const at = without.findIndex((r) => r.id === toId);
  without.splice(at, 0, { ...from, seccion: target.seccion });
  return regroup(without);
}

export function moveSection(rows: Row[], sec: string, delta: -1 | 1): Row[] {
  const order = sectionsOf(rows);
  const i = order.indexOf(sec);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return rows;
  [order[i], order[j]] = [order[j], order[i]];
  return order.flatMap((s) => rows.filter((r) => r.seccion === s));
}

/** Repite un ítem justo debajo (sin imágenes ni salida: hay que volver a capturarlo). */
export function duplicateRow(rows: Row[], id: string): Row[] {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return rows;
  const src = rows[i];
  const copy: Row = { ...src, id: newId(), nombre: nextCopyName(src.nombre, rows.map((r) => r.nombre)), images: [], output: null, incluir: true };
  const next = rows.slice();
  next.splice(i + 1, 0, copy);
  return next;
}

/** Repite una sección completa (bloque) justo después de la original. */
export function duplicateSection(rows: Row[], sec: string): Row[] {
  const names = sectionsOf(rows);
  const newName = nextCopyName(sec, names);
  const copies = rows.filter((r) => r.seccion === sec).map((r) => ({ ...r, id: newId(), seccion: newName, images: [], output: null }));
  const lastIdx = rows.map((r) => r.seccion).lastIndexOf(sec);
  const next = rows.slice();
  next.splice(lastIdx + 1, 0, ...copies);
  return next;
}

function nextCopyName(name: string, existing: string[]): string {
  const base = name.replace(/\s*\(\d+\)\s*$/, "");
  let n = 2;
  while (existing.includes(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

// ---------------------------------------------------------------------------
// Nombre del archivo (misma regla que el servidor: services/naming.py)
// ---------------------------------------------------------------------------
const INVALID = /[\\/:*?"<>|\x00-\x1f\x7f]/g;
const cleanPart = (t: string) => t.replace(INVALID, " ").replace(/\s+/g, " ").trim().replace(/^[ .]+|[ .]+$/g, "").slice(0, 100).trim();

export function previewFilename(sot: string, cliente: string): string {
  const s = cleanPart(sot.replace(/^\s*SOT\s*[-_:.#]*\s*/i, ""));
  const c = cleanPart(cliente);
  let name = "checklist";
  if (s) name += `_sot_${s}`;
  if (c) name += s ? `-${c}` : `_${c}`;
  if (!s && !c) name += "_<fecha y hora>";
  return name + ".pdf";
}

// ---------------------------------------------------------------------------
// Subtítulo sugerido (como en los ejemplos: "Servicio Internet Corporativo 50Mbps- CPE Huawei AR611")
// ---------------------------------------------------------------------------
const VENDOR_NAME: Record<string, string> = { cisco_ios: "Cisco", huawei: "Huawei", fortinet: "Fortinet" };

export function suggestSubtitle(clave: string, vendor: string, bw: string, modelo: string): string {
  const tipo = clave.startsWith("rpv") ? "RPV" : "Internet";
  const b = bw.trim();
  const base = b ? `Servicio ${tipo} ${b}Mbps-` : `Servicio ${tipo}`;
  const marca = VENDOR_NAME[vendor] || "";
  const m = modelo.trim();
  // Si el modelo ya empieza con la marca ("Huawei AR611") no se repite.
  const cpe = m.toLowerCase().startsWith(marca.toLowerCase()) && marca ? m : [marca, m].filter(Boolean).join(" ");
  return cpe ? `${base} CPE ${cpe}` : base.replace(/-$/, "");
}
