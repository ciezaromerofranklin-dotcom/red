import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { getPlace, stampImage, stampLines } from "../utils/photoStamp";

interface Props {
  onUploaded: (path: string, url: string) => void;
  label?: string;
  compact?: boolean;
  initialUrl?: string;
  /** Cliente que se imprime en el sello de las fotos tomadas con la cámara. */
  cliente?: string;
  /** Muestra el botón «Tomar foto» (cámara con fecha, hora y ubicación). */
  camera?: boolean;
}

export default function ImageUpload({ onUploaded, label = "Subir imagen...", compact = false, initialUrl, cliente = "", camera = true }: Props) {
  const [preview, setPreview] = useState<string | null>(initialUrl || null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [stamping, setStamping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<string | null>(null);

  // Si quien nos usa cambia la imagen (p. ej. al guardar la versión editada
  // con líneas/texto), la vista previa debe mostrar la nueva, no la anterior.
  useEffect(() => {
    setPreview(initialUrl || null);
  }, [initialUrl]);

  // Libera la URL temporal de la última vista previa al desmontar.
  useEffect(() => {
    return () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    };
  }, []);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;

    const previous = preview;
    const blobUrl = URL.createObjectURL(file);
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = blobUrl;

    setLoading(true);
    setPreview(blobUrl);

    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/files/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploaded(data.path, data.url);
    } catch {
      // No se subió: se vuelve a la imagen anterior para no mostrar una foto
      // que en realidad no está en el servidor (y no saldría en el PDF).
      setPreview(previous);
      alert("No se pudo subir la imagen. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  /** Foto de la cámara: se le imprime cliente, fecha/hora, dirección y coordenadas. */
  async function handleCamera(file: File) {
    if (!file.type.startsWith("image/")) return;
    setStamping(true);
    try {
      const when = new Date();
      const place = await getPlace();
      const stamped = await stampImage(file, stampLines(cliente, place, when));
      setStamping(false);
      await handleFile(stamped);
    } catch {
      setStamping(false);
      await handleFile(file); // si falla el sello, se sube la foto tal cual
    }
  }

  function clear() {
    setPreview(null);
    onUploaded("", "");
    if (inputRef.current) inputRef.current.value = "";
  }

  function handlePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) {
      const file = item.getAsFile();
      if (file) handleFile(file);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div
      className={`flex items-center gap-2 ${compact ? "" : "flex-col items-start"}`}
      onPaste={handlePaste}
      tabIndex={0}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-2">
        <div
          className={`rounded-lg border-2 border-dashed flex items-center justify-center overflow-hidden bg-slate-50 transition-colors ${
            dragOver ? "border-brand-500 bg-brand-50" : "border-slate-300"
          } ${compact ? "w-12 h-12" : "w-20 h-20"}`}
          title="Puedes pegar (Ctrl+V) o arrastrar una imagen aquí"
        >
          {preview ? (
            <img src={preview} alt="" className="object-cover w-full h-full" />
          ) : (
            <span className="text-slate-300 text-[10px] text-center px-1">arrastra o pega</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="btn-secondary cursor-pointer text-xs">
            {loading ? "Subiendo..." : label}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                // permite volver a elegir el mismo archivo después
                e.target.value = "";
              }}
            />
          </label>
          {camera && (
            <label className="btn-secondary cursor-pointer text-xs" title="Toma la foto y le agrega fecha, hora, dirección y coordenadas">
              {stamping ? "Ubicando..." : "📷 Tomar foto"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={stamping || loading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleCamera(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {preview && (
            <button type="button" onClick={clear} className="text-xs text-red-500 hover:underline">
              quitar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
