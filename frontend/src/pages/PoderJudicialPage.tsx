import { api, apiErrorMessage } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import LogoPicker from "../components/LogoPicker";
import Spinner from "../components/Spinner";
import { NO_LOGO, logoPayload } from "../logo";
import type { LogoSel } from "../logo";
import { usePersistentState } from "../store/persistentState";

interface Img { path: string; url: string }
interface Cell { id: string; caption: string; images: Img[] }
interface Section { id: string; title: string; cells: Cell[] }
interface Change { version: string; fecha: string; modificacion: string }

interface Form {
  lineas: string;          // texto de la portada, una línea por renglón
  subtitulo: string;
  version: string;
  periodo: string;
  cambios: Change[];
  sede: string;
  sot: string;
  direccion: string;
  coordenadas: string;
  fotoUbicacion: Img | null;
  sections: Section[];
  intro: string;
  conclusiones: string[];
}

type Result = { url: string; filename: string; pages: number; warnings: string[] };

const uid = () => Math.random().toString(36).slice(2, 10);
const newCell = (): Cell => ({ id: uid(), caption: "", images: [] });
const newSection = (title = ""): Section => ({ id: uid(), title, cells: [newCell(), newCell()] });

const INITIAL: Form = {
  lineas: "Informe de diseño\nLAN Gestionada SOLAMED\nPoder Judicial",
  subtitulo: "Implementación de Servicios Empresas\nDirección Mercado Corporativo\nGerencia de Implementación de Servicios Empresas",
  version: "1.0",
  periodo: "",
  cambios: [{ version: "1.0", fecha: "", modificacion: "-" }],
  sede: "",
  sot: "",
  direccion: "",
  coordenadas: "",
  fotoUbicacion: null,
  sections: [
    newSection("Equipos y Materiales Instalados en la Sede"),
    newSection("Instalación y Diseño en la Sede"),
    newSection("Etiquetado las Conexiones de Patchcord de FO en la Sede"),
  ],
  intro: "",
  conclusiones: [""],
};

export default function PoderJudicialPage() {
  const [f, setF] = usePersistentState<Form>("poderjudicial.form", INITIAL);
  const [logo, setLogo] = usePersistentState<LogoSel>("poderjudicial.logo", NO_LOGO);

  const mem = { persist: false };
  const [generating, setGenerating] = usePersistentState("poderjudicial.generating", false, mem);
  const [result, setResult] = usePersistentState<Result | null>("poderjudicial.result", null, mem);
  const [error, setError] = usePersistentState<string | null>("poderjudicial.error", null, mem);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const patchSection = (id: string, fn: (s: Section) => Section) =>
    setF((p) => ({ ...p, sections: p.sections.map((s) => (s.id === id ? fn(s) : s)) }));
  const patchCell = (sid: string, cid: string, fn: (c: Cell) => Cell) =>
    patchSection(sid, (s) => ({ ...s, cells: s.cells.map((c) => (c.id === cid ? fn(c) : c)) }));

  async function generate() {
    if (generating) return;
    setGenerating(true);
    setResult(null);
    setError(null);
    const lines = (t: string) => t.split("\n");
    try {
      const { data } = await api.post("/photos/pdf-pj", {
        portada_lineas: lines(f.lineas),
        subtitulo_lineas: lines(f.subtitulo),
        version: f.version,
        periodo: f.periodo,
        cambios: f.cambios,
        sede: f.sede,
        sot: f.sot,
        ubicacion_titulo: `Ubicación del Data Center de la Sede ${f.sede}`.trim(),
        direccion: f.direccion,
        coordenadas: f.coordenadas,
        foto_ubicacion: f.fotoUbicacion?.path ?? null,
        sections: f.sections.map((s) => ({
          title: s.title,
          cells: s.cells.map((c) => ({ caption: c.caption, images: c.images.map((i) => i.path) })),
        })),
        conclusiones_intro: f.intro,
        conclusiones: f.conclusiones.filter((c) => c.trim()),
        ...logoPayload(logo, "logo"),
      });
      setResult({
        url: data.url,
        filename: data.filename,
        pages: data.pages ?? 0,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      });
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo generar el PDF."));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Reporte Fotográfico — RF Poder Judicial</h2>
        <p className="text-slate-500 text-sm">Informe de diseño LAN Gestionada SOLAMED. Lo que escribas se conserva al cambiar de página.</p>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Portada</h3>
        <LogoPicker posicion="izq" label="Logo de la portada" value={logo} onChange={setLogo} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Título (una línea por renglón; renglón vacío = espacio)</label>
            <textarea className="input" rows={4} value={f.lineas} onChange={(e) => set("lineas", e.target.value)} />
          </div>
          <div>
            <label className="label">Dirección / gerencia</label>
            <textarea className="input" rows={4} value={f.subtitulo} onChange={(e) => set("subtitulo", e.target.value)} />
          </div>
          <div><label className="label">Versión</label><input className="input" value={f.version} onChange={(e) => set("version", e.target.value)} /></div>
          <div><label className="label">Periodo (ej. AGOSTO 2026)</label><input className="input" value={f.periodo} onChange={(e) => set("periodo", e.target.value)} /></div>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Control de cambios y sede</h3>
        {f.cambios.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2">
            {(["version", "fecha", "modificacion"] as const).map((k) => (
              <input key={k} className="input" placeholder={k} value={c[k]}
                onChange={(e) => set("cambios", f.cambios.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
            ))}
            <button className="btn-secondary" onClick={() => set("cambios", f.cambios.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn-secondary text-xs" onClick={() => set("cambios", [...f.cambios, { version: "", fecha: "", modificacion: "" }])}>+ Agregar cambio</button>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Nombre de sede</label><input className="input" value={f.sede} onChange={(e) => set("sede", e.target.value)} /></div>
          <div><label className="label">SOT (para el nombre del archivo)</label><input className="input" value={f.sot} onChange={(e) => set("sot", e.target.value)} /></div>
          <div><label className="label">Dirección</label><input className="input" value={f.direccion} onChange={(e) => set("direccion", e.target.value)} /></div>
          <div><label className="label">Coordenadas</label><input className="input" value={f.coordenadas} onChange={(e) => set("coordenadas", e.target.value)} /></div>
        </div>
        <div className="flex items-center gap-3">
          <span className="label mb-0">Foto de ubicación</span>
          <ImageUpload compact initialUrl={f.fotoUbicacion?.url}
            onUploaded={(path, url) => set("fotoUbicacion", { path, url })} />
        </div>
      </div>

      {f.sections.map((s) => (
        <div key={s.id} className="card space-y-3">
          <div className="flex gap-2">
            <input className="input flex-1 font-semibold" placeholder="Título de la sección" value={s.title}
              onChange={(e) => patchSection(s.id, (x) => ({ ...x, title: e.target.value }))} />
            <button className="btn-secondary" onClick={() => set("sections", f.sections.filter((x) => x.id !== s.id))}>Quitar sección</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {s.cells.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <textarea className="input" rows={2} placeholder="Texto sobre la foto" value={c.caption}
                  onChange={(e) => patchCell(s.id, c.id, (x) => ({ ...x, caption: e.target.value }))} />
                <div className="flex flex-wrap gap-2">
                  {c.images.map((im, k) => (
                    <div key={im.path} className="relative">
                      <img src={im.url} alt="" className="h-16 rounded border" />
                      <button className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1 text-[10px] text-white"
                        onClick={() => patchCell(s.id, c.id, (x) => ({ ...x, images: x.images.filter((_, j) => j !== k) }))}>✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <ImageUpload compact label="Agregar foto..." onUploaded={(path, url) =>
                    patchCell(s.id, c.id, (x) => ({ ...x, images: [...x.images, { path, url }] }))} />
                  <button className="text-xs text-red-600"
                    onClick={() => patchSection(s.id, (x) => ({ ...x, cells: x.cells.filter((y) => y.id !== c.id) }))}>Quitar celda</button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn-secondary text-xs" onClick={() => patchSection(s.id, (x) => ({ ...x, cells: [...x.cells, newCell()] }))}>+ Agregar celda</button>
        </div>
      ))}
      <button className="btn-secondary" onClick={() => set("sections", [...f.sections, newSection()])}>+ Agregar sección</button>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Conclusiones</h3>
        <textarea className="input" rows={2} placeholder="Texto introductorio" value={f.intro} onChange={(e) => set("intro", e.target.value)} />
        {f.conclusiones.map((c, i) => (
          <div key={i} className="flex gap-2">
            <textarea className="input flex-1" rows={2} value={c}
              onChange={(e) => set("conclusiones", f.conclusiones.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="btn-secondary" onClick={() => set("conclusiones", f.conclusiones.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn-secondary text-xs" onClick={() => set("conclusiones", [...f.conclusiones, ""])}>+ Agregar conclusión</button>
      </div>

      <button className="btn-primary" disabled={generating} aria-busy={generating} onClick={generate}>
        {generating ? <><Spinner /> Generando PDF...</> : "Generar PDF"}
      </button>

      {error && <div role="alert" className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}
      {result && (
        <div className="card bg-green-50 border-green-200 space-y-2">
          <p className="text-sm text-green-700">PDF generado ({result.pages} páginas): {result.filename}</p>
          {result.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700">
              {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <a className="btn-primary" href={result.url} target="_blank" rel="noreferrer">Descargar PDF</a>
        </div>
      )}
    </div>
  );
}
