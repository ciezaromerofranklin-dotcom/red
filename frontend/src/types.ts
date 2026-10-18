export interface Vendor {
  key: string;
  label: string;
}

export interface Service {
  clave: string;
  etiqueta: string;
}

export interface Fragment {
  id: string;
  nombre: string;
  marca: string;
  modelos_compatibles: string;
  servicios: string[];
  orden: number;
  texto: string;
}

export interface ChecklistItem {
  id: string;
  servicio: string;
  seccion: string;
  nombre: string;
  orden: number;
  modo: "auto" | "manual";
  comando: string;
}

export interface PhotoItem {
  id: string;
  categoria: string;
  nombre: string;
  orden: number;
}

export type ConnMode = "ssh" | "serial";

export interface SshConnection {
  mode: "ssh";
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface SerialConnection {
  mode: "serial";
  com_port: string;
  baudrate: number;
}

export type Connection = SshConnection | SerialConnection;

export interface ExtraLanNetwork {
  ip: string;
  mask: string;
  prefix_len: string;
}

/** Logo de cabecera guardado en la base de datos. */
export interface HeaderLogo {
  id: string;
  posicion: "izq" | "der";
  nombre: string;
  url: string;
}
