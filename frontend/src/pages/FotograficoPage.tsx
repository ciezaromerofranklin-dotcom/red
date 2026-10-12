import { useEffect, useState } from "react";
import { api } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import ImageAnnotator from "../components/ImageAnnotator";
import type { PhotoItem } from "../types";

type Lado = "site" | "pdi" | "pop" | "cliente";
type TipoInstalacion = "gpon_ont" | "gpon_modulo" | "fibra_convencional";

type RowState = {
  item: PhotoItem;
  incluir: boolean;
  descripcion: string;
  imagePath: string;
  imageUrl: string;
  lado: Lado;
};

type SavedRowState = {
  id: string;
  incluir: boolean;
  descripcion: string;
  imagePath: string;
  imageUrl: string;
  lado: Lado;
};

type DraftState = {
  titulo: string;
  proy: string;
  cliente: string;
  sot: string;
  fecha: string;
  cid: string;
  contrata: string;
  rows: SavedRowState[];
};

type LogoState = {
  logoIzq: string;
  logoIzqUrl: string;
  logoDer: string;
  logoDerUrl: string;
};

const LOGOS_STORAGE_KEY = "fotografico_logos_v1";

function draftStorageKey(tipo: TipoInstalacion) {
  return `fotografico_draft_v1_${tipo}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function getTipoLabel(tipo: TipoInstalacion) {
  if (tipo === "gpon_ont") return "GPON CON ONT";
  if (tipo === "gpon_modulo") return "GPON CON MÓDULO";
  return "FIBRA CONVENCIONAL";
}

function defaultTitle() {
  return "REPORTE FOTOGRAFICO INSTALACION DE FIBRA";
}

function emptyDraft(): DraftState {
  return {
    titulo: defaultTitle(),
    proy: "",
    cliente: "",
    sot: "",
    fecha: new Date().toLocaleDateString("es-PE"),
    cid: "",
    contrata: "",
    rows: [],
  };
}

export default function FotograficoPage() {
  const [tab, setTab] = useState<"run" | "items">("run");
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [tipoInstalacion, setTipoInstalacion] =
    useState<TipoInstalacion | "">("");

  useEffect(() => {
    reload();
  }, []);

  function reload() {
    api
      .get("/photos/items")
      .then((r) => setItems(r.data))
      .catch((error) => {
        console.error("No se pudieron cargar los ítems fotográficos:", error);
        alert("No se pudieron cargar las descripciones. Revisa la conexión con el servidor.");
      });
  }

  if (!tipoInstalacion) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="card space-y-5">
          <h2 className="text-2xl font-bold text-slate-800">
            Reporte Fotográfico
          </h2>
          <p className="text-sm text-slate-500">
            Selecciona el tipo de instalación para comenzar o continuar un borrador.
          </p>
          <select
            className="input"
            value={tipoInstalacion}
            onChange={(e) =>
              setTipoInstalacion(e.target.value as TipoInstalacion | "")
            }
          >
            <option value="">Seleccionar...</option>
            <option value="gpon_ont">GPON CON ONT</option>
            <option value="gpon_modulo">GPON CON MÓDULO</option>
            <option value="fibra_convencional">FIBRA CONVENCIONAL</option>
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            Reporte Fotográfico
          </h2>
          <p className="text-sm text-slate-500">
            Tipo de instalación: {getTipoLabel(tipoInstalacion)}
          </p>
        </div>
        <button
          className="btn-secondary"
          onClick={() => setTipoInstalacion("")}
        >
          Cambiar tipo
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
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

      {tab === "run" ? (
        <RunTab key={tipoInstalacion} items={items} tipoInstalacion={tipoInstalacion} />
      ) : (
        <ItemsTab items={items} onChange={reload} />
      )}
    </div>
  );
}

function RunTab({
  items,
  tipoInstalacion,
}: {
  items: PhotoItem[];
  tipoInstalacion: TipoInstalacion;
}) {
  const draftKey = draftStorageKey(tipoInstalacion);
  const [savedDraft] = useState<DraftState>(() =>
    readJson<DraftState>(draftKey, emptyDraft())
  );
  const [savedLogos] = useState<LogoState>(() =>
    readJson<LogoState>(LOGOS_STORAGE_KEY, {
      logoIzq: "",
      logoIzqUrl: "",
      logoDer: "",
      logoDerUrl: "",
    })
  );

  const [rows, setRows] = useState<RowState[]>([]);
  const [rowsReady, setRowsReady] = useState(false);
  const [titulo, setTitulo] = useState(savedDraft.titulo);
  const [proy, setProy] = useState(savedDraft.proy);
  const [cliente, setCliente] = useState(savedDraft.cliente);
  const [sot, setSot] = useState(savedDraft.sot);
  const [fecha, setFecha] = useState(savedDraft.fecha || new Date().toLocaleDateString("es-PE"));
  const [cid, setCid] = useState(savedDraft.cid);
  const [contrata, setContrata] = useState(savedDraft.contrata);

  const [logoIzq, setLogoIzq] = useState(savedLogos.logoIzq);
  const [logoIzqUrl, setLogoIzqUrl] = useState(savedLogos.logoIzqUrl);
  const [logoDer, setLogoDer] = useState(savedLogos.logoDer);
  const [logoDerUrl, setLogoDerUrl] = useState(savedLogos.logoDerUrl);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<RowState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!items.length) {
      setRows([]);
      setRowsReady(false);
      return;
    }

    const savedRows = new Map(savedDraft.rows.map((r) => [r.id, r]));
    const initial: RowState[] = items
      .slice()
      .sort((a, b) => a.categoria === b.categoria ? a.orden - b.orden : a.categoria.localeCompare(b.categoria))
      .map((item) => {
        const saved = savedRows.get(item.id);
        return {
          item,
          incluir: saved?.incluir ?? false,
          descripcion: saved?.descripcion ?? item.nombre,
          imagePath: saved?.imagePath ?? "",
          imageUrl: saved?.imageUrl ?? "",
          lado: saved?.lado ?? "cliente",
        };
      });

    setRows(initial);
    setRowsReady(true);
  }, [items, savedDraft]);

  // Guarda automáticamente campos, selección, descripciones, lado y referencias de imágenes.
  useEffect(() => {
    if (!rowsReady) return;

    const draft: DraftState = {
      titulo,
      proy,
      cliente,
      sot,
      fecha,
      cid,
      contrata,
      rows: rows.map((r) => ({
        id: r.item.id,
        incluir: r.incluir,
        descripcion: r.descripcion,
        imagePath: r.imagePath,
        imageUrl: r.imageUrl,
        lado: r.lado,
      })),
    };

    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch (error) {
      console.error("No se pudo guardar el borrador local:", error);
    }
  }, [draftKey, rowsReady, rows, titulo, proy, cliente, sot, fecha, cid, contrata]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LOGOS_STORAGE_KEY,
        JSON.stringify({ logoIzq, logoIzqUrl, logoDer, logoDerUrl })
      );
    } catch (error) {
      console.error("No se pudieron guardar los logos:", error);
    }
  }, [logoIzq, logoIzqUrl, logoDer, logoDerUrl]);

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((previous) =>
      previous.map((row) =>
        row.item.id === id ? { ...row, ...patch } : row
      )
    );
  }

  const categorias = Array.from(new Set(rows.map((r) => r.item.categoria)));

  function allChecked(categoria?: string) {
    const subset = categoria
      ? rows.filter((r) => r.item.categoria === categoria)
      : rows;
    return subset.length > 0 && subset.every((r) => r.incluir);
  }

  function toggleAll(categoria: string | undefined, value: boolean) {
    setRows((previous) =>
      previous.map((row) =>
        !categoria || row.item.categoria === categoria
          ? { ...row, incluir: value }
          : row
      )
    );
  }

  function onDragStart(id: string) {
    setDragId(id);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  async function onDrop(targetId: string, categoria: string) {
    if (!dragId || dragId === targetId) return;

    const categoryRows = rows.filter((r) => r.item.categoria === categoria);
    const fromIndex = categoryRows.findIndex((r) => r.item.id === dragId);
    const toIndex = categoryRows.findIndex((r) => r.item.id === targetId);

    if (fromIndex < 0 || toIndex < 0) {
      setDragId(null);
      return;
    }

    const reordered = [...categoryRows];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const withNewOrder = reordered.map((row, index) => ({
      ...row,
      item: { ...row.item, orden: (index + 1) * 10 },
    }));

    setRows((previous) => {
      const otherRows = previous.filter((r) => r.item.categoria !== categoria);
      return [...otherRows, ...withNewOrder].sort((a, b) =>
        a.item.categoria === b.item.categoria
          ? a.item.orden - b.item.orden
          : a.item.categoria.localeCompare(b.item.categoria)
      );
    });

    try {
      await Promise.all(
        withNewOrder.map((row) =>
          api.put(`/photos/items/${row.item.id}`, {
            categoria: row.item.categoria,
            nombre: row.item.nombre,
            orden: row.item.orden,
          })
        )
      );
    } catch (error) {
      console.error("No se pudo guardar el nuevo orden de los ítems:", error);
      alert("Se reordenó la lista en pantalla, pero no se pudo guardar el orden en el servidor.");
    }
    setDragId(null);
  }

  async function generate() {
    const selected = rows.filter((r) => r.incluir);
    if (selected.length === 0) {
      alert("Marca al menos un ítem.");
      return;
    }

    const withoutImage = selected.filter((r) => !r.imagePath);
    if (
      withoutImage.length > 0 &&
      !confirm(`${withoutImage.length} ítem(s) sin foto todavía. ¿Generar de todas formas?`)
    ) {
      return;
    }

    const payloadItems = selected.map((r, index) => ({
      numero: index + 1,
      descripcion: r.descripcion,
      image_path: r.imagePath || null,
      lado: r.lado,
    }));

    setGenerating(true);
    try {
      const { data } = await api.post("/photos/pdf", {
        titulo,
        proy,
        cliente,
        sot,
        fecha,
        cid,
        contrata,
        logo_izq_path: logoIzq || null,
        logo_der_path: logoDer || null,
        items: payloadItems,
      });
      setPdfUrl(data.url);
    } catch (error) {
      console.error("Error al generar el PDF:", error);
      alert("No se pudo generar el PDF. Revisa la conexión con el servidor e inténtalo nuevamente.");
    } finally {
      setGenerating(false);
    }
  }

  function clearLogo(side: "izq" | "der") {
    if (side === "izq") {
      setLogoIzq("");
      setLogoIzqUrl("");
    } else {
      setLogoDer("");
      setLogoDerUrl("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="label">Título</label>
          <input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </div>
        <div>
          <label className="label">PROY</label>
          <input className="input" value={proy} onChange={(e) => setProy(e.target.value)} />
        </div>
        <div>
          <label className="label">CLIENTE</label>
          <input className="input" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </div>
        <div>
          <label className="label">SOT</label>
          <input className="input" value={sot} onChange={(e) => setSot(e.target.value)} />
        </div>
        <div>
          <label className="label">FECHA</label>
          <input className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div>
          <label className="label">CID</label>
          <input className="input" value={cid} onChange={(e) => setCid(e.target.value)} />
        </div>
        <div>
          <label className="label">CONTRATA</label>
          <input className="input" value={contrata} onChange={(e) => setContrata(e.target.value)} />
        </div>

        <div>
          <p className="label">Logo izquierda (empresa)</p>
          <ImageUpload
            initialUrl={logoIzqUrl}
            onUploaded={(path, url) => {
              setLogoIzq(path);
              if (url) setLogoIzqUrl(url);
            }}
          />
          {logoIzq && (
            <button type="button" className="btn-secondary mt-2 text-xs" onClick={() => clearLogo("izq")}>
              Quitar logo
            </button>
          )}
        </div>
        <div>
          <p className="label">Logo derecha (Claro)</p>
          <ImageUpload
            initialUrl={logoDerUrl}
            onUploaded={(path, url) => {
              setLogoDer(path);
              if (url) setLogoDerUrl(url);
            }}
          />
          {logoDer && (
            <button type="button" className="btn-secondary mt-2 text-xs" onClick={() => clearLogo("der")}>
              Quitar logo
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={allChecked()} onChange={(e) => toggleAll(undefined, e.target.checked)} />
          Seleccionar todo
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-slate-500">
          {items.length === 0
            ? "Cargando ítems o no hay descripciones configuradas en el servidor."
            : "Preparando las fotografías..."}
        </div>
      ) : (
        <div className="space-y-4">
          {categorias.map((categoria) => (
            <div key={categoria} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-bold text-brand-700 uppercase">{categoria}</h3>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={allChecked(categoria)}
                    onChange={(e) => toggleAll(categoria, e.target.checked)}
                  />
                  Seleccionar sección
                </label>
              </div>

              <div className="space-y-2">
                {rows
                  .filter((r) => r.item.categoria === categoria)
                  .map((r) => (
                    <div
                      key={r.item.id}
                      draggable
                      onDragStart={() => onDragStart(r.item.id)}
                      onDragOver={onDragOver}
                      onDrop={() => void onDrop(r.item.id, categoria)}
                      className={`border rounded-lg p-3 flex items-center gap-3 flex-wrap cursor-move transition-colors ${
                        dragId === r.item.id ? "opacity-50" : "border-slate-200"
                      }`}
                    >
                      <span className="text-slate-400 select-none" title="Arrastra para reordenar">⠿</span>
                      <input
                        type="checkbox"
                        checked={r.incluir}
                        onChange={(e) => updateRow(r.item.id, { incluir: e.target.checked })}
                      />
                      <input
                        aria-label="Descripción de la fotografía"
                        className="input flex-1 min-w-[220px]"
                        value={r.descripcion}
                        onChange={(e) => updateRow(r.item.id, { descripcion: e.target.value })}
                      />
                      <select
                        className="input w-32"
                        value={r.lado}
                        onChange={(e) => updateRow(r.item.id, { lado: e.target.value as Lado })}
                      >
                        <option value="site">SITE</option>
                        <option value="pdi">PDI</option>
                        <option value="pop">POP</option>
                        <option value="cliente">CLIENTE</option>
                      </select>
                      <div className="min-w-[220px]">
                        <ImageUpload
                          compact
                          initialUrl={r.imageUrl}
                          onUploaded={(path, url) =>
                            updateRow(r.item.id, {
                              imagePath: path,
                              imageUrl: url || "",
                            })
                          }
                        />
                      </div>
                      {r.imagePath && (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => setEditing(r)}
                        >
                          Editar (líneas punteadas)
                        </button>
                      )}
                      {r.imagePath && (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => updateRow(r.item.id, { imagePath: "", imageUrl: "" })}
                        >
                          Quitar foto
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="btn-primary" onClick={() => void generate()} disabled={generating}>
        {generating ? "Generando PDF..." : "Generar PDF"}
      </button>

      {pdfUrl && (
        <div className="card">
          <p className="text-sm text-green-700 mb-2">PDF generado correctamente.</p>
          <a className="btn-primary" href={pdfUrl} target="_blank" rel="noreferrer">
            Descargar PDF
          </a>
        </div>
      )}

      {editing && (
        <ImageAnnotator
          imageUrl={editing.imageUrl}
          onClose={() => setEditing(null)}
          onSaved={(path, url) => {
            updateRow(editing.item.id, { imagePath: path, imageUrl: url });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

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
  const [orden, setOrden] = useState(10);
  const [saving, setSaving] = useState(false);

  function select(item: PhotoItem) {
    setSelected(item);
    setCategoria(item.categoria);
    setNombre(item.nombre);
    setOrden(item.orden);
  }

  function clear() {
    setSelected(null);
    setCategoria("");
    setNombre("");
    setOrden(10);
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

    const payload = {
      categoria: categoria.trim(),
      nombre: nombre.trim(),
      orden: Number(orden),
    };

    setSaving(true);
    try {
      if (selected) {
        await api.put(`/photos/items/${selected.id}`, payload);
      } else {
        await api.post("/photos/items", payload);
      }
      clear();
      onChange();
    } catch (error) {
      console.error("No se pudo guardar el ítem:", error);
      alert("No se pudo guardar la descripción. Revisa la conexión con el servidor.");
    } finally {
      setSaving(false);
    }
  }

  async function del(item: PhotoItem) {
    if (!confirm(`¿Eliminar '${item.nombre}'?`)) return;
    try {
      await api.delete(`/photos/items/${item.id}`);
      clear();
      onChange();
    } catch (error) {
      console.error("No se pudo eliminar el ítem:", error);
      alert("No se pudo eliminar la descripción.");
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <div className="space-y-3">
        <div className="card p-0 divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => select(item)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                selected?.id === item.id ? "bg-brand-50" : ""
              }`}
            >
              <div className="font-medium text-slate-700">{item.nombre}</div>
              <div className="text-xs text-slate-400">
                [{item.categoria}] orden {item.orden}
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
            <option value="EQUIPOS INSTALADOS ACCESO" />
            <option value="ETIQUETADO" />
            <option value="RECORRIDO EN ACCESO" />
            <option value="VISTA GENERAL UBICACION DE EQUIPOS" />
            <option value="EQUIPOS LADO CLIENTE" />
            <option value="ETIQUETADO CLIENTE" />
            <option value="VISTA INSTALACION EN GABINETE" />
            <option value="RECORRIDO CLIENTE" />
            <option value="VISTA INSTALACION DE EQUIPOS" />
            <option value="MULTIMETRO" />
            <option value="QR" />
          </datalist>
        </div>
        <div>
          <label className="label">Descripción</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div>
          <label className="label">Orden</label>
          <input
            className="input"
            type="number"
            value={orden}
            onChange={(e) => setOrden(Number(e.target.value))}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </button>
          {selected && (
            <button className="btn-danger" onClick={() => void del(selected)}>
              Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
