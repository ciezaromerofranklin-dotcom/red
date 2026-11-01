import { useEffect, useRef, useState } from "react";
import { api, apiErrorMessage, runStreaming } from "../api/client";
import LiveLog from "./LiveLog";
import { usePersistentState } from "../store/persistentState";
import type { Connection } from "../types";

const MEM = { persist: false } as const;

type Side = {
  target_mbps: number; rx_avg: number; rx_min: number; rx_max: number;
  pct_target: number; loss_pct: number | null; tx_avg?: number;
};
type SatResult = {
  mode: "udp" | "icmp"; target: string; source_ip: string; cancelled: boolean;
  up: Side | null; down: Side | null;
  rtt?: { avg: number; min: number; max: number; jitter: number };
  notes: string[]; icmp_note?: string;
  image: { path: string; url: string };
  wan_output: string | null; sup_output: string | null;
};
type NetInfo = {
  platform: string; is_admin: boolean;
  interfaces: { name: string; ip: string; netmask: string; up: boolean; gateway: string }[];
  gateways: { gateway: string; iface_ip: string; metric: number }[];
};
type Kind = "cabecera" | "dg" | "siguiente_salto" | "manual";
type Targets = Record<Kind, string>;

export interface ItemOption { id: string; nombre: string }

const KIND_LABEL: Record<Kind, string> = {
  cabecera: "IP de cabecera (la que da el cliente)",
  dg: "Puerta de enlace (DG) de este PC",
  siguiente_salto: "IP del siguiente salto",
  manual: "Otra IP / Internet (agente propio)",
};

function Mbps({ v }: { v: number | undefined }) {
  return <>{v === undefined ? "-" : v.toLocaleString("es-PE", { maximumFractionDigits: 2 })} Mbps</>;
}

function SideCard({ title, s }: { title: string; s: Side }) {
  const bad = s.loss_pct !== null && s.loss_pct > 2;
  return (
    <div className="border border-slate-200 rounded-lg p-3 flex-1 min-w-[220px]">
      <div className="text-xs font-semibold text-slate-500">{title}</div>
      <div className="text-2xl font-bold text-slate-800"><Mbps v={s.rx_avg} /></div>
      <div className="text-xs text-slate-500">
        de {s.target_mbps} pedidos ({s.pct_target}%) · mín {s.rx_min} / máx {s.rx_max}
      </div>
      <div className={"text-xs mt-1 " + (bad ? "text-red-600 font-semibold" : "text-slate-500")}>
        Pérdida: {s.loss_pct === null ? "n/d" : `${s.loss_pct}%`}
      </div>
    </div>
  );
}

export default function SaturationTool({ connection, manualItems, allItems, onAttachImage, onAttachOutput }: {
  connection: Connection;
  manualItems: ItemOption[];
  allItems: ItemOption[];
  onAttachImage: (itemId: string, path: string, url: string) => void;
  onAttachOutput: (itemId: string, output: string) => void;
}) {
  const [info, setInfo] = useState<NetInfo | null>(null);
  const [infoErr, setInfoErr] = useState("");

  const [mode, setMode] = usePersistentState<"icmp" | "udp">("sat.mode", "icmp");
  const [kind, setKind] = usePersistentState<Kind>("sat.kind", "cabecera");
  const [targets, setTargets] = usePersistentState<Targets>("sat.targets", { cabecera: "", dg: "", siguiente_salto: "", manual: "" });
  const [source, setSource] = usePersistentState("sat.source", "");
  const [up, setUp] = usePersistentState("sat.up", 100);
  const [down, setDown] = usePersistentState("sat.down", 100);
  const [duration, setDuration] = usePersistentState("sat.duration", 30);
  const [size, setSize] = usePersistentState("sat.size", 1400);
  const [streams, setStreams] = usePersistentState("sat.streams", 1);
  const [port, setPort] = usePersistentState("sat.port", 5301);
  const [key, setKey] = usePersistentState("sat.key", "");
  const [titulo, setTitulo] = usePersistentState("sat.titulo", "Prueba de saturación");

  const [doCapture, setDoCapture] = usePersistentState("sat.doCapture", false);
  const [wanCmd, setWanCmd] = usePersistentState("sat.wanCmd", "show policy-map interface GigabitEthernet0/0/0");
  const [supCmd, setSupCmd] = usePersistentState("sat.supCmd", "");
  const [capAfter, setCapAfter] = usePersistentState("sat.capAfter", 15);

  const [logs, setLogs] = usePersistentState<string[]>("sat.logs", [], MEM);
  const [running, setRunning] = usePersistentState("sat.running", false, MEM);
  const [result, setResult] = usePersistentState<SatResult | null>("sat.result", null, MEM);
  const [imgItem, setImgItem] = usePersistentState("sat.imgItem", "", MEM);
  const [wanItem, setWanItem] = usePersistentState("sat.wanItem", "", MEM);
  const [supItem, setSupItem] = usePersistentState("sat.supItem", "", MEM);
  const cancelRef = useRef<(() => void) | null>(null);

  const [agentOn, setAgentOn] = useState(false);
  const [agentMsg, setAgentMsg] = useState("");

  function loadInfo() {
    api.get("/tools/net-info")
      .then((r) => {
        const data = r.data as NetInfo;
        setInfo(data);
        setInfoErr("");
        // Si aún no hay DG escrita, se propone la detectada.
        if (data.gateways.length && !targets.dg) setTargets((t) => ({ ...t, dg: data.gateways[0].gateway }));
        if (data.gateways.length && !source) setSource(data.gateways[0].iface_ip || "");
      })
      .catch((e) => setInfoErr(apiErrorMessage(e, "No se pudo leer la red de este PC")));
    api.get("/tools/agente").then((r) => setAgentOn(!!r.data.running)).catch(() => {});
  }
  useEffect(loadInfo, []);

  const target = (targets[kind] || "").trim();
  const setTarget = (v: string) => setTargets((t) => ({ ...t, [kind]: v }));

  function start() {
    if (!target) { alert("Escribe la IP de destino."); return; }
    if (up <= 0 && down <= 0) { alert("Indica los Mbps de subida y/o bajada."); return; }
    if (doCapture && !wanCmd.trim()) { alert("Escribe el comando de captura WAN o desmarca la captura en el router."); return; }
    if (doCapture && connection.mode === "ssh" && !connection.host) {
      alert("Para capturar en el router configura primero la conexión en la pestaña 'Ejecutar / Generar PDF'."); return;
    }
    setLogs([]); setResult(null); setRunning(true);
    cancelRef.current = runStreaming("/tools/saturacion", {
      mode, target, target_kind: kind, port, up_mbps: up, down_mbps: down, duration, size, streams,
      source_ip: source, key, titulo,
      capture: doCapture ? {
        connection, wan_cmd: wanCmd, sup_cmd: supCmd || null, after_s: capAfter || null,
      } : null,
    }, (ev) => {
      if (ev.type === "log") setLogs((l) => [...l, ev.message]);
      else if (ev.type === "done") { setResult(ev.result as SatResult); setRunning(false); cancelRef.current = null; }
      else if (ev.type === "error") { setLogs((l) => [...l, "✖ ERROR: " + ev.message]); setRunning(false); cancelRef.current = null; }
    });
  }

  function stop() {
    setLogs((l) => [...l, "Deteniendo..."]);
    cancelRef.current?.();
  }

  async function toggleAgent() {
    try {
      if (agentOn) {
        await api.post("/tools/agente/stop");
        setAgentOn(false);
        setAgentMsg("Agente detenido.");
      } else {
        await api.post("/tools/agente/start", { port, key });
        setAgentOn(true);
        setAgentMsg(`Agente escuchando en UDP ${port}. Desde el otro equipo apunta a la IP de este PC.`);
      }
    } catch (e) {
      setAgentMsg(apiErrorMessage(e, "No se pudo cambiar el estado del agente"));
    }
  }

  function attachImage() {
    if (!result || !imgItem) return;
    onAttachImage(imgItem, result.image.path, result.image.url);
    alert("Imagen asignada al ítem. Ve a 'Ejecutar / Generar PDF' para verla.");
  }
  function attachOutputs() {
    if (!result) return;
    let n = 0;
    if (wanItem && result.wan_output) { onAttachOutput(wanItem, result.wan_output); n++; }
    if (supItem && result.sup_output) { onAttachOutput(supItem, result.sup_output); n++; }
    alert(n ? "Capturas asignadas. En 'Ejecutar / Generar PDF' deja esos ítems en modo Automático." : "Elige primero el ítem de destino.");
  }

  const needsAdmin = mode === "icmp" && info && !info.is_admin;
  const symmetric = mode === "icmp";

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">⚡ Saturación propia (bidireccional, en Mbps)</h3>
        <p className="text-xs text-slate-500 mt-1">
          Genera tráfico desde <b>este PC</b> hacia la IP elegida y mide cuánto pasa realmente. Sirve para Internet y para
          RPV (sin salida a Internet). Cuando termina crea una imagen de evidencia con la gráfica.
        </p>
      </div>

      {/* Modo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className={"border rounded-lg p-3 cursor-pointer text-sm " + (mode === "icmp" ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
          <input type="radio" className="mr-2" checked={mode === "icmp"} onChange={() => setMode("icmp")} />
          <b>Eco ICMP</b> — sin agente
          <div className="text-xs text-slate-500 mt-1">
            Pings grandes a cualquier IP que responda (cabecera, DG, siguiente salto). Cada ping usa subida y bajada a la vez.
            Si el destino es un router, puede limitar el ICMP.
          </div>
        </label>
        <label className={"border rounded-lg p-3 cursor-pointer text-sm " + (mode === "udp" ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
          <input type="radio" className="mr-2" checked={mode === "udp"} onChange={() => setMode("udp")} />
          <b>UDP con agente</b> — medición real
          <div className="text-xs text-slate-500 mt-1">
            Subida y bajada independientes, con pérdida real por sentido. Necesita el agente corriendo en el otro extremo
            (cabecera, un VPS o tu otra laptop).
          </div>
        </label>
      </div>

      {needsAdmin && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
          El modo ICMP necesita permisos de administrador. {info?.platform === "Windows"
            ? "Cierra el programa y ábrelo \"como administrador\"."
            : "Ejecuta el backend con sudo."} Si no puedes, usa el modo UDP con agente.
        </div>
      )}

      {/* Origen / destino */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Destino</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">IP de destino</label>
          <input className="input" placeholder="ej. 10.20.30.1" value={targets[kind]} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div>
          <label className="label">IP de este PC (origen)</label>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Automática (según la ruta al destino)</option>
            {info?.interfaces.map((i) => (
              <option key={i.name + i.ip} value={i.ip}>{i.ip} — {i.name}{i.gateway ? ` (DG ${i.gateway})` : ""}</option>
            ))}
          </select>
          {infoErr && <p className="text-xs text-red-600 mt-1">{infoErr}</p>}
        </div>
        {kind === "dg" && info && (
          <div className="text-xs text-slate-500 self-end pb-2">
            DG detectada: {info.gateways.length ? info.gateways.map((g) => g.gateway).join(", ") : "ninguna"}.{" "}
            <button className="underline" onClick={loadInfo}>Volver a detectar</button>
          </div>
        )}
      </div>
      {kind === "dg" && (
        <p className="text-xs text-slate-500">
          Ojo: si la DG es el router del cliente (lado LAN), el tráfico <b>no cruza el enlace WAN</b>. Para validar el enlace usa
          la IP de cabecera o el siguiente salto del lado del proveedor.
        </p>
      )}

      {/* Caudal */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="label">Subida (Mbps)</label>
          <input className="input" type="number" min={0} value={up}
            onChange={(e) => { const v = Number(e.target.value); setUp(v); if (symmetric) setDown(v); }} />
        </div>
        <div>
          <label className="label">Bajada (Mbps)</label>
          <input className="input" type="number" min={0} value={down} disabled={symmetric}
            onChange={(e) => setDown(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Duración (s)</label>
          <input className="input" type="number" min={3} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Paquete IP (bytes)</label>
          <input className="input" type="number" min={64} max={1500} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </div>
        {mode === "udp" && (
          <>
            <div>
              <label className="label">Flujos paralelos</label>
              <input className="input" type="number" min={1} max={8} value={streams} onChange={(e) => setStreams(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Puerto UDP del agente</label>
              <input className="input" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Clave (opcional)</label>
              <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} />
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Pon un caudal igual o un poco mayor al contratado para ver dónde corta el enlace. {symmetric
          ? "En ICMP la bajada siempre es igual a la subida."
          : "Si el PC no logra generar el caudal pedido, el resultado lo avisa (sube los flujos)."}
      </p>

      {/* Captura en el router */}
      <div className="border border-slate-200 rounded-lg p-3 space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={doCapture} onChange={(e) => setDoCapture(e.target.checked)} />
          Capturar en el router mientras hay saturación (WAN y SUP)
        </label>
        {doCapture && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="label">Comando WAN</label><input className="input" value={wanCmd} onChange={(e) => setWanCmd(e.target.value)} /></div>
            <div><label className="label">Comando SUP (opcional)</label><input className="input" value={supCmd} onChange={(e) => setSupCmd(e.target.value)} /></div>
            <div><label className="label">Capturar a los (s)</label><input className="input" type="number" min={2} value={capAfter} onChange={(e) => setCapAfter(Number(e.target.value))} /></div>
            <p className="sm:col-span-3 text-xs text-slate-500">
              Usa la conexión configurada en "Ejecutar / Generar PDF". La captura se hace con el tráfico ya a régimen, sin detenerlo.
            </p>
          </div>
        )}
      </div>

      <div><label className="label">Título de la evidencia</label><input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>

      <div className="flex gap-2 flex-wrap">
        <button className="btn-primary" disabled={running} onClick={start}>{running ? "Saturando..." : "Iniciar saturación"}</button>
        {running && <button className="btn-secondary" onClick={stop}>Detener</button>}
      </div>

      <LiveLog lines={logs} />

      {result && (
        <div className="space-y-3">
          {result.cancelled && <p className="text-xs text-amber-700">Prueba detenida antes de tiempo: los valores son parciales.</p>}
          <div className="flex flex-wrap gap-3">
            {result.up && <SideCard title={result.mode === "icmp" ? "IDA + VUELTA (eco recibido)" : "SUBIDA (llegó al agente)"} s={result.up} />}
            {result.mode === "udp" && result.down && <SideCard title="BAJADA (recibida en este PC)" s={result.down} />}
            {result.rtt && (
              <div className="border border-slate-200 rounded-lg p-3 flex-1 min-w-[220px]">
                <div className="text-xs font-semibold text-slate-500">LATENCIA</div>
                <div className="text-2xl font-bold text-slate-800">{result.rtt.avg} ms</div>
                <div className="text-xs text-slate-500">mín {result.rtt.min} / máx {result.rtt.max} · jitter {result.rtt.jitter}</div>
              </div>
            )}
          </div>
          {result.notes.map((n, i) => (
            <p key={i} className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2">{n}</p>
          ))}
          <div className="flex items-start gap-3 flex-wrap">
            <img src={result.image.url} alt="evidencia de saturación" className="w-72 rounded border border-slate-200" />
            <div className="flex-1 min-w-[240px] space-y-2">
              <div className="flex items-center gap-2">
                <select className="input" value={imgItem} onChange={(e) => setImgItem(e.target.value)}>
                  <option value="">-- asignar imagen a ítem manual... --</option>
                  {manualItems.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
                <button className="btn-secondary" onClick={attachImage}>Asignar</button>
              </div>
              <a className="text-xs underline text-brand-700" href={result.image.url} target="_blank" rel="noreferrer">Abrir imagen</a>
            </div>
          </div>
          {(result.wan_output || result.sup_output) && (
            <div className="space-y-2">
              {result.wan_output && <pre className="bg-slate-900 text-slate-200 text-xs p-3 rounded-lg whitespace-pre-wrap max-h-60 overflow-auto">{result.wan_output}</pre>}
              {result.sup_output && <pre className="bg-slate-900 text-slate-200 text-xs p-3 rounded-lg whitespace-pre-wrap max-h-60 overflow-auto">{result.sup_output}</pre>}
              <div className="flex gap-2 items-center flex-wrap">
                <select className="input" value={wanItem} onChange={(e) => setWanItem(e.target.value)}>
                  <option value="">-- ítem para la captura WAN --</option>
                  {allItems.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
                {result.sup_output && (
                  <select className="input" value={supItem} onChange={(e) => setSupItem(e.target.value)}>
                    <option value="">-- ítem para la captura SUP --</option>
                    {allItems.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                )}
                <button className="btn-secondary" onClick={attachOutputs}>Asignar capturas</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Agente */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        <h4 className="text-sm font-semibold text-slate-700">Agente (para ser el otro extremo)</h4>
        <p className="text-xs text-slate-500">
          Para el modo UDP, el otro lado debe tener un agente. Opciones: (1) activarlo aquí en este PC y probar desde otro equipo;
          (2) copiar solo el archivo <code className="bg-slate-100 px-1 rounded">backend/app/services/saturator.py</code> al
          equipo remoto y ejecutar <code className="bg-slate-100 px-1 rounded">python saturator.py server</code> (necesita solo Python,
          y permitir UDP {port} en el firewall).
        </p>
        <div className="flex items-center gap-3">
          <button className="btn-secondary" onClick={toggleAgent}>{agentOn ? "Detener agente en este PC" : "Iniciar agente en este PC"}</button>
          <span className={"text-xs " + (agentOn ? "text-green-600" : "text-slate-500")}>{agentOn ? "● activo" : "○ detenido"}</span>
        </div>
        {agentMsg && <p className="text-xs text-slate-500">{agentMsg}</p>}
      </div>
    </div>
  );
}
