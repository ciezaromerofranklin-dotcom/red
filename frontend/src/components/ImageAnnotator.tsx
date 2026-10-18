import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

interface Props {
  imageUrl: string;
  onClose: () => void;
  onSaved: (path: string, url: string) => void;
}

type Point = {
  x: number;
  y: number;
};

type TextItem = {
  id: number;
  text: string;
  x: number;
  y: number;
  size: number;
};

type Tool = "line" | "text";

const MAX_CANVAS_W = 820;
const MAX_CANVAS_H = 560;

export default function ImageAnnotator({
  imageUrl,
  onClose,
  onSaved,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [lines, setLines] = useState<Point[][]>([]);
  const [current, setCurrent] = useState<Point[]>([]);

  const [texts, setTexts] = useState<TextItem[]>([]);
  const [textInput, setTextInput] = useState("");
  const [textSize, setTextSize] = useState(28);

  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);

  const [tool, setTool] = useState<Tool>("line");

  useEffect(() => {
    const img = new Image();

    img.crossOrigin = "anonymous";

    img.onload = () => {
      imgRef.current = img;

      const scaleW = MAX_CANVAS_W / img.width;
      const scaleH = MAX_CANVAS_H / img.height;

      const s = Math.min(1, scaleW, scaleH);

      setScale(s);

      const canvas = canvasRef.current;

      if (!canvas) return;

      canvas.width = Math.round(img.width * s);
      canvas.height = Math.round(img.height * s);

      redraw([], [], s, img, []);
    };

    img.src = imageUrl;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  function redraw(
    allLines: Point[][],
    curLine: Point[],
    s = scale,
    img = imgRef.current,
    allTexts = texts
  ) {
    const canvas = canvasRef.current;

    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Imagen original
    ctx.drawImage(
      img,
      0,
      0,
      canvas.width,
      canvas.height
    );

    // =========================
    // LÍNEAS
    // =========================

    ctx.strokeStyle = "#f60707";
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 8]);
    ctx.lineCap = "round";

    for (const line of [...allLines, curLine]) {
      if (line.length < 2) continue;

      ctx.beginPath();

      ctx.moveTo(
        line[0].x * s,
        line[0].y * s
      );

      for (const p of line.slice(1)) {
        ctx.lineTo(
          p.x * s,
          p.y * s
        );
      }

      ctx.stroke();
    }

    ctx.setLineDash([]);

    // Puntos de la línea actual
    ctx.fillStyle = "#fa0e0e";

    for (const p of curLine) {
      ctx.beginPath();

      ctx.arc(
        p.x * s,
        p.y * s,
        3,
        0,
        Math.PI * 2
      );

      ctx.fill();
    }

    // =========================
    // TEXTOS
    // =========================

    for (const item of allTexts) {
      ctx.save();

      ctx.font = `bold ${item.size * s}px Arial`;
      ctx.textBaseline = "top";

      // Fondo negro semitransparente
      const metrics = ctx.measureText(item.text);

      const padding = 8 * s;

      const width = metrics.width + padding * 2;
      const height = item.size * s + padding * 2;

      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";

      ctx.fillRect(
        item.x * s - padding,
        item.y * s - padding,
        width,
        height
      );

      // Texto
      ctx.fillStyle = "#ffffff";

      ctx.fillText(
        item.text,
        item.x * s,
        item.y * s
      );

      ctx.restore();
    }
  }

  // =========================
  // CLICK EN CANVAS
  // =========================

  function handleClick(
    e: React.MouseEvent<HTMLCanvasElement>
  ) {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    // Si el canvas se ve más chico que su tamaño real (pantallas angostas,
    // CSS max-w-full), hay que compensar o los puntos salen desplazados.
    const x =
      ((e.clientX - rect.left) * (canvas.width / rect.width)) / scale;

    const y =
      ((e.clientY - rect.top) * (canvas.height / rect.height)) / scale;

    // =========================
    // HERRAMIENTA TEXTO
    // =========================

    if (tool === "text") {
      if (!textInput.trim()) {
        alert("Escribe un texto primero.");
        return;
      }

      const newText: TextItem = {
        id: Date.now(),
        text: textInput.trim(),
        x,
        y,
        size: textSize,
      };

      const nextTexts = [
        ...texts,
        newText,
      ];

      setTexts(nextTexts);

      redraw(
        lines,
        current,
        scale,
        imgRef.current,
        nextTexts
      );

      return;
    }

    // =========================
    // HERRAMIENTA LÍNEA
    // =========================

    const next = [
      ...current,
      {
        x,
        y,
      },
    ];

    setCurrent(next);

    redraw(
      lines,
      next,
      scale,
      imgRef.current,
      texts
    );
  }

  // =========================
  // TERMINAR LÍNEA
  // =========================

  function finishLine() {
    if (current.length < 2) {
      setCurrent([]);
      redraw(
        lines,
        [],
        scale,
        imgRef.current,
        texts
      );
      return;
    }

    const allLines = [
      ...lines,
      current,
    ];

    setLines(allLines);

    setCurrent([]);

    redraw(
      allLines,
      [],
      scale,
      imgRef.current,
      texts
    );
  }

  // =========================
  // DESHACER PUNTO
  // =========================

  function undoPoint() {
    const next = current.slice(
      0,
      -1
    );

    setCurrent(next);

    redraw(
      lines,
      next,
      scale,
      imgRef.current,
      texts
    );
  }

  // =========================
  // LIMPIAR TODO
  // =========================

  function clearAll() {
    setLines([]);
    setCurrent([]);
    setTexts([]);

    redraw(
      [],
      [],
      scale,
      imgRef.current,
      []
    );
  }

  // =========================
  // ELIMINAR ÚLTIMO TEXTO
  // =========================

  function undoText() {
    if (texts.length === 0) return;

    const nextTexts = texts.slice(
      0,
      -1
    );

    setTexts(nextTexts);

    redraw(
      lines,
      current,
      scale,
      imgRef.current,
      nextTexts
    );
  }

  // =========================
  // GUARDAR
  // =========================

  async function save() {
    // Si hay una línea incompleta,
    // la terminamos antes de guardar.
    let finalLines = lines;

    if (current.length >= 2) {
      finalLines = [
        ...lines,
        current,
      ];
    }

    setSaving(true);

    try {
      await new Promise((r) =>
        setTimeout(r, 50)
      );

      redraw(
        finalLines,
        [],
        scale,
        imgRef.current,
        texts
      );

      const canvas =
        canvasRef.current;

      if (!canvas) {
        throw new Error(
          "No se encontró el canvas."
        );
      }

      const blob: Blob =
        await new Promise((resolve) =>
          canvas.toBlob(
            (b) =>
              resolve(
                b as Blob
              ),
            "image/png"
          )
        );

      const form =
        new FormData();

      form.append(
        "file",
        blob,
        "editada.png"
      );

      const { data } =
        await api.post(
          "/files/upload",
          form,
          {
            headers: {
              "Content-Type":
                "multipart/form-data",
            },
          }
        );

      onSaved(
        data.path,
        data.url
      );

      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-3 sm:p-6">

      <div
        className="
          bg-white
          rounded-xl
          shadow-2xl
          w-full
          max-w-5xl
          max-h-[95vh]
          flex
          flex-col
          overflow-hidden
        "
      >

        {/* ========================= */}
        {/* CABECERA */}
        {/* ========================= */}

        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">

          <div>
            <h3 className="font-semibold text-slate-800">
              Editar imagen
            </h3>

            <p className="text-xs text-slate-500 mt-1">
              Marca el recorrido o agrega textos sobre la imagen.
            </p>
          </div>

          <button
            onClick={onClose}
            className="
              w-9
              h-9
              rounded-lg
              flex
              items-center
              justify-center
              text-slate-400
              hover:bg-slate-100
              hover:text-slate-700
              text-xl
            "
          >
            ✕
          </button>

        </div>

        {/* ========================= */}
        {/* HERRAMIENTAS */}
        {/* ========================= */}

        <div className="px-5 py-3 border-b border-slate-200 shrink-0">

          <div className="flex flex-wrap items-center gap-2">

            {/* Línea */}

            <button
              type="button"
              onClick={() => setTool("line")}
              className={
                tool === "line"
                  ? "btn-primary"
                  : "btn-secondary"
              }
            >
              ✏️ Marcar recorrido
            </button>

            {/* Texto */}

            <button
              type="button"
              onClick={() => setTool("text")}
              className={
                tool === "text"
                  ? "btn-primary"
                  : "btn-secondary"
              }
            >
              🔤 Agregar texto
            </button>

            {/* Tamaño */}

            {tool === "text" && (
              <>
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) =>
                    setTextInput(
                      e.target.value
                    )
                  }
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter"
                    ) {
                      setTool("text");
                    }
                  }}
                  placeholder="Escribe el texto..."
                  className="input w-48"
                />

                <select
                  value={textSize}
                  onChange={(e) =>
                    setTextSize(
                      Number(
                        e.target.value
                      )
                    )
                  }
                  className="input w-24"
                >
                  <option value={18}>
                    18 px
                  </option>

                  <option value={24}>
                    24 px
                  </option>

                  <option value={28}>
                    28 px
                  </option>

                  <option value={36}>
                    36 px
                  </option>

                  <option value={44}>
                    44 px
                  </option>

                  <option value={56}>
                    56 px
                  </option>
                </select>

                <span className="text-xs text-slate-500">
                  Luego haz clic sobre la imagen.
                </span>
              </>
            )}

          </div>

        </div>

        {/* ========================= */}
        {/* IMAGEN */}
        {/* ========================= */}

        <div
          className="
            flex-1
            min-h-0
            overflow-auto
            bg-slate-100
            p-3
            flex
            items-center
            justify-center
          "
        >

          <div
            className="
              border
              border-slate-300
              rounded-lg
              overflow-hidden
              shadow-sm
              bg-white
              max-w-full
            "
          >
            <canvas
              ref={canvasRef}
              onClick={handleClick}
              className="
                block
                max-w-full
                h-auto
                cursor-crosshair
              "
            />
          </div>

        </div>

        {/* ========================= */}
        {/* CONTROLES */}
        {/* ========================= */}

        <div className="px-5 py-3 border-t border-slate-200 shrink-0">

          <div className="flex flex-wrap gap-2">

            {tool === "line" && (
              <>
                <button
                  className="btn-secondary"
                  onClick={finishLine}
                >
                  ✓ Terminar línea
                </button>

                <button
                  className="btn-secondary"
                  onClick={undoPoint}
                  disabled={
                    current.length === 0
                  }
                >
                  ↶ Deshacer punto
                </button>
              </>
            )}

            {tool === "text" && (
              <button
                className="btn-secondary"
                onClick={undoText}
                disabled={
                  texts.length === 0
                }
              >
                ↶ Eliminar último texto
              </button>
            )}

            <button
              className="btn-secondary"
              onClick={clearAll}
            >
              🗑 Limpiar todo
            </button>

            <div className="flex-1" />

            <button
              className="btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>

            <button
              className="btn-primary"
              disabled={saving}
              onClick={save}
            >
              {saving
                ? "Guardando..."
                : "💾 Guardar imagen editada"}
            </button>

          </div>

        </div>

      </div>

    </div>
  );
}