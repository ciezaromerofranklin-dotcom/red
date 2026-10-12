import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import ImageAnnotator from "../components/ImageAnnotator";
import LogoPicker from "../components/LogoPicker";
import type { PhotoItem } from "../types";
import {
  apiErrorMessage,
  generatePdf,
  getRow,
  previewFilename,
  pruneRows,
  resetReport,
  setField,
  setIncluir,
  updateRow,
  usePhotoReport,
} from "../store/photoReportStore";
import type { Lado } from "../store/photoReportStore";

const LADO_OPTIONS: { value: Lado; label: string }[] = [
  { value: "site", label: "SITE" },
  { value: "pdi", label: "PDI" },
  { value: "pop", label: "POP" },
  { value: "cliente", label: "CLIENTE" },
];

const CATEGORIAS_BASE = [
  "EQUIPOS INSTALADOS ACCESO",
  "ETIQUETADO",
  "RECORRIDO EN ACCESO",
  "VISTA GENERAL UBICACION DE EQUIPOS",
  "EQUIPOS LADO CLIENTE",
  "ETIQUETADO CLIENTE",
  "VISTA INSTALACION EN GABINETE",
  "RECORRIDO CLIENTE",
  "VISTA INSTALACION DE EQUIPOS",
  "MULTIMETRO",
  "QR",
];

/** Agrupa por categoría respetando el orden en que llegan los ítems. */
function groupByCategory(items: PhotoItem[]) {
  const map = new Map<string, PhotoItem[]>();

  for (const it of items) {
    const list = map.get(it.categoria);
    if (list) list.push(it);
    else map.set(it.categoria, [it]);
  }

  return Array.from(map, ([categoria, list]) => ({ categoria, items: list }));
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

// ============================================================
// PÁGINA
// ============================================================

export default function FotograficoPage() {
  const [tab, setTab] = useState<"run" | "items">("run");
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    return api
      .get<PhotoItem[]>("/photos/items")
      .then((r) => {
        setItems(r.data);
        setLoadError(null);
        pruneRows(r.data.map((i) => i.id));
      })
      .catch((e) =>
        setLoadError(apiErrorMessage(e, "No se pudieron cargar las descripciones."))
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Guarda el orden de una categoría: se ve al instante y se confirma en el servidor. */
  const reorderCategory = useCallback(
    async (categoria: string, ids: string[]) => {
      setItems((prev) => {
        const byId = new Map(prev.map((i) => [i.id, i]));
        const reordered = ids.flatMap((id, idx) => {
          const it = byId.get(id);
          return it ? [{ ...it, orden: (idx + 1) * 10 }] : [];
        });

        const out: PhotoItem[] = [];
        let inserted = false;
        for (const it of prev) {
          if (it.categoria !== categoria) out.push(it);
          else if (!inserted) {
            out.push(...reordered);
            inserted = true;
          }
        }
        return out;
      });

      try {
        await api.post("/photos/items/reorder", { ids });
      } catch (e) {
        alert(apiErrorMessage(e, "No se pudo guardar el nuevo orden."));
        reload(); // vuelve a lo que realmente hay en el servidor
      }
    },
    [reload]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">
          Reporte Fotográfico
        </h2>

        <p className="text-slate-500 text-sm">
          EQUIPOS INSTALADOS ACCESO, ETIQUETADO, RECORRIDO EN ACCESO, VISTA
          GENERAL UBICACION DE EQUIPOS, EQUIPOS LADO CLIENTE, ETIQUETADO
          CLIENTE, VISTA INSTALACION EN GABINETE, RECORRIDO CLIENTE, VISTA
          INSTALACION DE EQUIPOS, MULTIMETRO, QR.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          className={tab === "run" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("run")}
        >
          Generar reporte
        </button>

        <button
          className={tab === "items" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("items")}
        >
          Descripciones (editar)
        </button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="card flex items-center justify-between gap-3 border-red-200 bg-red-50 text-sm text-red-700"
        >
          <span>{loadError}</span>
          <button className="btn-secondary text-xs" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Cargando…
        </p>
      ) : tab === "run" ? (
        <RunTab items={items} onReorder={reorderCategory} />
      ) : (
        <ItemsTab items={items} onChange={reload} />
      )}
    </div>
  );
}

// ============================================================
// PESTAÑA: GENERAR REPORTE
// (el estado vive en store/photoReportStore, no aquí: así no se
//  pierde al cambiar de pestaña o de página)
// ============================================================

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function RunTab({
  items,
  onReorder,
}: {
  items: PhotoItem[];
  onReorder: (categoria: string, ids: string[]) => void;
}) {
  const s = usePhotoReport();

  const [editing, setEditing] = useState<{ id: string; imageUrl: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const groups = useMemo(() => groupByCategory(items), [items]);
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  function allChecked(list: PhotoItem[]) {
    return (
      list.length > 0 && list.every((it) => getRow(s.rows, it.id).incluir)
    );
  }

  function toggle(list: PhotoItem[], value: boolean) {
    setIncluir(
      list.map((it) => it.id),
      value
    );
  }

  function handleDrop(list: PhotoItem[], categoria: string, targetId: string) {
    const from = dragId;
    setDragId(null);
    setOverId(null);

    if (!from || from === targetId) return;

    const ids = list.map((it) => it.id);
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);
    onReorder(categoria, ids);
  }

  function generate() {
    const selected = ordered.filter((it) => getRow(s.rows, it.id).incluir);

    if (selected.length === 0) {
      alert("Marca al menos un ítem.");
      return;
    }

    const sinImagen = selected.filter((it) => !getRow(s.rows, it.id).imagePath);

    if (
      sinImagen.length > 0 &&
      !confirm(
        `${sinImagen.length} ítem(s) sin foto todavía. ¿Generar de todas formas?`
      )
    ) {
      return;
    }

    void generatePdf(ordered);
  }

  function newReport() {
    if (
      confirm(
        "¿Empezar un reporte nuevo?\n\nSe borrarán los datos, los ítems marcados, las descripciones editadas y las fotos. Los logos elegidos se conservan."
      )
    ) {
      resetReport();
    }
  }

  return (
    <div className="space-y-6">
      <div className="card grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            Tu avance se guarda automáticamente en este navegador.
          </p>

          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={newReport}
            disabled={s.generating}
          >
            🆕 Nuevo reporte
          </button>
        </div>

        <div className="col-span-2">
          <TextField
            label="Título"
            value={s.titulo}
            onChange={(v) => setField("titulo", v)}
          />
        </div>

        <TextField label="PROY" value={s.proy} onChange={(v) => setField("proy", v)} />
        <TextField
          label="CLIENTE"
          value={s.cliente}
          onChange={(v) => setField("cliente", v)}
        />
        <TextField label="SOT" value={s.sot} onChange={(v) => setField("sot", v)} />
        <TextField label="FECHA" value={s.fecha} onChange={(v) => setField("fecha", v)} />
        <TextField label="CID" value={s.cid} onChange={(v) => setField("cid", v)} />
        <TextField
          label="CONTRATA"
          value={s.contrata}
          onChange={(v) => setField("contrata", v)}
        />

        <p className="col-span-2 text-xs text-slate-500">
          El PDF se guardará como:{" "}
          <span className="break-all font-mono text-slate-700">
            {previewFilename(s.sot, s.cliente)}
          </span>
        </p>

        <div className="col-span-2">
          <LogoPicker
            posicion="izq"
            label="Logo izquierda (empresa)"
            value={s.logoIzq}
            onChange={(v) => setField("logoIzq", v)}
          />
        </div>

        <div className="col-span-2">
          <LogoPicker
            posicion="der"
            label="Logo derecha (Claro)"
            value={s.logoDer}
            onChange={(v) => setField("logoDer", v)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={allChecked(ordered)}
            onChange={(e) => toggle(ordered, e.target.checked)}
          />
          Seleccionar todo
        </label>
      </div>

      <div className="space-y-4">
        {groups.map(({ categoria, items: list }) => (
          <div key={categoria} className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-brand-700 uppercase">
                {categoria}
              </h3>

              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={allChecked(list)}
                  onChange={(e) => toggle(list, e.target.checked)}
                />
                Seleccionar sección
              </label>
            </div>

            <div className="space-y-2">
              {list.map((it) => {
                const r = getRow(s.rows, it.id);
                const isOver = overId === it.id && dragId !== null && dragId !== it.id;

                return (
                  <div
                    key={it.id}
                    onDragOver={(e) => {
                      if (dragId) {
                        e.preventDefault();
                        setOverId(it.id);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(list, categoria, it.id);
                    }}
                    className={`border rounded-lg p-3 flex items-center gap-3 flex-wrap transition-colors ${
                      dragId === it.id ? "opacity-50" : ""
                    } ${isOver ? "border-brand-400 bg-brand-50" : "border-slate-100"}`}
                  >
                    {/* Solo el asa es arrastrable: así se puede seleccionar el
                        texto de los campos con el mouse sin mover la fila. */}
                    <span
                      draggable
                      onDragStart={(e) => {
                        setDragId(it.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", it.id);
                        const row = e.currentTarget.parentElement;
                        if (row) e.dataTransfer.setDragImage(row, 16, 16);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                      className="cursor-grab select-none text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                      title="Arrastra para reordenar"
                    >
                      ⠿
                    </span>

                    <input
                      type="checkbox"
                      checked={r.incluir}
                      onChange={(e) =>
                        updateRow(it.id, { incluir: e.target.checked })
                      }
                    />

                    <input
                      className="input flex-1 min-w-[220px]"
                      value={r.descripcion ?? it.nombre}
                      onChange={(e) =>
                        updateRow(it.id, { descripcion: e.target.value })
                      }
                    />

                    <select
                      className="input w-32"
                      value={r.lado}
                      onChange={(e) =>
                        updateRow(it.id, { lado: e.target.value as Lado })
                      }
                    >
                      {LADO_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>

                    <ImageUpload
                      compact
                      initialUrl={r.imageUrl}
                      onUploaded={(p, u) =>
                        updateRow(it.id, { imagePath: p, imageUrl: u })
                      }
                    />

                    {r.imagePath && (
                      <button
                        className="btn-secondary text-xs"
                        onClick={() =>
                          setEditing({ id: it.id, imageUrl: r.imageUrl })
                        }
                      >
                        ✏️ Editar (líneas punteadas)
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {groups.length === 0 && (
          <div className="card text-sm text-slate-500">
            No hay descripciones todavía. Créalas en la pestaña «Descripciones
            (editar)».
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={generate}
          disabled={s.generating}
          aria-busy={s.generating}
        >
          {s.generating ? (
            <>
              <Spinner /> Generando PDF...
            </>
          ) : (
            "Generar PDF"
          )}
        </button>
      </div>

      {s.generating && (
        <div
          role="status"
          aria-live="polite"
          className="card flex items-center gap-4 border-brand-200 bg-brand-50"
        >
          <Spinner className="h-8 w-8 shrink-0 text-brand-600" />
          <div>
            <p className="text-sm font-semibold text-brand-700">
              Generando el PDF…
            </p>
            <p className="text-xs text-slate-500">
              Puede tardar unos segundos según la cantidad de fotos.
            </p>
          </div>
        </div>
      )}

      {s.error && (
        <div
          role="alert"
          className="card border-red-200 bg-red-50 text-sm text-red-700"
        >
          {s.error}
        </div>
      )}

      {s.result && (
        <div className="card space-y-2 border-green-200 bg-green-50">
          <p className="text-sm text-green-700">
            PDF generado correctamente ({s.result.pages}{" "}
            {s.result.pages === 1 ? "página" : "páginas"}).
          </p>

          <p className="break-all font-mono text-xs text-slate-600">
            {s.result.filename}
          </p>

          {s.result.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700">
              {s.result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <a
            className="btn-primary"
            href={s.result.url}
            download={s.result.filename}
          >
            Descargar PDF
          </a>
        </div>
      )}

      {editing && (
        <ImageAnnotator
          imageUrl={editing.imageUrl}
          onClose={() => setEditing(null)}
          onSaved={(p, u) => updateRow(editing.id, { imagePath: p, imageUrl: u })}
        />
      )}
    </div>
  );
}

// ============================================================
// PESTAÑA: DESCRIPCIONES (editar)
// ============================================================

function ItemsTab({
  items,
  onChange,
}: {
  items: PhotoItem[];
  onChange: () => void;
}) {
  const [selected, setSelected] = useState<PhotoItem | null>(null);
  const [categoria, setCategoria] = useState("");
  const [nombre, setNombre] = useState("");
  // "" = automático (al final de su categoría)
  const [orden, setOrden] = useState("");
  const [busy, setBusy] = useState(false);

  const categorias = useMemo(
    () => Array.from(new Set([...CATEGORIAS_BASE, ...items.map((i) => i.categoria)])),
    [items]
  );

  function select(it: PhotoItem) {
    setSelected(it);
    setCategoria(it.categoria);
    setNombre(it.nombre);
    setOrden(String(it.orden));
  }

  function clear() {
    setSelected(null);
    setCategoria("");
    setNombre("");
    setOrden("");
  }

  async function save() {
    if (!nombre.trim()) {
      alert("Escribe la descripción.");
      return;
    }

    if (!categoria.trim()) {
      alert("Escribe la categoría.");
      return;
    }

    const payload: { categoria: string; nombre: string; orden?: number } = {
      categoria: categoria.trim(),
      nombre: nombre.trim(),
    };

    if (orden.trim() !== "" && Number.isFinite(Number(orden))) {
      payload.orden = Number(orden);
    }

    setBusy(true);
    try {
      if (selected) {
        await api.put(`/photos/items/${selected.id}`, payload);
      } else {
        await api.post("/photos/items", payload);
      }

      clear();
      onChange();
    } catch (e) {
      alert(apiErrorMessage(e, "No se pudo guardar."));
    } finally {
      setBusy(false);
    }
  }

  async function del(it: PhotoItem) {
    if (!confirm(`¿Eliminar '${it.nombre}'?`)) return;

    setBusy(true);
    try {
      await api.delete(`/photos/items/${it.id}`);
      clear();
      onChange();
    } catch (e) {
      alert(apiErrorMessage(e, "No se pudo eliminar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[320px_1fr] gap-6">
      <div className="space-y-3">
        <div className="card p-0 divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => select(it)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                selected?.id === it.id ? "bg-brand-50" : ""
              }`}
            >
              <div className="font-medium text-slate-700">{it.nombre}</div>

              <div className="text-xs text-slate-400">
                [{it.categoria}] orden {it.orden}
              </div>
            </button>
          ))}
        </div>

        <button className="btn-secondary w-full" onClick={clear}>
          + Nueva descripción
        </button>
      </div>

      <div className="card space-y-4">
        <div>
          <label className="label">Categoría</label>

          <input
            className="input"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            list="categorias-list"
          />

          <datalist id="categorias-list">
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="label">Descripción</label>

          <input
            className="input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Orden (opcional)</label>

          <input
            className="input"
            type="number"
            placeholder="Automático (al final de la categoría)"
            value={orden}
            onChange={(e) => setOrden(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button className="btn-primary" onClick={save} disabled={busy}>
            💾 Guardar
          </button>

          {selected && (
            <button
              className="btn-danger"
              onClick={() => del(selected)}
              disabled={busy}
            >
              🗑 Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
