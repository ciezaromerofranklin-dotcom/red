import type { Connection } from "./types";

/** La contraseña del equipo NO se guarda en el disco del navegador (solo en memoria). */
export function withoutPassword(c: Connection): Connection {
  return c.mode === "ssh" ? { ...c, password: "" } : c;
}

export const DEFAULT_CONNECTION: Connection = {
  mode: "ssh",
  host: "",
  port: 22,
  user: "",
  password: "",
};
