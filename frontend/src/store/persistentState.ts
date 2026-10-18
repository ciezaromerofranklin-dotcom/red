/**
 * persistentState.ts
 *
 * Reemplazo de useState para el estado que NO debe perderse al cambiar de
 * página o de pestaña dentro del programa.
 *
 * Por qué se perdía: React destruye el componente de una página al navegar a
 * otra y su useState se va con él. Aquí el valor vive a nivel de módulo (no
 * lo destruye ningún cambio de pantalla) y, además, se guarda en
 * localStorage para sobrevivir a recargar la página o cerrar el navegador.
 *
 * Uso:  const [sot, setSot] = usePersistentState("pruebas.sot", "");
 */

import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "netops.ui.v1.";
const SAVE_DELAY_MS = 250;

export interface PersistOptions<T> {
  /**
   * false = solo en memoria (sobrevive al cambio de página, no a recargar).
   * Para resultados grandes, bitácoras de ejecución, etc.
   */
  persist?: boolean;
  /**
   * Qué se guarda en localStorage. Devuelve undefined para no guardar nada.
   * Se usa, por ejemplo, para no guardar contraseñas en disco.
   */
  serialize?: (value: T) => unknown;
}

interface Entry {
  value: unknown;
  initial: unknown;
  listeners: Set<() => void>;
  persist: boolean;
  serialize?: (value: never) => unknown;
  timer?: number;
}

const entries = new Map<string, Entry>();

// ------------------------------------------------------------
// localStorage (siempre con try/catch: puede no estar disponible)
// ------------------------------------------------------------

type Envelope = { v: unknown; d: boolean };

function readStored(key: string): Envelope | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Envelope;
    return parsed && typeof parsed === "object" && "v" in parsed ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, entry: Entry): void {
  if (!entry.persist) return;

  try {
    const toSave = entry.serialize
      ? (entry.serialize as (v: unknown) => unknown)(entry.value)
      : entry.value;

    if (toSave === undefined) {
      localStorage.removeItem(PREFIX + key);
      return;
    }

    // "d" = el usuario no tocó este campo (sigue valiendo su valor por defecto).
    // Así, un campo no tocado (p. ej. la fecha de hoy) no se queda con el valor
    // de un día anterior.
    const untouched = JSON.stringify(entry.value) === JSON.stringify(entry.initial);
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: toSave, d: untouched }));
  } catch {
    // sin espacio / modo privado: se sigue funcionando en memoria
  }
}

/** Mezcla lo guardado con el valor inicial, validando que el tipo sea el esperado. */
function revive(stored: unknown, initial: unknown): unknown {
  if (Array.isArray(initial)) return Array.isArray(stored) ? stored : initial;

  if (initial !== null && typeof initial === "object") {
    return stored !== null && typeof stored === "object" && !Array.isArray(stored)
      ? { ...(initial as object), ...(stored as object) }
      : initial;
  }

  return typeof stored === typeof initial ? stored : initial;
}

// ------------------------------------------------------------
// Almacén
// ------------------------------------------------------------

function getEntry<T>(
  key: string,
  initial: T | (() => T),
  options?: PersistOptions<T>
): Entry {
  const existing = entries.get(key);
  if (existing) return existing;

  const init = typeof initial === "function" ? (initial as () => T)() : initial;
  const persist = options?.persist !== false;

  let value: unknown = init;
  if (persist) {
    const stored = readStored(key);
    if (stored && !stored.d) value = revive(stored.v, init);
  }

  const entry: Entry = {
    value,
    initial: init,
    listeners: new Set(),
    persist,
    serialize: options?.serialize as Entry["serialize"],
  };

  entries.set(key, entry);
  return entry;
}

function flushAll(): void {
  entries.forEach((entry, key) => {
    window.clearTimeout(entry.timer);
    entry.timer = undefined;
    writeStored(key, entry);
  });
}

if (typeof window !== "undefined") {
  // Guarda lo pendiente si el usuario cierra o recarga la pestaña.
  window.addEventListener("pagehide", flushAll);
}

function setValue(key: string, entry: Entry, next: unknown): void {
  if (Object.is(entry.value, next)) return;

  entry.value = next;
  entry.listeners.forEach((l) => l());

  if (entry.persist) {
    window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => writeStored(key, entry), SAVE_DELAY_MS);
  }
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function usePersistentState<T>(
  key: string,
  initial: T | (() => T),
  options?: PersistOptions<T>
): [T, (value: T | ((prev: T) => T)) => void] {
  const entry = getEntry(key, initial, options);

  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [entry]
  );

  const value = useSyncExternalStore(
    subscribe,
    () => entry.value as T,
    () => entry.value as T
  );

  // Estable entre renders y acepta la forma funcional (prev => next), que es
  // lo que necesitan los callbacks asíncronos (p. ej. agregar líneas a un log).
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: T) => T)(entry.value as T)
          : next;
      setValue(key, entry, resolved);
    },
    [key, entry]
  );

  return [value, set];
}
