import { useState } from "react";
import ImageUpload from "../ImageUpload";
import { applyVars, varsIn } from "../../checklist/model";
import type { Img, Row } from "../../checklist/model";

export interface RowHandlers {
  onChange: (patch: Partial<Row>) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onEditImage: (index: number) => void;
  dragProps: {
    isDragging: boolean;
    isOver: boolean;
    onHandleDragStart: (e: React.DragEvent) => void;
    onHandleDragEnd: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

const iconBtn = "px-1.5 py-0.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 text-sm leading-none";

function moveImage(images: Img[], i: number, d: -1 | 1): Img[] {
  const j = i + d;
  if (j < 0 || j >= images.length) return images;
  const next = images.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export default function RowCard({ row, vars, h }: { row: Row; vars: Record<string, string>; h: RowHandlers }) {
  const [showOutput, setShowOutput] = useState(false);
  const resolved = applyVars(row.comando, vars);
  const missing = varsIn(resolved);
  const d = h.dragProps;

  return (
    <div
      onDragOver={d.onDragOver}
      onDrop={d.onDrop}
      className={`border rounded-lg p-3 transition-colors ${d.isDragging ? "opacity-50" : ""} ${d.isOver ? "border-brand-400 bg-brand-50" : "border-slate-100"} ${row.incluir ? "" : "bg-slate-50"}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {/* Solo el asa se arrastra: así se puede seleccionar texto de los campos sin mover la fila. */}
        <span draggable onDragStart={d.onHandleDragStart} onDragEnd={d.onHandleDragEnd}
          title="Arrastra para cambiar de lugar" className="cursor-grab select-none text-slate-400 px-1">⠿</span>
        <input type="checkbox" checked={row.incluir} onChange={(e) => h.onChange({ incluir: e.target.checked })}
          title="Incluir en el PDF" />
        <input
          className={`input flex-1 min-w-[180px] py-1 text-sm font-medium ${row.incluir ? "" : "text-slate-400"}`}
          value={row.nombre} placeholder="Título del ítem"
          onChange={(e) => h.onChange({ nombre: e.target.value })}
        />
        <select className="input py-1 text-xs" style={{ width: "9rem", flex: "none" }} value={row.modo}
          onChange={(e) => h.onChange({ modo: e.target.value as Row["modo"] })}>
          <option value="auto">Automático</option>
          <option value="manual">Manual (foto)</option>
        </select>
        <div className="flex items-center">
          <button className={iconBtn} title="Subir" onClick={() => h.onMove(-1)}>↑</button>
          <button className={iconBtn} title="Bajar" onClick={() => h.onMove(1)}>↓</button>
          <button className={iconBtn} title="Repetir este ítem" onClick={h.onDuplicate}>⧉</button>
          <button className={iconBtn + " hover:text-red-600"} title="Quitar de este checklist" onClick={h.onRemove}>🗑</button>
        </div>
      </div>

      {row.modo === "auto" ? (
        <div className="mt-2 pl-7 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">Comando:</span>
            <input className="input flex-1 min-w-[220px] py-1 font-mono text-xs" value={row.comando}
              placeholder="ej. display version   (puedes usar {WAN_NH}, {WAN_IF}...)"
              onChange={(e) => h.onChange({ comando: e.target.value })} />
            {row.output ? <span className="text-xs text-green-600">✔ ejecutado</span> : null}
            <button className="text-xs underline text-slate-500" onClick={() => setShowOutput((v) => !v)}>
              {showOutput ? "ocultar salida" : "ver / pegar salida"}
            </button>
          </div>
          {row.comando && resolved !== row.comando && (
            <p className="text-[11px] text-slate-400 font-mono">
              Se enviará: {resolved}
              {missing.length > 0 && <span className="text-amber-600 font-sans"> — falta completar: {missing.join(", ")}</span>}
            </p>
          )}
          {row.comando && resolved === row.comando && missing.length > 0 && (
            <p className="text-[11px] text-amber-600">Falta completar: {missing.join(", ")}</p>
          )}
          {showOutput && (
            <textarea className="input font-mono text-xs h-40" value={row.output ?? ""}
              placeholder="Aquí aparece la salida del comando. También puedes pegarla a mano."
              onChange={(e) => h.onChange({ output: e.target.value })} />
          )}
        </div>
      ) : (
        <div className="mt-2 pl-7">
          <div className="flex flex-wrap gap-3 items-start">
            {row.images.map((img, i) => (
              <div key={img.path + i} className="w-28">
                <img src={img.url} alt={`imagen ${i + 1}`} className="w-28 h-20 object-cover rounded border border-slate-200 bg-slate-50" />
                <div className="flex justify-between mt-0.5">
                  <button className={iconBtn} title="Mover a la izquierda" onClick={() => h.onChange({ images: moveImage(row.images, i, -1) })}>◀</button>
                  <button className={iconBtn} title="Editar (recortar, flechas, texto, difuminar)" onClick={() => h.onEditImage(i)}>✎</button>
                  <button className={iconBtn} title="Mover a la derecha" onClick={() => h.onChange({ images: moveImage(row.images, i, 1) })}>▶</button>
                  <button className={iconBtn + " hover:text-red-600"} title="Quitar imagen" onClick={() => h.onChange({ images: row.images.filter((_, k) => k !== i) })}>✕</button>
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <ImageUpload compact label="+ agregar imagen"
                onUploaded={(p, u) => h.onChange({ images: [...row.images, { path: p, url: u }] })} />
              <span className="text-[11px] text-slate-400">Ctrl+V o arrastra la imagen aquí también</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
