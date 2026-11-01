export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "2026-08-29" -> {y, m (1-12), d}. Se lee a mano para que la zona horaria no corra el día. */
export function parseIso(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

export function dayLabel(iso: string): string {
  const p = parseIso(iso);
  if (!p) return "Sin fecha";
  const dow = new Date(p.y, p.m - 1, p.d).getDay();
  return `${DIAS[dow]} ${p.d} de ${MESES[p.m - 1].toLowerCase()}`;
}

export function shortDate(iso: string | null | undefined): string {
  const p = parseIso(iso);
  return p ? `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}` : "—";
}

export function dateTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  return d.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const MODULO_LABEL: Record<string, string> = {
  checklist: "CheckList",
  fotografico_fibra: "RF Fibra",
  fotografico_gpon_ont: "RF GPON ONT",
  fotografico_gpon_modulo: "RF GPON módulo",
  poder_judicial: "RF Poder Judicial",
  plantillas: "Plantillas",
};
