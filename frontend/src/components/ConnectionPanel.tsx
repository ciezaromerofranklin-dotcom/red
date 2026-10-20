import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Connection, Vendor } from "../types";

interface Props {
  vendors: Vendor[];
  vendorKey: string;
  onVendorChange: (key: string) => void;
  deviceType?: "switch" | "router";
  onDeviceTypeChange?: (t: "switch" | "router") => void;
  connection: Connection;
  onConnectionChange: (c: Connection) => void;
  showDeviceType?: boolean;
}

export default function ConnectionPanel({
  vendors, vendorKey, onVendorChange, deviceType, onDeviceTypeChange,
  connection, onConnectionChange, showDeviceType = true,
}: Props) {
  const [ports, setPorts] = useState<string[]>([]);

  useEffect(() => {
    if (connection.mode === "serial") refreshPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.mode]);

  async function refreshPorts() {
    try {
      const { data } = await api.get("/serial/ports");
      setPorts(data.ports || []);
    } catch {
      setPorts([]);
    }
  }

  function setMode(mode: "ssh" | "serial") {
    if (mode === "ssh") {
      onConnectionChange({ mode: "ssh", host: "", port: 22, user: "", password: "" });
    } else {
      onConnectionChange({ mode: "serial", com_port: "", baudrate: 9600 });
    }
  }

  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">Conexión al equipo</h3>

      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={connection.mode === "ssh"} onChange={() => setMode("ssh")} />
          SSH (red)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={connection.mode === "serial"} onChange={() => setMode("serial")} />
          Serial (consola)
        </label>
      </div>

      <div>
        <label className="label">Marca del equipo</label>
        <select className="input" value={vendorKey} onChange={(e) => onVendorChange(e.target.value)}>
          {vendors.map((v) => (
            <option key={v.key} value={v.key}>{v.label}</option>
          ))}
        </select>
      </div>

      {showDeviceType && onDeviceTypeChange && (
        <div>
          <label className="label">Tipo de equipo</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={deviceType === "switch"} onChange={() => onDeviceTypeChange("switch")} />
              Switch
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={deviceType === "router"} onChange={() => onDeviceTypeChange("router")} />
              Router
            </label>
          </div>
        </div>
      )}

      {connection.mode === "ssh" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">IP de gestión</label>
            <input className="input" value={connection.host}
              onChange={(e) => onConnectionChange({ ...connection, host: e.target.value })} />
          </div>
          <div>
            <label className="label">Puerto</label>
            <input className="input" type="number" value={connection.port}
              onChange={(e) => onConnectionChange({ ...connection, port: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Usuario</label>
            <input className="input" value={connection.user}
              onChange={(e) => onConnectionChange({ ...connection, user: e.target.value })} />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={connection.password}
              onChange={(e) => onConnectionChange({ ...connection, password: e.target.value })} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <div>
            <label className="label">Puerto COM</label>
            <select className="input" value={connection.com_port}
              onChange={(e) => onConnectionChange({ ...connection, com_port: e.target.value })}>
              <option value="">-- elegir --</option>
              {ports.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="label">Baudrate</label>
              <select className="input" value={connection.baudrate}
                onChange={(e) => onConnectionChange({ ...connection, baudrate: Number(e.target.value) })}>
                {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <button type="button" className="btn-secondary" onClick={refreshPorts}>Detectar</button>
          </div>
          <p className="sm:col-span-2 text-xs text-slate-400">
            Los puertos listados son los del servidor donde corre el backend (útil para ejecución local).
          </p>
        </div>
      )}
    </div>
  );
}
