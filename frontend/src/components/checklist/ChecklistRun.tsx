import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiErrorMessage, runStreaming } from "../../api/client";
import ConnectionPanel from "../ConnectionPanel";
import ImageAnnotator from "../ImageAnnotator";
import LiveLog from "../LiveLog";
import LogoPicker from "../LogoPicker";
import Spinner from "../Spinner";
import RowCard from "./RowCard";
import { NO_LOGO, logoPayload } from "../../logo";
import type { LogoSel } from "../../logo";
import { usePersistentState } from "../../store/persistentState";
import type { ChecklistItem, Connection, Vendor } from "../../types";
import {
  VAR_DEFS, applyVars, duplicateRow, duplicateSection, effectiveVars, moveRowBy, moveRowTo, moveSection,
  newId, previewFilename, regroup, rowFromItem, sectionsOf, suggestSubtitle, useChecklistRows, varLabel, varsNeeded,
} from "../../checklist/model";
import type { Row, VendorKey } from "../../checklist/model";

const MEM = { persist: false } as const;

export interface ProfileInfo { clave: string; etiqueta: string; vendor: string; builtin: boolean; items: number }

const VENDOR_OPTIONS: { key: VendorKey; label: string }[] = [
  { key: "cisco_ios", label: "Cisco" },
  { key: "huawei", label: "Huawei" },
  { key: "fortinet", label: "Fortinet" },
  { key: "", label: "Otro / sin definir" },
];

const slug = (t: string) => t.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export default function ChecklistRun({ vendors, connection, setConnection }: {
  vendors: Vendor[]; connection: Connection; setConnection: (c: Connection) => void;
}) {
  const { servicio, setServicio, rows, setRows, setRowsFor, hasRows } = useChecklistRows();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);

  // --- datos de la cabecera / pie (se conservan al cambiar de pantalla) ---
  const [titulo, setTitulo] = usePersistentState("checklist2.titulo", "CheckList de Claro");
  const [subtitulo, setSubtitulo] = usePersistentState("checklist2.subtitulo", "");
  const [subAuto, setSubAuto] = usePersistentState("checklist2.subAuto", true);
  const [cpe, setCpe] = usePersistentState("checklist2.cpe", "");
  const [bw, setBw] = usePersistentState("checklist2.bw", "");
  const [sot, setSot] = usePersistentState("checklist2.sot", "");
  const [cid, setCid] = usePersistentState("checklist2.cid", "");
  const [cliente, setCliente] = usePersistentState("checklist2.cliente", "");
  const [fecha, setFecha] = usePersistentState("checklist2.fecha", () => new Date().toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" }));
  const [pie, setPie] = usePersistentState("checklist2.pie", "");
  const [deviceId, setDeviceId] = usePersistentState("checklist2.deviceId", "");
  const [logo, setLogo] = usePersistentState<LogoSel>("checklist2.logo", NO_LOGO);
  const [vars, setVars] = usePersistentState<Record<string, string>>("checklist2.vars", {});

  const [logs, setLogs] = usePersistentState<string[]>("checklist2.logs", [], MEM);
  const [running, setRunning] = usePersistentState("checklist2.running", false, MEM);
  const [generating, setGenerating] = usePersistentState("checklist2.generating", false, MEM);
  const [pdf, setPdf] = usePersistentState<{ url: string; filename: string; warnings: string[] } | null>("checklist2.pdf", null, MEM);
  const [pdfError, setPdfError] = usePersistentState<string | null>("checklist2.pdfError", null, MEM);

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ rowId: string; index: number } | null>(null);
  const reqId = useRef(0);

  const profile = profiles.find((p) => p.clave === servicio);
  const vendor = (profile?.vendor || "") as VendorKey;

  // ---------------------------------------------------------------- perfiles
  function loadProfiles(selectFirst = false) {
    return api.get("/checklist/profiles").then((r) => {
      const list = r.data as ProfileInfo[];
      setProfiles(list);
      if ((selectFirst || !list.some((p) => p.clave === servicio)) && list.length) {
        const preferred = list.find((p) => p.items > 0) ?? list[0];
        if (!list.some((p) => p.clave === servicio)) setServicio(preferred.clave);
      }
    });
  }
  useEffect(() => { loadProfiles(); }, []);

  async function fetchRows(clave: string): Promise<Row[]> {
    const { data } = await api.get("/checklist/items", { params: { servicio: clave } });
    return (data as ChecklistItem[]).map(rowFromItem);
  }

  // Si el perfil nunca se abrió en este navegador, se cargan sus ítems.
  useEffect(() => {
    if (!servicio || hasRows || !profiles.length) return;
    const mine = ++reqId.current;
    fetchRows(servicio).then((r) => { if (mine === reqId.current) setRows(r); });
  }, [servicio, hasRows, profiles.length]);

  // Subtítulo automático mientras no lo escriban a mano.
  const suggested = suggestSubtitle(servicio, vendor, bw, cpe);
  useEffect(() => { if (subAuto) setSubtitulo(suggested); }, [subAuto, suggested]);

  async function reloadFromProfile() {
    if (!confirm("Se descartan los cambios, imágenes y salidas de este checklist y se vuelve a cargar el perfil tal como está guardado. ¿Continuar?")) return;
    setRows(await fetchRows(servicio));
    setLogs([]); setPdf(null);
  }

  async function saveProfile(asNew: boolean) {
    let clave = servicio;
    let etiqueta = profile?.etiqueta ?? servicio;
    if (asNew) {
      const name = prompt("Nombre del perfil nuevo (ej. Internet Huawei con cámaras):");
      if (!name || !slug(name)) return;
      clave = slug(name); etiqueta = name.trim();
      if (profiles.some((p) => p.clave === clave) && !confirm(`Ya existe el perfil «${clave}». ¿Reemplazarlo con lo que ves ahora?`)) return;
    } else if (!confirm(`Se reemplazan los ítems del perfil «${etiqueta}» con lo que ves ahora (títulos, comandos, orden y secciones; las imágenes no se guardan). ¿Continuar?`)) return;
    try {
      await api.post("/checklist/profiles", {
        clave, etiqueta, vendor,
        items: rows.map((r) => ({ seccion: r.seccion, nombre: r.nombre, modo: r.modo, comando: r.modo === "auto" ? r.comando : "" })),
      });
      if (asNew) setRowsFor(clave, rows);
      await loadProfiles();
      if (asNew) setServicio(clave);
      alert(asNew ? "Perfil creado." : "Perfil actualizado.");
    } catch (e) { alert(apiErrorMessage(e, "No se pudo guardar el perfil.")); }
  }

  async function duplicateProfile() {
    const name = prompt(`Nombre de la copia de «${profile?.etiqueta ?? servicio}»:`);
    if (!name || !slug(name)) return;
    try {
      await api.post(`/services/${servicio}/duplicate`, { clave: slug(name), etiqueta: name.trim() });
      await loadProfiles();
      setServicio(slug(name));
    } catch (e) { alert(apiErrorMessage(e, "No se pudo duplicar el perfil.")); }
  }

  async function restoreProfile() {
    if (!confirm(`Se borran las ediciones del perfil «${profile?.etiqueta}» y vuelve a quedar como el original de fábrica. ¿Continuar?`)) return;
    try {
      await api.post(`/checklist/profiles/${servicio}/restore`);
      setRows(await fetchRows(servicio));
      await loadProfiles();
    } catch (e) { alert(apiErrorMessage(e, "No se pudo restaurar el perfil.")); }
  }

  async function deleteProfile() {
    if (!confirm(`¿Eliminar el perfil «${profile?.etiqueta}»${profile?.builtin ? " (es de fábrica; se puede restaurar más tarde recreándolo al reiniciar)" : ""}? Esto no se puede deshacer.`)) return;
    try {
      await api.delete(`/services/${servicio}`);
      const list = (await api.get("/checklist/profiles")).data as ProfileInfo[];
      setProfiles(list);
      setServicio(list.find((p) => p.items > 0)?.clave ?? list[0]?.clave ?? "");
    } catch (e) { alert(apiErrorMessage(e, "No se pudo eliminar el perfil.")); }
  }

  async function changeVendor(v: VendorKey) {
    try {
      await api.put(`/services/${servicio}`, { vendor: v });
      await loadProfiles();
    } catch (e) { alert(apiErrorMessage(e, "No se pudo cambiar la marca.")); }
  }

  async function newChecklist() {
    if (!confirm("Se limpian SOT, CID, cliente, IPs, imágenes y salidas, y se vuelve a cargar el perfil. ¿Empezar un checklist nuevo?")) return;
    setSot(""); setCid(""); setCliente(""); setVars({}); setBw(""); setCpe(""); setPie(""); setSubAuto(true);
    setFecha(new Date().toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" }));
    setRows(await fetchRows(servicio));
    setLogs([]); setPdf(null); setPdfError(null);
  }

  // ------------------------------------------------------------------ filas
  const sections = useMemo(() => sectionsOf(rows), [rows]);
  const needed = useMemo(() => varsNeeded(rows), [rows]);
  const included = rows.filter((r) => r.incluir);

  const patchRow = (id: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const allChecked = (sec?: string) => {
    const subset = sec ? rows.filter((r) => r.seccion === sec) : rows;
    return subset.length > 0 && subset.every((r) => r.incluir);
  };
  const toggleAll = (sec: string | undefined, value: boolean) =>
    setRows((prev) => prev.map((r) => (!sec || r.seccion === sec ? { ...r, incluir: value } : r)));

  function addRow(sec: string, modo: Row["modo"]) {
    setRows((prev) => {
      const last = prev.map((r) => r.seccion).lastIndexOf(sec);
      const row: Row = { id: newId(), seccion: sec, nombre: modo === "auto" ? "NUEVO COMANDO" : "NUEVA CAPTURA", comando: "", modo, incluir: true, images: [], output: null };
      const next = prev.slice();
      next.splice(last + 1, 0, row);
      return next;
    });
  }
  function addSection() {
    const name = prompt("Nombre de la nueva sección (ej. E: PRUEBAS DE CONTINGENCIA):");
    if (!name?.trim()) return;
    setRows((prev) => [...prev, { id: newId(), seccion: name.trim(), nombre: "NUEVO COMANDO", comando: "", modo: "auto", incluir: true, images: [], output: null }]);
  }
  function renameSection(oldName: string, newName: string) {
    if (!newName.trim() || newName === oldName) return;
    setRows((prev) => regroup(prev.map((r) => (r.seccion === oldName ? { ...r, seccion: newName } : r))));
  }
  function removeSection(sec: string) {
    if (!confirm(`¿Quitar la sección «${sec}» y sus ítems de este checklist?`)) return;
    setRows((prev) => prev.filter((r) => r.seccion !== sec));
  }
  function removeRow(id: string) {
    const r = rows.find((x) => x.id === id);
    if (r && (r.images.length || r.output) && !confirm("Este ítem tiene imágenes o salida capturada. ¿Quitarlo igual?")) return;
    setRows((prev) => prev.filter((x) => x.id !== id));
  }

  const dragProps = (id: string) => ({
    isDragging: dragId === id,
    isOver: overId === id && dragId !== null && dragId !== id,
    onHandleDragStart: (e: React.DragEvent) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      const el = (e.currentTarget as HTMLElement).parentElement?.parentElement;
      if (el) e.dataTransfer.setDragImage(el, 16, 16);
    },
    onHandleDragEnd: () => { setDragId(null); setOverId(null); },
    onDragOver: (e: React.DragEvent) => { if (dragId) { e.preventDefault(); setOverId(id); } },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const from = dragId;
      setDragId(null); setOverId(null);
      if (from && from !== id) setRows((prev) => moveRowTo(prev, from, id));
    },
  });

  // ---------------------------------------------------------- ejecutar y PDF
  const shown = (text: string) => applyVars(text, vars);

  function runAuto() {
    const autoItems = included.filter((r) => r.modo === "auto");
    if (autoItems.length === 0) { alert("No hay ítems automáticos incluidos."); return; }
    const sinDatos = autoItems.filter((r) => /\{[A-Z][A-Z0-9_]*\}/.test(shown(r.comando)));
    if (sinDatos.length > 0) {
      const lista = sinDatos.map((r) => "• " + r.nombre).join("\n");
      if (!confirm(`Estos ítems necesitan datos que faltan arriba (IPs / interfaces), así que NO se ejecutarán:\n\n${lista}\n\n¿Continuar con los demás?`)) return;
    }
    setLogs([]);
    setRunning(true);
    runStreaming("/checklist/run", {
      connection, vendor: vendor || "cisco_ios",
      items: autoItems.map((r) => ({ item_id: r.id, nombre: shown(r.nombre), comando: shown(r.comando) })),
    }, (ev) => {
      if (ev.type === "log") setLogs((l) => [...l, ev.message]);
      else if (ev.type === "done") {
        const byId: Record<string, string> = {};
        for (const res of ev.result.results) byId[res.item_id] = res.output;
        setRows((prev) => prev.map((r) => (byId[r.id] !== undefined ? { ...r, output: byId[r.id] } : r)));
        setRunning(false);
      } else if (ev.type === "error") { setLogs((l) => [...l, "✖ ERROR: " + ev.message]); setRunning(false); }
    });
  }

  async function generatePdf() {
    if (generating) return;
    if (included.length === 0) { alert("Marca al menos un ítem."); return; }
    const sinSalida = included.filter((r) => r.modo === "auto" && !r.output);
    if (sinSalida.length > 0 && !confirm(`${sinSalida.length} ítem(s) automáticos todavía no tienen salida y saldrán vacíos en el PDF. ¿Generar igual?`)) return;
    if (!sot.trim() && !confirm("No escribiste el SOT: el archivo no llevará el número de SOT en su nombre. ¿Continuar?")) return;
    const items = included.map((r) => ({
      nombre: shown(r.nombre), seccion: r.seccion, modo: r.modo,
      cmd: r.modo === "auto" ? shown(r.comando) : "",
      output: r.modo === "auto" ? (r.output ?? "") : "",
      image_paths: r.modo === "manual" ? r.images.map((i) => i.path) : [],
    }));
    setGenerating(true); setPdf(null); setPdfError(null);
    try {
      const { data } = await api.post("/checklist/pdf", {
        titulo, subtitulo, servicio_label: profile?.etiqueta || servicio,
        sot, cid, cliente, fecha, pie, device_id: deviceId, ...logoPayload(logo, "logo"), items,
      });
      setPdf({ url: data.url, filename: data.filename, warnings: Array.isArray(data.warnings) ? data.warnings : [] });
    } catch (e) {
      setPdfError(apiErrorMessage(e, "No se pudo generar el PDF."));
    } finally { setGenerating(false); }
  }

  const editingImg = editing ? rows.find((r) => r.id === editing.rowId)?.images[editing.index] : undefined;
  const ev = effectiveVars(vars);

  // ------------------------------------------------------------------ UI
  return (
    <div className="space-y-6">
      {/* 1) Perfil */}
      <div className="card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="sm:col-span-2">
            <label className="label">Tipo de checklist (perfil)</label>
            <select className="input" value={servicio} onChange={(e) => setServicio(e.target.value)}>
              {profiles.filter((p) => p.items > 0 || p.clave === servicio).map((p) => <option key={p.clave} value={p.clave}>{p.etiqueta}{p.builtin ? "" : "  ★ propio"}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Marca del equipo</label>
            <select className="input" value={vendor} onChange={(e) => changeVendor(e.target.value as VendorKey)}>
              {VENDOR_OPTIONS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button className="btn-secondary" onClick={() => saveProfile(true)}>💾 Guardar como perfil nuevo…</button>
          <button className="btn-secondary" onClick={() => saveProfile(false)} disabled={!servicio}>Actualizar este perfil</button>
          <button className="btn-secondary" onClick={duplicateProfile} disabled={!servicio}>Duplicar perfil…</button>
          <button className="btn-secondary" onClick={reloadFromProfile} disabled={!servicio}>↺ Recargar del perfil</button>
          {profile?.builtin && <button className="btn-secondary" onClick={restoreProfile}>Restaurar de fábrica</button>}
          <button className="btn-secondary text-red-600" onClick={deleteProfile} disabled={!servicio}>Eliminar perfil</button>
          <button className="btn-secondary" onClick={newChecklist}>🆕 Checklist nuevo (limpiar datos)</button>
        </div>
        <p className="text-xs text-slate-500">
          Todo lo que cambies abajo (títulos, comandos, orden, ítems nuevos, fotos) vale para este checklist. Si quieres que
          quede para la próxima vez, usa «Guardar como perfil nuevo» o «Actualizar este perfil».
        </p>
      </div>

      {/* 2) Cabecera y pie */}
      <div className="card space-y-3">
        <h3 className="text-sm font-bold text-brand-700">Datos del reporte (cabecera y pie de página)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3"><label className="label">Título</label><input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
          <div><label className="label">Modelo del CPE</label><input className="input" placeholder="ej. AR611" value={cpe} onChange={(e) => setCpe(e.target.value)} /></div>
          <div><label className="label">Ancho de banda (Mbps)</label><input className="input" inputMode="numeric" placeholder="ej. 50" value={bw} onChange={(e) => setBw(e.target.value)} /></div>
          <div className="sm:col-span-3">
            <label className="label">Subtítulo (segunda línea de la cabecera)</label>
            <div className="flex gap-2">
              <input className="input flex-1" value={subtitulo} onChange={(e) => { setSubtitulo(e.target.value); setSubAuto(false); }} />
              {!subAuto && <button className="btn-secondary text-xs" onClick={() => setSubAuto(true)}>Usar sugerido</button>}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Se arma solo con el tipo, el ancho de banda y el CPE; puedes escribirlo a tu gusto.</p>
          </div>
          <div><label className="label">SOT</label><input className="input" value={sot} onChange={(e) => setSot(e.target.value)} /></div>
          <div><label className="label">CID</label><input className="input" value={cid} onChange={(e) => setCid(e.target.value)} /></div>
          <div><label className="label">Cliente (para el nombre del archivo)</label><input className="input" value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
          <div><label className="label">Fecha</label><input className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label">Pie de página (si lo dejas vacío se usa la fecha)</label><input className="input" value={pie} placeholder={fecha} onChange={(e) => setPie(e.target.value)} /></div>
          <div><label className="label">Nombre del equipo (prompt en las capturas)</label><input className="input" placeholder="ej. rINT_CLIENTE" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} /></div>
          <div className="sm:col-span-2">
            <LogoPicker posicion="der" label="Logo (esquina derecha)" value={logo} onChange={setLogo} />
          </div>
        </div>
        <p className="text-xs text-slate-500">Archivo: <code className="bg-slate-100 px-1 rounded">{previewFilename(sot, cliente)}</code></p>
      </div>

      {/* 3) Datos para los comandos */}
      {needed.length > 0 && (
        <div className="card space-y-3">
          <h3 className="text-sm font-bold text-brand-700">Datos para los comandos (IPs e interfaces)</h3>
          <p className="text-xs text-slate-500">Se escriben una sola vez y se usan en todos los ítems que los piden. Si dejas uno vacío, esos ítems no se ejecutan.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {needed.map((k) => {
              const def = VAR_DEFS[k];
              const ej = def?.ej?.[(vendor || "cisco_ios") as "cisco_ios"] ?? "";
              const inherited = k === "BGP_PEER" && !(vars[k] || "").trim() && ev[k];
              return (
                <div key={k}>
                  <label className="label">{varLabel(k)} <span className="text-slate-400 font-mono text-[10px]">{`{${k}}`}</span></label>
                  <input className="input" value={vars[k] ?? ""} placeholder={inherited ? `${ev[k]} (igual al siguiente salto)` : ej ? `ej. ${ej}` : ""}
                    onChange={(e) => setVars((p) => ({ ...p, [k]: e.target.value }))} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ConnectionPanel vendors={vendors} vendorKey={vendor || "cisco_ios"} onVendorChange={() => {}}
        connection={connection} onConnectionChange={setConnection} showDeviceType={false} />

      {/* 4) Ítems */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={allChecked()} onChange={(e) => toggleAll(undefined, e.target.checked)} />
          Seleccionar todo <span className="text-xs text-slate-400 font-normal">({included.length} de {rows.length} en el PDF)</span>
        </label>
        <button className="btn-secondary text-xs" onClick={addSection}>+ Nueva sección</button>
      </div>

      {rows.length === 0 && <div className="card text-sm text-slate-500">Este perfil todavía no tiene ítems. Agrega una sección con «+ Nueva sección».</div>}

      <div className="space-y-4">
        {sections.map((sec, si) => (
          <div key={sec + si} className="card">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <input type="checkbox" checked={allChecked(sec)} onChange={(e) => toggleAll(sec, e.target.checked)} title="Incluir toda la sección" />
              <input className="input flex-1 min-w-[200px] py-1 text-sm font-bold text-brand-700" defaultValue={sec} key={sec}
                onBlur={(e) => renameSection(sec, e.target.value)} />
              <div className="flex items-center text-xs">
                <button className="px-1.5 py-0.5 rounded text-slate-500 hover:bg-slate-100" title="Subir sección" onClick={() => setRows((p) => moveSection(p, sec, -1))}>↑</button>
                <button className="px-1.5 py-0.5 rounded text-slate-500 hover:bg-slate-100" title="Bajar sección" onClick={() => setRows((p) => moveSection(p, sec, 1))}>↓</button>
                <button className="px-1.5 py-0.5 rounded text-slate-500 hover:bg-slate-100" title="Repetir toda la sección (bloque)" onClick={() => setRows((p) => duplicateSection(p, sec))}>⧉ repetir bloque</button>
                <button className="px-1.5 py-0.5 rounded text-slate-500 hover:bg-slate-100 hover:text-red-600" title="Quitar la sección" onClick={() => removeSection(sec)}>🗑</button>
              </div>
            </div>
            <div className="space-y-2">
              {rows.filter((r) => r.seccion === sec).map((r) => (
                <RowCard key={r.id} row={r} vars={vars} h={{
                  onChange: (patch) => patchRow(r.id, patch),
                  onMove: (d) => setRows((p) => moveRowBy(p, r.id, d)),
                  onDuplicate: () => setRows((p) => duplicateRow(p, r.id)),
                  onRemove: () => removeRow(r.id),
                  onEditImage: (index) => setEditing({ rowId: r.id, index }),
                  dragProps: dragProps(r.id),
                }} />
              ))}
            </div>
            <div className="mt-3 flex gap-2 text-xs">
              <button className="btn-secondary" onClick={() => addRow(sec, "auto")}>+ Comando</button>
              <button className="btn-secondary" onClick={() => addRow(sec, "manual")}>+ Foto manual</button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button className="btn-primary" disabled={running} onClick={runAuto}>
          {running ? <><Spinner /> Ejecutando...</> : "① Ejecutar ítems automáticos"}
        </button>
        <button className="btn-secondary" disabled={generating} aria-busy={generating} onClick={generatePdf}>
          {generating ? <><Spinner /> Generando PDF...</> : "② Generar PDF"}
        </button>
      </div>

      <LiveLog lines={logs} />

      {pdfError && <div role="alert" className="card border-red-200 bg-red-50 text-sm text-red-700">{pdfError}</div>}
      {pdf && (
        <div className="card bg-green-50 border-green-200 space-y-2">
          <p className="text-sm text-green-700">PDF generado: <b>{pdf.filename}</b></p>
          {pdf.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700">{pdf.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          <a className="btn-primary" href={pdf.url} target="_blank" rel="noreferrer" download={pdf.filename}>Descargar PDF</a>
        </div>
      )}

      {editing && editingImg && (
        <ImageAnnotator
          imageUrl={editingImg.url}
          onClose={() => setEditing(null)}
          onSaved={(p, u) => {
            const { rowId, index } = editing;
            setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, images: r.images.map((im, i) => (i === index ? { path: p, url: u } : im)) } : r)));
          }}
        />
      )}
    </div>
  );
}
