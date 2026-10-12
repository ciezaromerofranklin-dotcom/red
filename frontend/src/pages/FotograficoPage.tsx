import { useEffect, useState } from "react";
import { api } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import ImageAnnotator from "../components/ImageAnnotator";
import type { PhotoItem } from "../types";

type Lado = "site" | "pdi" | "pop" | "cliente";

type RowState = {
  item: PhotoItem;
  incluir: boolean;
  descripcion: string;
  imagePath: string;
  imageUrl: string;
  lado: Lado;
};

export default function FotograficoPage() {
  const [tab, setTab] = useState<"run" | "items">("run");
  const [items, setItems] = useState<PhotoItem[]>([]);

  useEffect(() => {
    reload();
  }, []);

  function reload() {
    api.get("/photos/items").then((r) => setItems(r.data));
  }

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

      {tab === "run" ? (
        <RunTab items={items} />
      ) : (
        <ItemsTab items={items} onChange={reload} />
      )}
    </div>
  );
}

function RunTab({ items }: { items: PhotoItem[] }) {
  const [rows, setRows] = useState<RowState[]>([]);

  // TÍTULO CORREGIDO
  const [titulo, setTitulo] = useState(
    "REPORTE FOTOGRAFICO INSTALACION DE FIBRA"
  );

  const [proy, setProy] = useState("");
  const [cliente, setCliente] = useState("");
  const [sot, setSot] = useState("");
  const [fecha, setFecha] = useState(
    new Date().toLocaleDateString("es-PE")
  );
  const [cid, setCid] = useState("");
  const [contrata, setContrata] = useState("");
  const [logoIzq, setLogoIzq] = useState("");
  const [logoDer, setLogoDer] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<RowState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    setRows(
      items.map((item) => ({
        item,
        incluir: false,
        descripcion: item.nombre,
        imagePath: "",
        imageUrl: "",
        lado: "cliente",
      }))
    );
  }, [items]);

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) =>
      prev.map((r) =>
        r.item.id === id
          ? { ...r, ...patch }
          : r
      )
    );
  }

  const categorias = Array.from(
    new Set(rows.map((r) => r.item.categoria))
  );

  function allChecked(cat?: string) {
    const subset = cat
      ? rows.filter((r) => r.item.categoria === cat)
      : rows;

    return (
      subset.length > 0 &&
      subset.every((r) => r.incluir)
    );
  }

  function toggleAll(
    cat: string | undefined,
    value: boolean
  ) {
    setRows((prev) =>
      prev.map((r) =>
        !cat || r.item.categoria === cat
          ? { ...r, incluir: value }
          : r
      )
    );
  }

  function onDragStart(id: string) {
    setDragId(id);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function onDrop(
    targetId: string,
    cat: string
  ) {
    if (!dragId || dragId === targetId) return;

    setRows((prev) => {
      const catRows = prev.filter(
        (r) => r.item.categoria === cat
      );

      const others = prev.filter(
        (r) => r.item.categoria !== cat
      );

      const fromIdx = catRows.findIndex(
        (r) => r.item.id === dragId
      );

      const toIdx = catRows.findIndex(
        (r) => r.item.id === targetId
      );

      if (fromIdx === -1 || toIdx === -1) {
        return prev;
      }

      const reordered = [...catRows];

      const [moved] = reordered.splice(
        fromIdx,
        1
      );

      reordered.splice(
        toIdx,
        0,
        moved
      );

      reordered.forEach((r, i) => {
        const nuevoOrden = (i + 1) * 10;

        if (nuevoOrden !== r.item.orden) {
          api
            .put(`/photos/items/${r.item.id}`, {
              categoria: r.item.categoria,
              nombre: r.item.nombre,
              orden: nuevoOrden,
            })
            .catch(() => {});

          r.item.orden = nuevoOrden;
        }
      });

      return [
        ...others,
        ...reordered,
      ].sort((a, b) =>
        a.item.categoria === b.item.categoria
          ? a.item.orden - b.item.orden
          : 0
      );
    });

    setDragId(null);
  }

  async function generate() {
    const selected = rows.filter(
      (r) => r.incluir
    );

    if (selected.length === 0) {
      alert("Marca al menos un ítem.");
      return;
    }

    const sinImagen = selected.filter(
      (r) => !r.imagePath
    );

    if (
      sinImagen.length > 0 &&
      !confirm(
        `${sinImagen.length} ítem(s) sin foto todavía. ¿Generar de todas formas?`
      )
    ) {
      return;
    }

    const payloadItems = selected.map(
      (r, i) => ({
        numero: i + 1,
        descripcion: r.descripcion,
        image_path: r.imagePath || null,
        lado: r.lado,
      })
    );

    const { data } = await api.post(
      "/photos/pdf",
      {
        titulo,
        proy,
        cliente,
        sot,
        fecha,
        cid,
        contrata,
        logo_izq_path:
          logoIzq || null,
        logo_der_path:
          logoDer || null,
        items: payloadItems,
      }
    );

    setPdfUrl(data.url);
  }

  return (
    <div className="space-y-6">
      <div className="card grid grid-cols-2 gap-3">

        {/* TÍTULO */}
        <div className="col-span-2">
          <label className="label">
            Título
          </label>

          <input
            className="input"
            value={titulo}
            onChange={(e) =>
              setTitulo(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            PROY
          </label>

          <input
            className="input"
            value={proy}
            onChange={(e) =>
              setProy(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            CLIENTE
          </label>

          <input
            className="input"
            value={cliente}
            onChange={(e) =>
              setCliente(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            SOT
          </label>

          <input
            className="input"
            value={sot}
            onChange={(e) =>
              setSot(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            FECHA
          </label>

          <input
            className="input"
            value={fecha}
            onChange={(e) =>
              setFecha(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            CID
          </label>

          <input
            className="input"
            value={cid}
            onChange={(e) =>
              setCid(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            CONTRATA
          </label>

          <input
            className="input"
            value={contrata}
            onChange={(e) =>
              setContrata(e.target.value)
            }
          />
        </div>

        <div>
          <p className="label">
            Logo izquierda (empresa)
          </p>

          <ImageUpload
            onUploaded={(p) =>
              setLogoIzq(p)
            }
          />
        </div>

        <div>
          <p className="label">
            Logo derecha (Claro)
          </p>

          <ImageUpload
            onUploaded={(p) =>
              setLogoDer(p)
            }
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={allChecked()}
            onChange={(e) =>
              toggleAll(
                undefined,
                e.target.checked
              )
            }
          />

          Seleccionar todo
        </label>
      </div>

      <div className="space-y-4">
        {categorias.map((cat) => (
          <div
            key={cat}
            className="card"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-brand-700 uppercase">
                {cat}
              </h3>

              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={allChecked(cat)}
                  onChange={(e) =>
                    toggleAll(
                      cat,
                      e.target.checked
                    )
                  }
                />

                Seleccionar sección
              </label>
            </div>

            <div className="space-y-2">
              {rows
                .filter(
                  (r) =>
                    r.item.categoria === cat
                )
                .map((r) => (
                  <div
                    key={r.item.id}
                    draggable
                    onDragStart={() =>
                      onDragStart(
                        r.item.id
                      )
                    }
                    onDragOver={onDragOver}
                    onDrop={() =>
                      onDrop(
                        r.item.id,
                        cat
                      )
                    }
                    className={`border rounded-lg p-3 flex items-center gap-3 flex-wrap cursor-move transition-colors ${
                      dragId === r.item.id
                        ? "opacity-50"
                        : "border-slate-100"
                    }`}
                  >
                    <span
                      className="text-slate-300 select-none"
                      title="Arrastra para reordenar"
                    >
                      ⠿
                    </span>

                    <input
                      type="checkbox"
                      checked={r.incluir}
                      onChange={(e) =>
                        updateRow(
                          r.item.id,
                          {
                            incluir:
                              e.target.checked,
                          }
                        )
                      }
                    />

                    <input
                      className="input flex-1 min-w-[220px]"
                      value={r.descripcion}
                      onChange={(e) =>
                        updateRow(
                          r.item.id,
                          {
                            descripcion:
                              e.target.value,
                          }
                        )
                      }
                    />

                    <select
                      className="input w-32"
                      value={r.lado}
                      onChange={(e) =>
                        updateRow(
                          r.item.id,
                          {
                            lado:
                              e.target
                                .value as Lado,
                          }
                        )
                      }
                    >
                      <option value="site">
                        SITE
                      </option>

                      <option value="pdi">
                        PDI
                      </option>

                      <option value="pop">
                        POP
                      </option>

                      <option value="cliente">
                        CLIENTE
                      </option>
                    </select>

                    <ImageUpload
                      compact
                      initialUrl={r.imageUrl}
                      onUploaded={(
                        p,
                        u
                      ) =>
                        updateRow(
                          r.item.id,
                          {
                            imagePath: p,
                            imageUrl: u,
                          }
                        )
                      }
                    />

                    {r.imagePath && (
                      <button
                        className="btn-secondary text-xs"
                        onClick={() =>
                          setEditing(r)
                        }
                      >
                        ✏️ Editar (líneas punteadas)
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn-primary"
        onClick={generate}
      >
        Generar PDF
      </button>

      {pdfUrl && (
        <div className="card bg-green-50 border-green-200">
          <p className="text-sm text-green-700 mb-2">
            PDF generado correctamente.
          </p>

          <a
            className="btn-primary"
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
          >
            Descargar PDF
          </a>
        </div>
      )}

      {editing && (
        <ImageAnnotator
          imageUrl={editing.imageUrl}
          onClose={() =>
            setEditing(null)
          }
          onSaved={(p, u) =>
            updateRow(
              editing.item.id,
              {
                imagePath: p,
                imageUrl: u,
              }
            )
          }
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
  const [selected, setSelected] =
    useState<PhotoItem | null>(null);

  const [categoria, setCategoria] =
    useState("");

  const [nombre, setNombre] =
    useState("");

  const [orden, setOrden] =
    useState(10);

  function select(it: PhotoItem) {
    setSelected(it);
    setCategoria(it.categoria);
    setNombre(it.nombre);
    setOrden(it.orden);
  }

  function clear() {
    setSelected(null);
    setCategoria("");
    setNombre("");
    setOrden(10);
  }

  async function save() {
    if (!nombre.trim()) {
      alert(
        "Escribe la descripción."
      );
      return;
    }

    if (!categoria.trim()) {
      alert(
        "Escribe la categoría."
      );
      return;
    }

    const payload = {
      categoria: categoria.trim(),
      nombre: nombre.trim(),
      orden: Number(orden),
    };

    if (selected) {
      await api.put(
        `/photos/items/${selected.id}`,
        payload
      );
    } else {
      await api.post(
        "/photos/items",
        payload
      );
    }

    clear();
    onChange();
  }

  async function del(it: PhotoItem) {
    if (
      !confirm(
        `¿Eliminar '${it.nombre}'?`
      )
    ) {
      return;
    }

    await api.delete(
      `/photos/items/${it.id}`
    );

    clear();
    onChange();
  }

  return (
    <div className="grid grid-cols-[320px_1fr] gap-6">
      <div className="space-y-3">

        <div className="card p-0 divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() =>
                select(it)
              }
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                selected?.id === it.id
                  ? "bg-brand-50"
                  : ""
              }`}
            >
              <div className="font-medium text-slate-700">
                {it.nombre}
              </div>

              <div className="text-xs text-slate-400">
                [{it.categoria}] orden{" "}
                {it.orden}
              </div>
            </button>
          ))}
        </div>

        <button
          className="btn-secondary w-full"
          onClick={clear}
        >
          + Nueva descripción
        </button>
      </div>

      <div className="card space-y-4">

        <div>
          <label className="label">
            Categoría
          </label>

          <input
            className="input"
            value={categoria}
            onChange={(e) =>
              setCategoria(
                e.target.value
              )
            }
            list="categorias-list"
          />

          {/* CATEGORÍAS NUEVAS */}
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
          <label className="label">
            Descripción
          </label>

          <input
            className="input"
            value={nombre}
            onChange={(e) =>
              setNombre(
                e.target.value
              )
            }
          />
        </div>

        <div>
          <label className="label">
            Orden
          </label>

          <input
            className="input"
            type="number"
            value={orden}
            onChange={(e) =>
              setOrden(
                Number(e.target.value)
              )
            }
          />
        </div>

        <div className="flex gap-2">
          <button
            className="btn-primary"
            onClick={save}
          >
            💾 Guardar
          </button>

          {selected && (
            <button
              className="btn-danger"
              onClick={() =>
                del(selected)
              }
            >
              🗑 Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
