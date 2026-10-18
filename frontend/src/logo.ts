/**
 * Logo elegido para la cabecera de un PDF:
 *  - guardado en la base de datos  -> `id` con valor
 *  - subido solo para este reporte -> `path` con valor
 */
export interface LogoSel {
  id: string | null;
  path: string;
  url: string;
}

export const NO_LOGO: LogoSel = { id: null, path: "", url: "" };

/** Campos que el backend espera para un logo: <prefijo>_id y <prefijo>_path. */
export function logoPayload(sel: LogoSel, prefix: string) {
  return {
    [`${prefix}_id`]: sel.id,
    [`${prefix}_path`]: sel.id ? null : sel.path || null,
  };
}
