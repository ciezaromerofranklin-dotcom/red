import { useEffect, useMemo, useState } from "react";
import { api, runStreaming } from "../api/client";
import ConnectionPanel from "../components/ConnectionPanel";
import LiveLog from "../components/LiveLog";
import Spinner from "../components/Spinner";
import { DEFAULT_CONNECTION, withoutPassword } from "../connection";
import { usePersistentState } from "../store/persistentState";
import type { Connection, ExtraLanNetwork, Fragment, Service, Vendor } from "../types";

type Tab = "crud" | "generar";

const MEM = { persist: false } as const;

export default function PlantillasPage() {
  // La pestaña activa se recuerda al ir a otra página y volver.
  const [tab, setTab] = usePersistentState<Tab>("plantillas.tab", "crud");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    api.get("/vendors").then((r) => setVendors(r.data));
    api.get("/services").then((r) => setServices(r.data));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Plantillas</h2>
        <p className="text-slate-500 text-sm">Fragmentos reutilizables por marca/servicio, y generación + aplicación al equipo.</p>
      </div>

      <div className="flex gap-2">
        <button className={tab === "crud" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("crud")}>Fragmentos (editar)</button>
        <button className={tab === "generar" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("generar")}>Generar / Aplicar</button>
      </div>

      {tab === "crud" ? (
        <FragmentsCrud vendors={vendors} services={services} onServiceCreated={(s) => setServices((prev) => [...prev, s])} />
      ) : (
        <GenerarPlantilla vendors={vendors} services={services} />
      )}
    </div>
  );
}

// ==================================================================
function FragmentsCrud({ vendors, services, onServiceCreated }:
  { vendors: Vendor[]; services: Service[]; onServiceCreated: (s: Service) => void }) {
  const [marcaFilter, setMarcaFilter] = usePersistentState("plantillas.marcaFilter", "");
  const [fragments, setFragments] = useState<Fragment[]>([]);

  // Borrador del formulario: no se pierde al cambiar de pestaña o de página.
  const EMPTY = { selectedId: "", nombre: "", marca: "cisco_ios", modelos: "", orden: 50, texto: "", servSel: [] as string[] };
  const [draft, setDraft] = usePersistentState("plantillas.draft", EMPTY, MEM);
  const { nombre, marca, modelos, orden, texto, servSel } = draft;
  const setNombre = (v: string) => setDraft((d) => ({ ...d, nombre: v }));
  const setMarca = (v: string) => setDraft((d) => ({ ...d, marca: v }));
  const setModelos = (v: string) => setDraft((d) => ({ ...d, modelos: v }));
  const setOrden = (v: number) => setDraft((d) => ({ ...d, orden: v }));
  const setTexto = (v: string) => setDraft((d) => ({ ...d, texto: v }));
  const selected = fragments.find((f) => f.id === draft.selectedId) ?? null;
  const [newService, setNewService] = usePersistentState("plantillas.newService", "", MEM);

  useEffect(() => { reload(); }, [marcaFilter]);

  function reload() {
    api.get("/templates/fragments", { params: marcaFilter ? { marca: marcaFilter } : {} })
      .then((r) => setFragments(r.data));
  }

  function selectFrag(f: Fragment) {
    setDraft({
      selectedId: f.id, nombre: f.nombre, marca: f.marca, modelos: f.modelos_compatibles,
      orden: f.orden, texto: f.texto, servSel: f.servicios,
    });
  }

  function newFrag() {
    // Como antes: conserva la marca elegida y vacía el resto.
    setDraft((d) => ({ ...EMPTY, marca: d.marca }));
  }

  function toggleServicio(clave: string) {
    setDraft((d) => ({
      ...d,
      servSel: d.servSel.includes(clave) ? d.servSel.filter((s) => s !== clave) : [...d.servSel, clave],
    }));
  }

  async function addServicio() {
    const clave = newService.trim().toLowerCase();
    if (!clave) return;
    const { data } = await api.post("/services", { clave, etiqueta: clave });
    onServiceCreated(data);
    setNewService("");
  }

  async function save() {
    if (!nombre || servSel.length === 0) { alert("Falta nombre o al menos un servicio."); return; }
    const payload = { nombre, marca, modelos_compatibles: modelos, servicios: servSel, orden, texto };
    if (draft.selectedId) {
      await api.put(`/templates/fragments/${draft.selectedId}`, payload);
    } else {
      await api.post("/templates/fragments", payload);
    }
    reload();
    alert("Fragmento guardado.");
  }

  async function del(f: Fragment) {
    if (!confirm(`¿Eliminar '${f.nombre}'?`)) return;
    await api.delete(`/templates/fragments/${f.id}`);
    newFrag();
    reload();
  }

  return (
    <div className="grid grid-cols-[320px_1fr] gap-6">
      <div className="space-y-3">
        <select className="input" value={marcaFilter} onChange={(e) => setMarcaFilter(e.target.value)}>
          <option value="">(todas las marcas)</option>
          {vendors.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
        <div className="card p-0 divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
          {fragments.map((f) => (
            <button key={f.id} onClick={() => selectFrag(f)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${selected?.id === f.id ? "bg-brand-50" : ""}`}>
              <div className="font-medium text-slate-700">{f.nombre}</div>
              <div className="text-xs text-slate-400">[{f.marca}] orden {f.orden}</div>
            </button>
          ))}
        </div>
        <button className="btn-secondary w-full" onClick={newFrag}>+ Nuevo fragmento</button>
      </div>

      <div className="card space-y-4">
        <div>
          <label className="label">Nombre del fragmento</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Marca</label>
            <select className="input" value={marca} onChange={(e) => setMarca(e.target.value)}>
              {vendors.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Orden</label>
            <input className="input" type="number" value={orden} onChange={(e) => setOrden(Number(e.target.value))} />
          </div>
        </div>
        <div>
          <label className="label">Modelos compatibles</label>
          <input className="input" value={modelos} onChange={(e) => setModelos(e.target.value)} />
        </div>
        <div>
          <label className="label">Servicios a los que aplica</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {services.map((s) => (
              <label key={s.clave} className={`px-2 py-1 rounded-md text-xs cursor-pointer border ${servSel.includes(s.clave) ? "bg-brand-600 text-white border-brand-600" : "bg-white text-slate-600 border-slate-300"}`}>
                <input type="checkbox" className="hidden" checked={servSel.includes(s.clave)} onChange={() => toggleServicio(s.clave)} />
                {s.etiqueta}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="input" placeholder="nuevo servicio..." value={newService} onChange={(e) => setNewService(e.target.value)} />
            <button className="btn-secondary" onClick={addServicio}>+ agregar</button>
          </div>
        </div>
        <div>
          <label className="label">Texto (usa {"{VARIABLE}"} para datos variables)</label>
          <textarea className="input font-mono text-xs h-64" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={save}>💾 Guardar</button>
          {selected && <button className="btn-danger" onClick={() => del(selected)}>🗑 Eliminar</button>}
        </div>
      </div>
    </div>
  );
}

// ==================================================================
function GenerarPlantilla({ vendors, services }: { vendors: Vendor[]; services: Service[] }) {
  // Todo esto sobrevive al cambio de página (la contraseña solo en memoria).
  const [marca, setMarca] = usePersistentState("plantillas.marca", "cisco_ios");
  const [servicio, setServicio] = usePersistentState("plantillas.servicio", "");
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [selectedIds, setSelectedIds] = usePersistentState<string[]>("plantillas.selectedIds", []);
  // Para qué combinación marca|servicio es la selección guardada.
  const [selFor, setSelFor] = usePersistentState("plantillas.selFor", "");
  const [varNames, setVarNames] = usePersistentState<string[]>("plantillas.varNames", []);
  const [vars, setVars] = usePersistentState<Record<string, string>>("plantillas.vars", {});
  const [extraLan, setExtraLan] = usePersistentState<ExtraLanNetwork[]>("plantillas.extraLan", []);
  const [aclIps, setAclIps] = usePersistentState("plantillas.aclIps", "");
  const [preview, setPreview] = usePersistentState("plantillas.preview", "", MEM);
  const [connection, setConnection] = usePersistentState<Connection>(
    "plantillas.connection", DEFAULT_CONNECTION, { serialize: withoutPassword }
  );
  const [logs, setLogs] = usePersistentState<string[]>("plantillas.logs", [], MEM);
  const [applying, setApplying] = usePersistentState("plantillas.applying", false, MEM);

  // Si el servicio guardado ya no existe (o no hay ninguno elegido), se usa el primero.
  useEffect(() => {
    if (services.length && !services.some((s) => s.clave === servicio)) setServicio(services[0].clave);
  }, [services]);

  useEffect(() => { reloadFragments(); }, [marca, servicio]);

  async function reloadFragments() {
    if (!servicio) return;
    const { data } = await api.get("/templates/fragments", { params: { marca, servicio } });
    const list = data as Fragment[];
    setFragments(list);

    // Al volver a esta pantalla se CONSERVA la selección de fragmentos que ya
    // se había hecho (antes se volvían a marcar todos). Solo se marcan todos
    // cuando cambia la combinación marca/servicio.
    const key = `${marca}|${servicio}`;
    if (selFor === key) {
      const existing = new Set(list.map((f) => f.id));
      setSelectedIds((prev) => prev.filter((id) => existing.has(id)));
    } else {
      setSelectedIds(list.map((f) => f.id));
      setSelFor(key);
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function loadVarFields() {
    if (selectedIds.length === 0) { setVarNames([]); return; }
    const { data } = await api.get("/templates/placeholders", { params: { fragment_ids: selectedIds.join(",") } });
    setVarNames(data);
  }

  const extraLanRows = useMemo(() => extraLan, [extraLan]);

  function addExtraLan() { setExtraLan((p) => [...p, { ip: "", mask: "", prefix_len: "" }]); }
  function updateExtraLan(i: number, field: keyof ExtraLanNetwork, value: string) {
    setExtraLan((p) => p.map((row, idx) => idx === i ? { ...row, [field]: value } : row));
  }
  function removeExtraLan(i: number) { setExtraLan((p) => p.filter((_, idx) => idx !== i)); }

  function buildPayload() {
    return {
      fragment_ids: selectedIds, variables: vars, extra_lan_networks: extraLan,
      acl_mgmt_ips: aclIps.split("\n").map((s) => s.trim()).filter(Boolean),
    };
  }

  async function doPreview() {
    const { data } = await api.post("/templates/build", buildPayload());
    setPreview(data.text);
    if (data.has_missing) alert("Hay variables sin completar, resaltadas como [[FALTA:NOMBRE]].");
  }

  function downloadTxt() {
    if (!preview) return;
    const blob = new Blob([preview], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "plantilla.txt"; a.click();
    URL.revokeObjectURL(url);
  }

  function apply() {
    setLogs([]);
    setApplying(true);
    runStreaming("/templates/apply", { ...buildPayload(), marca, connection }, (ev) => {
      if (ev.type === "log") setLogs((l) => [...l, ev.message]);
      else if (ev.type === "done") {
        setPreview(ev.result.config_text);
        setLogs((l) => [...l, "", "===== RESPUESTA DEL EQUIPO =====", ev.result.device_log]);
        setApplying(false);
      } else if (ev.type === "error") {
        setLogs((l) => [...l, "✖ ERROR: " + ev.message]);
        setApplying(false);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="card grid grid-cols-2 gap-3">
        <div>
          <label className="label">Marca</label>
          <select className="input" value={marca} onChange={(e) => setMarca(e.target.value)}>
            {vendors.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Servicio</label>
          <select className="input" value={servicio} onChange={(e) => setServicio(e.target.value)}>
            {services.map((s) => <option key={s.clave} value={s.clave}>{s.etiqueta}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Fragmentos a incluir</h3>
        {fragments.length === 0 && <p className="text-sm text-slate-400">No hay fragmentos para esta combinación.</p>}
        <div className="space-y-1">
          {fragments.map((f) => (
            <label key={f.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selectedIds.includes(f.id)} onChange={() => toggle(f.id)} />
              ({f.orden}) {f.nombre}
            </label>
          ))}
        </div>
        <button className="btn-secondary mt-3" onClick={loadVarFields}>② Cargar campos según selección</button>
      </div>

      {varNames.length > 0 && (
        <div className="card grid grid-cols-2 gap-3">
          {varNames.map((name) => (
            <div key={name}>
              <label className="label">{name}</label>
              <input className="input" value={vars[name] || ""}
                onChange={(e) => setVars((v) => ({ ...v, [name]: e.target.value }))} />
            </div>
          ))}
        </div>
      )}

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Redes LAN adicionales (opcional)</h3>
        {extraLanRows.map((row, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input className="input" placeholder="Red" value={row.ip} onChange={(e) => updateExtraLan(i, "ip", e.target.value)} />
            <input className="input" placeholder="Máscara" value={row.mask} onChange={(e) => updateExtraLan(i, "mask", e.target.value)} />
            <input className="input w-24" placeholder="/prefijo" value={row.prefix_len} onChange={(e) => updateExtraLan(i, "prefix_len", e.target.value)} />
            <button className="btn-danger" onClick={() => removeExtraLan(i)}>✕</button>
          </div>
        ))}
        <button className="btn-secondary" onClick={addExtraLan}>+ agregar red LAN</button>
      </div>

      <div className="card">
        <label className="label">IPs adicionales para ACL de gestión (una por línea)</label>
        <textarea className="input h-20" value={aclIps} onChange={(e) => setAclIps(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <button className="btn-secondary" onClick={doPreview}>③ Vista previa</button>
        <button className="btn-secondary" onClick={downloadTxt} disabled={!preview}>💾 Descargar .txt</button>
      </div>

      {preview && (
        <pre className="card font-mono text-xs whitespace-pre-wrap max-h-96 overflow-y-auto">{preview}</pre>
      )}

      <ConnectionPanel vendors={vendors} vendorKey={marca} onVendorChange={setMarca}
        connection={connection} onConnectionChange={setConnection} showDeviceType={false} />

      <button className="btn-primary" disabled={applying} onClick={apply}>
        {applying ? <><Spinner /> Aplicando...</> : "⚡ Aplicar al equipo"}
      </button>

      <LiveLog lines={logs} />
    </div>
  );
}
