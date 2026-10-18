import { useEffect, useState } from "react";
import { api, apiErrorMessage, runStreaming } from "../api/client";
import ConnectionPanel from "../components/ConnectionPanel";
import LiveLog from "../components/LiveLog";
import LogoPicker from "../components/LogoPicker";
import Spinner from "../components/Spinner";
import { withoutPassword } from "../connection";
import { NO_LOGO, logoPayload } from "../logo";
import type { LogoSel } from "../logo";
import { usePersistentState } from "../store/persistentState";
import type { Connection, Vendor } from "../types";

type TestsResult = { config_text: string; results: any[] };
type PdfResult = { url: string; filename: string; warnings: string[] };

export default function PruebasPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);

  // Todo este estado sobrevive al cambio de página (y a recargar, salvo lo
  // marcado como solo-memoria).
  const [vendorKey, setVendorKey] = usePersistentState("pruebas.vendorKey", "huawei");
  const [deviceType, setDeviceType] = usePersistentState<"switch" | "router">("pruebas.deviceType", "switch");
  const [connection, setConnection] = usePersistentState<Connection>(
    "pruebas.connection",
    { mode: "ssh", host: "", port: 22, user: "", password: "" },
    { serialize: withoutPassword }
  );

  const [deviceId, setDeviceId] = usePersistentState("pruebas.deviceId", "");
  const [sede, setSede] = usePersistentState("pruebas.sede", "");
  const [fecha, setFecha] = usePersistentState("pruebas.fecha", () => new Date().toLocaleDateString("es-PE"));
  const [uplink, setUplink] = usePersistentState("pruebas.uplink", "");
  const [ping, setPing] = usePersistentState("pruebas.ping", "");

  const [logoIzq, setLogoIzq] = usePersistentState<LogoSel>("pruebas.logoIzq", NO_LOGO);
  const [logoDer, setLogoDer] = usePersistentState<LogoSel>("pruebas.logoDer", NO_LOGO);

  // Resultados de la ejecución: en memoria (pueden ser grandes).
  const mem = { persist: false };
  const [logs, setLogs] = usePersistentState<string[]>("pruebas.logs", [], mem);
  const [running, setRunning] = usePersistentState("pruebas.running", false, mem);
  const [result, setResult] = usePersistentState<TestsResult | null>("pruebas.result", null, mem);
  const [generating, setGenerating] = usePersistentState("pruebas.generating", false, mem);
  const [pdf, setPdf] = usePersistentState<PdfResult | null>("pruebas.pdf", null, mem);
  const [pdfError, setPdfError] = usePersistentState<string | null>("pruebas.pdfError", null, mem);

  useEffect(() => {
    api.get("/vendors").then((r) => setVendors(r.data));
  }, []);

  function runTests() {
    setLogs([]);
    setResult(null);
    setPdf(null);
    setPdfError(null);
    setRunning(true);
    runStreaming("/tests/run", {
      connection, vendor_key: vendorKey, device_type: deviceType, uplink, ping,
    }, (ev) => {
      if (ev.type === "log") setLogs((l) => [...l, ev.message]);
      else if (ev.type === "done") { setResult(ev.result); setRunning(false); }
      else if (ev.type === "error") { setLogs((l) => [...l, "✖ ERROR: " + ev.message]); setRunning(false); }
    });
  }

  async function generatePdf() {
    if (!result || generating) return;

    const vendorLabel = vendors.find((v) => v.key === vendorKey)?.label || vendorKey;
    const ip = connection.mode === "ssh" ? connection.host : connection.com_port;

    setGenerating(true);
    setPdf(null);
    setPdfError(null);

    try {
      const { data } = await api.post("/tests/pdf", {
        device_id: deviceId, ip, vendor_label: vendorLabel, sede, fecha,
        ...logoPayload(logoIzq, "logo_izq"),
        ...logoPayload(logoDer, "logo_der"),
        config_text: result.config_text, results: result.results,
      });
      setPdf({
        url: data.url,
        filename: data.filename,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      });
    } catch (e) {
      setPdfError(apiErrorMessage(e, "No se pudo generar el PDF."));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Pruebas automáticas</h2>
        <p className="text-slate-500 text-sm">Conecta al equipo, ejecuta las pruebas de la marca elegida, y arma el PDF de evidencia.</p>
      </div>

      <ConnectionPanel
        vendors={vendors} vendorKey={vendorKey} onVendorChange={setVendorKey}
        deviceType={deviceType} onDeviceTypeChange={setDeviceType}
        connection={connection} onConnectionChange={setConnection}
      />

      <div className="card grid grid-cols-3 gap-3">
        <div><label className="label">ID del equipo</label><input className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} /></div>
        <div><label className="label">Sede</label><input className="input" value={sede} onChange={(e) => setSede(e.target.value)} /></div>
        <div><label className="label">Fecha</label><input className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div><label className="label">Interfaz Uplink (opc.)</label><input className="input" value={uplink} onChange={(e) => setUplink(e.target.value)} /></div>
        <div><label className="label">IP para ping (opc.)</label><input className="input" value={ping} onChange={(e) => setPing(e.target.value)} /></div>
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">Logos para el PDF</h3>
        <LogoPicker posicion="izq" label="Izquierda (empresa)" value={logoIzq} onChange={setLogoIzq} />
        <LogoPicker posicion="der" label="Derecha (Claro)" value={logoDer} onChange={setLogoDer} />
      </div>

      <div className="flex gap-3">
        <button className="btn-primary" disabled={running} onClick={runTests}>
          {running ? <><Spinner /> Ejecutando...</> : "① Ejecutar pruebas"}
        </button>
        <button className="btn-secondary" disabled={!result || generating} aria-busy={generating} onClick={generatePdf}>
          {generating ? <><Spinner /> Generando PDF...</> : "② Generar PDF"}
        </button>
      </div>

      <LiveLog lines={logs} />

      {pdfError && (
        <div role="alert" className="card border-red-200 bg-red-50 text-sm text-red-700">{pdfError}</div>
      )}

      {pdf && (
        <div className="card bg-green-50 border-green-200 space-y-2">
          <p className="text-sm text-green-700">PDF generado correctamente.</p>
          {pdf.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700">
              {pdf.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <a className="btn-primary" href={pdf.url} target="_blank" rel="noreferrer">Descargar PDF</a>
        </div>
      )}
    </div>
  );
}
