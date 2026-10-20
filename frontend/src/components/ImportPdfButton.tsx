import { useRef, useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import Spinner from "./Spinner";

export interface ImportedProject {
  kind: "photo" | "pj";
  tipo?: string;
  state: unknown;
}

/** Abre un PDF generado por la app para volver a editarlo (fotos incluidas). */
export default function ImportPdfButton({
  onLoaded,
}: {
  onLoaded: (project: ImportedProject) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/photos/import-pdf", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onLoaded(data as ImportedProject);
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo abrir el PDF."));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
      />
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={() => input.current?.click()}
        title="Carga un PDF generado antes con esta aplicación para seguir editándolo"
      >
        {busy ? <><Spinner /> Abriendo PDF...</> : "📂 Abrir PDF para editar"}
      </button>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
