/** Puente para pasar un informe Poder Judicial leído de un PDF a su pantalla. */
let pending: unknown = null;

export function savePjForm(state: unknown): void {
  pending = state;
}

export function takePjForm(): unknown {
  const v = pending;
  pending = null;
  return v;
}
