import { useEffect, useState } from "react";
import { api, apiErrorMessage, runStreaming } from "../api/client";
import ChecklistRun from "../components/checklist/ChecklistRun";
import LiveLog from "../components/LiveLog";
import SaturationTool from "../components/SaturationTool";
import { DEFAULT_CONNECTION, withoutPassword } from "../connection";
import { useChecklistRows } from "../checklist/model";
import { usePersistentState } from "../store/persistentState";
import type { ChecklistItem, Connection, Service, Vendor } from "../types";

const MEM = { persist: false } as const;

export default function ChecklistPage() {
  // Todo esto sobrevive al cambio de página: lo marcado, los parámetros, las
  // imágenes agregadas y la conexión (sin la contraseña).
  const [tab, setTab] = usePersistentState<"run" | "tools" | "items">("checklist.tab", "run");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [connection, setConnection] = usePersistentState<Connection>(
    "checklist.connection", DEFAULT_CONNECTION, { serialize: withoutPassword }
  );

  useEffect(() => {
    api.get("/vendors").then((r) => setVendors(r.data));
    reloadServices();
  }, []);

  function reloadServices() {
    api.get("/services").then((r) => setServices(r.data));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-800">CheckList (estilo Claro)</h2>
        <p className="text-slate-500 text-sm">Elige el tipo de checklist, completa los datos de arriba y ajusta lo que necesites: cada ítem se puede marcar, editar, mover, repetir o quitar.</p>
      </div>
      <div className="flex gap-2">
        <button className={tab === "run" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("run")}>Ejecutar / Generar PDF</button>
        <button className={tab === "tools" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("tools")}>🛠 Herramientas (Speedtest / Saturación / Ostinato)</button>
        <button className={tab === "items" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("items")}>Ítems (editar)</button>
      </div>
      {tab === "run" && <ChecklistRun vendors={vendors} connection={connection} setConnection={setConnection} />}
      {tab === "tools" && <ToolsTab connection={connection} />}
      {tab === "items" && <ItemsTab services={services} onServiceCreated={reloadServices} />}
    </div>
  );
}

function ToolsTab({ connection }: { connection: Connection }) {
  const { rows, setRows } = useChecklistRows();
  const [stEngine, setStEngine] = usePersistentState<"fast" | "nativo">("checklist.stEngine", "fast");
  const [stUrl, setStUrl] = usePersistentState("checklist.stUrl", "https://fast.com");
  const [stWait, setStWait] = usePersistentState("checklist.stWait", 60);
  const [stSummary, setStSummary] = usePersistentState<any>("checklist.stSummary", null, MEM);
  const [stLogs, setStLogs] = usePersistentState<string[]>("checklist.stLogs", [], MEM);
  const [stRunning, setStRunning] = usePersistentState("checklist.stRunning", false, MEM);
  const [stResult, setStResult] = usePersistentState<{ path: string; url: string } | null>("checklist.stResult", null, MEM);
  const [stTargetItemId, setStTargetItemId] = usePersistentState("checklist.stTarget", "", MEM);

  const manualItems = rows.filter((r) => r.modo === "manual");

  function runSpeedtest() {
    setStLogs([]); setStRunning(true); setStResult(null); setStSummary(null);
    runStreaming("/tools/speedtest", { engine: stEngine, url: stUrl, wait_seconds: stWait }, (ev) => {
      if (ev.type === "log") setStLogs((l) => [...l, ev.message]);
      else if (ev.type === "done") { setStResult(ev.result); setStSummary(ev.result.summary ?? null); setStRunning(false); }
      else if (ev.type === "error") { setStLogs((l) => [...l, "✖ ERROR: " + ev.message]); setStRunning(false); }
    });
  }

  function attachSpeedtestToItem() {
    if (!stResult || !stTargetItemId) return;
    const img = { path: stResult.path, url: stResult.url };
    setRows((prev) => prev.map((r) =>
      r.id === stTargetItemId ? { ...r, images: [...r.images, img] } : r));
    alert("Captura asignada al ítem. Ve a 'Ejecutar / Generar PDF' para verla.");
  }

  const [osCmd, setOsCmd] = usePersistentState("checklist.osCmd", "");
  const [osWait, setOsWait] = usePersistentState("checklist.osWait", 60);
  const [osWanCmd, setOsWanCmd] = usePersistentState("checklist.osWanCmd", "show policy-map interface GigabitEthernet0/0/0");
  const [osSupCmd, setOsSupCmd] = usePersistentState("checklist.osSupCmd", "");
  const [osLogs, setOsLogs] = usePersistentState<string[]>("checklist.osLogs", [], MEM);
  const [osRunning, setOsRunning] = usePersistentState("checklist.osRunning", false, MEM);
  const [osResult, setOsResult] = usePersistentState<{ wan_output: string; sup_output: string | null } | null>("checklist.osResult", null, MEM);
  const [osWanItemId, setOsWanItemId] = usePersistentState("checklist.osWanItem", "", MEM);
  const [osSupItemId, setOsSupItemId] = usePersistentState("checklist.osSupItem", "", MEM);

  function runOstinato() {
    if (!osCmd || !osWanCmd) { alert("Completa al menos el comando de Ostinato y el comando WAN."); return; }
    setOsLogs([]); setOsRunning(true); setOsResult(null);
    runStreaming("/tools/ostinato-saturacion", {
      connection, ostinato_start_cmd: osCmd, wait_seconds: osWait,
      wan_cmd: osWanCmd, sup_cmd: osSupCmd || null,
    }, (ev) => {
      if (ev.type === "log") setOsLogs((l) => [...l, ev.message]);
      else if (ev.type === "done") { setOsResult(ev.result); setOsRunning(false); }
      else if (ev.type === "error") { setOsLogs((l) => [...l, "✖ ERROR: " + ev.message]); setOsRunning(false); }
    });
  }

  function attachOstinatoResults() {
    const outputs: Record<string, string> = {};
    if (osResult && osWanItemId) outputs[osWanItemId] = osResult.wan_output;
    if (osResult?.sup_output && osSupItemId) outputs[osSupItemId] = osResult.sup_output;
    setRows((prev) => prev.map((r) =>
      outputs[r.id] !== undefined ? { ...r, output: outputs[r.id] } : r));
    alert("Resultados asignados a los ítems automáticos elegidos. Ve a 'Ejecutar / Generar PDF' para verlos (marca esos ítems como Automático).");
  }

  return (
    <div className="space-y-8">
      <div className="card space-y-3">
        <h3 className="font-semibold text-slate-800">🚀 Speedtest automático</h3>
        <p className="text-xs text-slate-500">
          Se ejecuta en el PC donde corre el backend, así que mide la línea de ESE PC (en sitio: la del cliente).
          La captura se toma apenas el test termina.
        </p>
        <div className="flex gap-4 text-sm flex-wrap">
          <label className="flex items-center gap-2">
            <input type="radio" checked={stEngine === "fast"} onChange={() => setStEngine("fast")} />
            Navegador (captura real de fast.com u otra web)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={stEngine === "nativo"} onChange={() => setStEngine("nativo")} />
            Motor propio (sin navegador: bajada, subida y latencia)
          </label>
        </div>
        {stEngine === "fast" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label">URL del speedtest</label><input className="input" value={stUrl} onChange={(e) => setStUrl(e.target.value)} /></div>
            <div><label className="label">Espera máxima (s)</label><input className="input" type="number" value={stWait} onChange={(e) => setStWait(Number(e.target.value))} /></div>
          </div>
        )}
        <button className="btn-primary" disabled={stRunning} onClick={runSpeedtest}>
          {stRunning ? "Ejecutando..." : "Ejecutar speedtest"}
        </button>
        <LiveLog lines={stLogs} />
        {stSummary && (
          <p className="text-sm text-slate-700">
            ↓ <b>{stSummary.down_mbps} Mbps</b> · ↑ <b>{stSummary.up_mbps} Mbps</b> · latencia {stSummary.latency_ms} ms · jitter {stSummary.jitter_ms} ms
          </p>
        )}
        {stResult && (
          <div className="flex items-center gap-3">
            <img src={stResult.url} alt="resultado" className="w-40 rounded border border-slate-200" />
            <div className="flex-1 flex items-center gap-2">
              <select className="input" value={stTargetItemId} onChange={(e) => setStTargetItemId(e.target.value)}>
                <option value="">-- asignar a ítem manual... --</option>
                {manualItems.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
              <button className="btn-secondary" onClick={attachSpeedtestToItem}>Asignar</button>
            </div>
          </div>
        )}
      </div>

      <SaturationTool
        connection={connection}
        manualItems={manualItems.map((r) => ({ id: r.id, nombre: r.nombre }))}
        allItems={rows.map((r) => ({ id: r.id, nombre: r.nombre }))}
        onAttachImage={(id, path, url) => setRows((prev) => prev.map((r) => r.id === id ? { ...r, images: [...r.images, { path, url }] } : r))}
        onAttachOutput={(id, output) => setRows((prev) => prev.map((r) => r.id === id ? { ...r, output } : r))}
      />

      <div className="card space-y-3">
        <h3 className="font-semibold text-slate-800">📡 Ostinato + captura de saturación (con espera)</h3>
        <p className="text-xs text-slate-500">
          Arranca el tráfico de Ostinato, espera el tiempo que definas (para que la saturación suba hasta el
          ancho de banda del servicio), y recién entonces captura en el router — WAN y, si quieres, SUP debajo.
          La conexión al equipo usa la que configuraste en la pestaña "Ejecutar".
        </p>
        <div>
          <label className="label">Comando que arranca el tráfico de Ostinato (en el servidor del backend)</label>
          <input className="input" placeholder="ej. python3 /ruta/mi_stream_ostinato.py" value={osCmd} onChange={(e) => setOsCmd(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label">Segundos de espera</label><input className="input" type="number" value={osWait} onChange={(e) => setOsWait(Number(e.target.value))} /></div>
          <div><label className="label">Comando de captura WAN</label><input className="input" value={osWanCmd} onChange={(e) => setOsWanCmd(e.target.value)} /></div>
          <div><label className="label">Comando de captura SUP (opcional)</label><input className="input" value={osSupCmd} onChange={(e) => setOsSupCmd(e.target.value)} /></div>
        </div>
        <button className="btn-primary" disabled={osRunning} onClick={runOstinato}>
          {osRunning ? "Ejecutando..." : "Iniciar Ostinato + esperar + capturar"}
        </button>
        <LiveLog lines={osLogs} />
        {osResult && (
          <div className="space-y-2">
            <pre className="bg-slate-900 text-slate-200 text-xs p-3 rounded-lg whitespace-pre-wrap">{osResult.wan_output}</pre>
            {osResult.sup_output && (
              <pre className="bg-slate-900 text-slate-200 text-xs p-3 rounded-lg whitespace-pre-wrap">{osResult.sup_output}</pre>
            )}
            <div className="flex gap-2 items-center flex-wrap">
              <select className="input" value={osWanItemId} onChange={(e) => setOsWanItemId(e.target.value)}>
                <option value="">-- ítem para la captura WAN --</option>
                {rows.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
              {osResult.sup_output && (
                <select className="input" value={osSupItemId} onChange={(e) => setOsSupItemId(e.target.value)}>
                  <option value="">-- ítem para la captura SUP --</option>
                  {rows.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
              )}
              <button className="btn-secondary" onClick={attachOstinatoResults}>Asignar resultados</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ItemsTab({ services, onServiceCreated }: { services: Service[]; onServiceCreated: () => void }) {
  const [servicio, setServicio] = usePersistentState("checklist.itemsServicio", "", MEM);
  const [items, setItems] = useState<ChecklistItem[]>([]);

  // Borrador del formulario: no se pierde al cambiar de pestaña o de página.
  const EMPTY = { selectedId: "", seccion: "", nombre: "", orden: 10, modo: "auto" as "auto" | "manual", comando: "" };
  const [draft, setDraft] = usePersistentState("checklist.itemsDraft", EMPTY, MEM);
  const { seccion, nombre, orden, modo, comando } = draft;
  const setSeccion = (v: string) => setDraft((d) => ({ ...d, seccion: v }));
  const setNombre = (v: string) => setDraft((d) => ({ ...d, nombre: v }));
  const setOrden = (v: number) => setDraft((d) => ({ ...d, orden: v }));
  const setModo = (v: "auto" | "manual") => setDraft((d) => ({ ...d, modo: v }));
  const setComando = (v: string) => setDraft((d) => ({ ...d, comando: v }));
  const selected = items.find((i) => i.id === draft.selectedId) ?? null;

  const [newKey, setNewKey] = usePersistentState("checklist.newKey", "", MEM);
  const [newLabel, setNewLabel] = usePersistentState("checklist.newLabel", "", MEM);

  useEffect(() => {
    if (services.length && !services.some((s) => s.clave === servicio)) setServicio(services[0].clave);
  }, [services]);
  useEffect(() => { if (servicio) reload(); }, [servicio]);

  function reload() {
    api.get("/checklist/items", { params: { servicio } }).then((r) => setItems(r.data));
  }

  function select(it: ChecklistItem) {
    setDraft({
      selectedId: it.id, seccion: it.seccion, nombre: it.nombre,
      orden: it.orden, modo: it.modo, comando: it.comando,
    });
  }

  function clear() {
    setDraft(EMPTY);
  }

  async function save() {
    if (!seccion || !nombre) { alert("Completa sección y nombre."); return; }
    const payload = { servicio, seccion, nombre, orden, modo, comando: modo === "auto" ? comando : "" };
    if (draft.selectedId) await api.put(`/checklist/items/${draft.selectedId}`, payload);
    else await api.post("/checklist/items", payload);
    reload();
    alert("Ítem guardado.");
  }

  async function del(it: ChecklistItem) {
    if (!confirm(`¿Eliminar '${it.nombre}'?`)) return;
    await api.delete(`/checklist/items/${it.id}`);
    clear(); reload();
  }

  async function createService() {
    if (!newKey.trim() || !newLabel.trim()) return;
    await api.post("/services", { clave: newKey.trim().toLowerCase(), etiqueta: newLabel.trim() });
    setNewKey(""); setNewLabel("");
    onServiceCreated();
  }
  return (
    <div className="space-y-4">
      <div className="card flex gap-3 items-end">
        <div>
          <label className="label">Nuevo servicio — clave</label>
          <input className="input" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        </div>
        <div>
          <label className="label">Etiqueta</label>
          <input className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        </div>
        <button className="btn-secondary" onClick={createService}>+ crear servicio</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 lg:gap-6">
        <div className="space-y-3">
          <select className="input" value={servicio} onChange={(e) => setServicio(e.target.value)}>
            {services.map((s) => <option key={s.clave} value={s.clave}>{s.etiqueta}</option>)}
          </select>
          <div className="card p-0 divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
            {items.map((it) => (
              <button key={it.id} onClick={() => select(it)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${selected?.id === it.id ? "bg-brand-50" : ""}`}>
                <div className="font-medium text-slate-700">{it.nombre}</div>
                <div className="text-xs text-slate-400">[{it.seccion.slice(0, 24)}] orden {it.orden}</div>
              </button>
            ))}
          </div>
          <button className="btn-secondary w-full" onClick={clear}>+ Nuevo ítem</button>
        </div>

        <div className="card space-y-4">
          <div><label className="label">Sección</label><input className="input" value={seccion} onChange={(e) => setSeccion(e.target.value)} /></div>
          <div><label className="label">Nombre del ítem</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div><label className="label">Orden</label><input className="input" type="number" value={orden} onChange={(e) => setOrden(Number(e.target.value))} /></div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={modo === "auto"} onChange={() => setModo("auto")} /> Automático</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={modo === "manual"} onChange={() => setModo("manual")} /> Manual</label>
          </div>
          {modo === "auto" && (
            <div>
              <label className="label">Comando (usa {"{PARAM}"} para un dato variable)</label>
              <input className="input" value={comando} onChange={(e) => setComando(e.target.value)} />
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-primary" onClick={save}>💾 Guardar</button>
            {selected && <button className="btn-danger" onClick={() => del(selected)}>🗑 Eliminar</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
