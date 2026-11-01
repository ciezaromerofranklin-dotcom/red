import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import { usePersistentState } from "../store/persistentState";
import { MODULO_LABEL, shortDate } from "../utils/fechas";
import type { ClientRec } from "../pages/ClientsPage";

/** Lo que una ventana quiere guardar del cliente (el mismo formato que /api/clients/upsert). */
export interface ClientSave {
  sot: string; cliente?: string; cid?: string; fecha?: string; modulo: string; datos?: Record<string, any>;
}

/**
 * Botones «Cargar datos de cliente» y «Guardar cliente», para usar en cualquier ventana.
 *  - onPick recibe el cliente elegido y cada ventana toma SOLO los datos que necesita.
 *  - getSave arma lo que esa ventana sabe del cliente; se guarda por SOT (si ya existe se actualiza).
 *  - El último cliente elegido se recuerda entre ventanas (útil donde no hay campo SOT, como Plantillas).
 */
export default function ClientPicker({ onPick, getSave, takes, compact = false }: {
  onPick: (rec: ClientRec) => void;
  getSave?: () => ClientSave | null;
  /** Texto corto de qué datos toma esta ventana, p. ej. "SOT, cliente, CID, fecha y las IPs". */
  takes?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<ClientRec[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = usePersistentState<{ sot: string; cliente: string } | null>("client.current", null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      api.get("/clients", { params: { q } })
        .then((r) => { setList((r.data as ClientRec[]).slice(0, 60)); setError(""); })
        .catch((e) => setError(apiErrorMessage(e, "No se pudieron cargar tus clientes.")));
    }, 200);
    return () => window.clearTimeout(t);
  }, [open, q]);

  function pick(r: ClientRec) {
    setCurrent({ sot: r.sot, cliente: r.cliente });
    onPick(r);
    setOpen(false);
  }

  async function save() {
    const data = getSave?.();
    if (!data || !data.sot.trim()) { alert("Falta el SOT del cliente: escríbelo (o carga un cliente) para poder guardarlo."); return; }
    setBusy(true);
    try {
      const { data: rec } = await api.post("/clients/upsert", { sot: data.sot, cliente: data.cliente ?? "", cid: data.cid ?? "", fecha: data.fecha ?? "", modulo: data.modulo, datos: data.datos ?? {} });
      setCurrent({ sot: rec.sot, cliente: rec.cliente });
      alert(`Cliente SOT ${rec.sot} guardado${rec.fecha ? "" : " (sin fecha válida: escribe la fecha como 29/08/2026 para ubicarlo en el mes)"}.`);
    } catch (e) { alert(apiErrorMessage(e, "No se pudo guardar el cliente.")); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2"}`}>
        <button type="button" className="btn-secondary text-xs" onClick={() => setOpen(true)}>📥 Cargar datos de cliente</button>
        {getSave && <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={save}>💾 Guardar cliente</button>}
        {current && <span className="text-[11px] text-slate-500">Último: <b>{current.sot}</b>{current.cliente ? ` · ${current.cliente}` : ""}</span>}
        {takes && <span className="text-[11px] text-slate-400">Toma: {takes}</span>}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg space-y-3 max-h-[85dvh] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Elige un cliente</h3>
              <button className="text-slate-400 hover:text-slate-700" onClick={() => setOpen(false)} aria-label="Cerrar">✕</button>
            </div>
            <input className="input" autoFocus placeholder="Buscar por SOT, cliente o CID..." value={q} onChange={(e) => setQ(e.target.value)} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="overflow-y-auto divide-y border rounded-lg">
              {list.length === 0 && <p className="p-4 text-sm text-slate-500">No hay clientes{q ? " con esa búsqueda" : " guardados todavía. Se guardan al generar un PDF con SOT o con «Guardar cliente»"}.</p>}
              {list.map((r) => (
                <button key={r.id} className="w-full text-left px-3 py-2 hover:bg-brand-50" onClick={() => pick(r)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-sm">{r.sot}</span>
                    <span className="text-xs text-slate-400">{shortDate(r.fecha)}</span>
                  </div>
                  <div className="text-sm text-slate-700">{r.cliente || <span className="text-slate-400">sin nombre</span>}</div>
                  <div className="text-[10px] text-slate-400">{r.modulos.map((m) => MODULO_LABEL[m] ?? m).join(" · ")}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
