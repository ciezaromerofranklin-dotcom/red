"""
serial_executor.py
Igual que ssh_executor.py pero conectándose por el puerto SERIAL/consola
del equipo (cable de consola USB-DB9), usando pyserial. Útil cuando el
switch/router todavía no tiene IP de gestión o SSH configurado.
"""

import re
import time
import serial
import serial.tools.list_ports

from app.services.session_utils import CliSession, SerialIO

ANSI_RE = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]")
MORE_PATTERNS = (b"--More--", b"---- More ----", b"--More(", b"<--- More --->", b"-- more --")


def list_serial_ports():
    """Devuelve lista de puertos disponibles, ej. ['COM3', 'COM5'] o ['/dev/ttyUSB0']."""
    return [p.device for p in serial.tools.list_ports.comports()]


def _strip_ansi(data: bytes) -> bytes:
    return ANSI_RE.sub(b"", data)


def _read_chunk(ser, quiet_time=1.2, max_time=20, on_more_send=b" "):
    end_by = time.time() + max_time
    buf = b""
    last_data = time.time()
    while time.time() < end_by:
        n = ser.in_waiting
        if n:
            chunk = ser.read(n)
            buf += chunk
            last_data = time.time()
            if any(p in buf[-200:] for p in MORE_PATTERNS):
                ser.write(on_more_send)
        else:
            if time.time() - last_data > quiet_time:
                break
            time.sleep(0.1)
    return _strip_ansi(buf).decode(errors="ignore")


def run_automatic_session_serial(com_port, baudrate, disable_paging_cmds,
                                  config_test, tests, save_cmds=None,
                                  timeout=12, progress_cb=None):
    """
    Misma firma de resultado que ssh_executor.run_automatic_session:
      config_text: str
      results: list[(key, label, cmd, output_text)]
    """
    def log(msg):
        if progress_cb:
            progress_cb(msg)

    log(f"Abriendo puerto serial {com_port} @ {baudrate} baudios ...")
    try:
        ser = serial.Serial(port=com_port, baudrate=int(baudrate), timeout=1,
                             bytesize=serial.EIGHTBITS, parity=serial.PARITY_NONE,
                             stopbits=serial.STOPBITS_ONE)
    except serial.SerialException as e:
        raise RuntimeError(f"No se pudo abrir {com_port}: {e} (¿otro programa — PuTTY/SecureCRT — lo tiene abierto?)")

    try:
        sess = CliSession(SerialIO(ser), eol=b"\r\n")
        prompt = sess.login_sync()
        log(f"Prompt detectado: {prompt}" if prompt else "No se detectó el prompt: se usará el modo por silencio.")

        for cmd in (disable_paging_cmds or []):
            log(f"Configurando terminal: {cmd}")
            sess.run(cmd, log)

        config_text = ""
        if config_test:
            key, label, cmd = config_test
            log(f"Ejecutando: {label} ({cmd})")
            config_text = sess.run(cmd, log)

        results = []
        for key, label, cmd in tests:
            log(f"Ejecutando: {label} ({cmd})")
            results.append((key, label, cmd, sess.run(cmd, log)))

        for cmd in (save_cmds or []):
            log(f"Guardando configuración: {cmd}")
            sess.run(cmd, log)
    finally:
        ser.close()
    log("Sesión serial finalizada.")
    return config_text, results


def send_raw_lines_serial(com_port, baudrate, lines, progress_cb=None, per_line_wait=0.8):
    """Envía una lista de líneas de configuración tal cual (para aplicar plantillas)
    y devuelve el log completo de lo que respondió el equipo."""
    def log(msg):
        if progress_cb:
            progress_cb(msg)

    log(f"Abriendo puerto serial {com_port} @ {baudrate} baudios ...")
    ser = serial.Serial(port=com_port, baudrate=baudrate, timeout=1,
                         bytesize=serial.EIGHTBITS, parity=serial.PARITY_NONE,
                         stopbits=serial.STOPBITS_ONE)
    time.sleep(0.5)
    ser.write(b"\r\n")
    _read_chunk(ser, quiet_time=0.8, max_time=4)

    full_log = []
    for line in lines:
        if not line.strip():
            continue
        log(f">> {line}")
        ser.write((line + "\r\n").encode())
        out = _read_chunk(ser, quiet_time=per_line_wait, max_time=15)
        full_log.append(f"{line}\n{out}")

    ser.close()
    log("Aplicación de comandos finalizada (serial).")
    return "\n".join(full_log)
