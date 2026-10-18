import { useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import type { HeaderLogo } from "../types";
import { NO_LOGO } from "../logo";
import type { LogoSel } from "../logo";

interface Props {
  /** "izq" = empresa, "der" = Claro. Cada lado tiene su propia lista. */
  posicion: "izq" | "der";
  label: string;
  value: LogoSel;
  onChange: (value: LogoSel) => void;
}

/**
 * Elige el logo de la cabecera del PDF entre los guardados en la base de
 * datos, o carga uno nuevo (guardándolo para futuros reportes o usándolo
 * solo esta vez). Los guardados se pueden eliminar.
 */
export default function LogoPicker({ posicion, label, value, onChange }: Props) {
  const [logos, setLogos] = useState<HeaderLogo[]>([]);
  const [loading, setLoading] = useState(true);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // El efecto de carga solo debe correr al montar; estas refs le dan siempre
  // los valores más recientes sin volver a ejecutarlo.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let alive = true;
    setLoading(true);

    api
      .get<HeaderLogo[]>("/logos", { params: { posicion } })
      .then(({ data }) => {
        if (!alive) return;
        setLogos(data);
        setError(null);

        // El logo elegido (guardado en el navegador) pudo borrarse desde otro lado.
        const sel = valueRef.current;
        if (sel.id && !data.some((l) => l.id === sel.id)) {
          onChangeRef.current(NO_LOGO);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(apiErrorMessage(e, "No se pudieron cargar los logos guardados."));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [posicion]);

  // Vista previa del archivo elegido (se libera al cambiar o desmontar)
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("El archivo debe ser una imagen (PNG, JPG, WEBP...).");
      return;
    }
    setError(null);
    setFile(f);
    setNombre(f.name.replace(/\.[^.]+$/, ""));
  }

  function cancelPending() {
    setFile(null);
    setNombre("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function saveAndUse() {
    if (!file) return;
    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("nombre", nombre.trim());
      form.append("posicion", posicion);

      const { data } = await api.post<HeaderLogo>("/logos", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setLogos((prev) =>
        [...prev, data].sort((a, b) =>
          a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
        )
      );
      onChange({ id: data.id, path: "", url: data.url });
      cancelPending();
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo guardar el logo."));
    } finally {
      setBusy(false);
    }
  }

  async function useOnce() {
    if (!file) return;
    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const { data } = await api.post<{ path: string; url: string }>(
        "/files/upload",
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      onChange({ id: null, path: data.path, url: data.url });
      cancelPending();
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo subir el logo."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(logo: HeaderLogo) {
    if (!confirm(`¿Eliminar el logo «${logo.nombre}» de la base de datos?`)) return;

    try {
      await api.delete(`/logos/${logo.id}`);
      setLogos((prev) => prev.filter((l) => l.id !== logo.id));
      if (value.id === logo.id) onChange(NO_LOGO);
      setError(null);
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo eliminar el logo."));
    }
  }

  const noneSelected = !value.id && !value.path;
  const tempSelected = !value.id && !!value.path;

  const tile = (selected: boolean) =>
    `w-28 rounded-lg border-2 p-1.5 text-left transition-colors ${
      selected
        ? "border-brand-500 bg-brand-50"
        : "border-slate-200 bg-white hover:border-slate-300"
    }`;

  return (
    <div>
      <p className="label">{label}</p>

      <div className="flex flex-wrap gap-3 pt-1">
        <button
          type="button"
          aria-pressed={noneSelected}
          onClick={() => onChange(NO_LOGO)}
          className={tile(noneSelected)}
        >
          <span className="flex h-10 items-center justify-center rounded bg-slate-50 text-[11px] text-slate-400">
            —
          </span>
          <span className="mt-1 block truncate text-[11px] font-medium text-slate-600">
            {noneSelected ? "✓ " : ""}Sin logo
          </span>
        </button>

        {logos.map((l) => {
          const selected = value.id === l.id;
          return (
            <div key={l.id} className="relative">
              <button
                type="button"
                title={l.nombre}
                aria-pressed={selected}
                onClick={() => onChange({ id: l.id, path: "", url: l.url })}
                className={tile(selected)}
              >
                <span className="flex h-10 items-center justify-center overflow-hidden rounded bg-slate-50">
                  <img
                    src={l.url}
                    alt={l.nombre}
                    className="max-h-full max-w-full object-contain"
                  />
                </span>
                <span className="mt-1 block truncate text-[11px] font-medium text-slate-600">
                  {selected ? "✓ " : ""}
                  {l.nombre}
                </span>
              </button>

              <button
                type="button"
                title="Eliminar de la base de datos"
                aria-label={`Eliminar el logo ${l.nombre}`}
                onClick={() => remove(l)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] text-slate-400 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          );
        })}

        {tempSelected && (
          <div className="relative">
            <div className={tile(true)} title="Subido solo para este reporte">
              <span className="flex h-10 items-center justify-center overflow-hidden rounded bg-slate-50">
                <img
                  src={value.url}
                  alt="Logo cargado"
                  className="max-h-full max-w-full object-contain"
                />
              </span>
              <span className="mt-1 block truncate text-[11px] font-medium text-slate-600">
                ✓ Solo esta vez
              </span>
            </div>

            <button
              type="button"
              title="Quitar"
              aria-label="Quitar el logo cargado"
              onClick={() => onChange(NO_LOGO)}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] text-slate-400 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {loading && <p className="mt-2 text-xs text-slate-400">Cargando logos guardados…</p>}

      {!loading && logos.length === 0 && !file && (
        <p className="mt-2 text-xs text-slate-400">
          Aún no hay logos guardados. Carga uno y pulsa «Guardar logo» para
          tenerlo siempre disponible.
        </p>
      )}

      <div className="mt-3">
        <label className="btn-secondary cursor-pointer text-xs">
          + Cargar nuevo logo
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {file && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          {preview && (
            <img
              src={preview}
              alt="Vista previa"
              className="h-10 max-w-[7rem] rounded border border-slate-200 bg-white object-contain"
            />
          )}

          <input
            className="input min-w-[150px] flex-1"
            placeholder="Nombre (ej. WITLINK)"
            value={nombre}
            maxLength={80}
            onChange={(e) => setNombre(e.target.value)}
          />

          <button
            type="button"
            className="btn-primary text-xs"
            disabled={busy}
            onClick={saveAndUse}
          >
            {busy ? "Guardando..." : "💾 Guardar logo"}
          </button>

          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={busy}
            onClick={useOnce}
          >
            Solo usar esta vez
          </button>

          <button
            type="button"
            className="text-xs text-slate-500 hover:underline"
            disabled={busy}
            onClick={cancelPending}
          >
            Cancelar
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
