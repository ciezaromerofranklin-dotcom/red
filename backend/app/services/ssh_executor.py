"""
ssh_executor.py
Ejecuta una sesión SSH automática contra el equipo (switch/router), como lo
haría un técnico en SecureCRT o MobaXterm, pero sin intervención manual:
  1. Se conecta.
  2. Desactiva el paginado (si aplica a la marca).
  3. Ejecuta el comando de configuración actual (current-config / running-config).
  4. Ejecuta cada prueba de la lista de la marca/tipo de equipo.
  5. Devuelve todo el texto capturado, listo para pegar en el PDF.

Usa paramiko (librería SSH en Python puro) para que funcione igual en
Windows/Linux/Mac y se pueda empaquetar en el .exe sin depender de
programas externos como PuTTY, sshpass, etc.
"""

import re
import socket
import time
import paramiko

from app.services.session_utils import CliSession, SshIO

ANSI_RE = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]")
MORE_PATTERNS = (b"--More--", b"---- More ----", b"--More(", b"<--- More --->", b"-- more --")


def _strip_ansi(data: bytes) -> bytes:
    return ANSI_RE.sub(b"", data)


def _read_chunk(chan, quiet_time=1.2, max_time=20, on_more_send=b" "):
    """Lee del canal hasta que no llegue nada nuevo durante 'quiet_time' segundos,
    manejando prompts de paginación tipo '--More--' enviando espacio."""
    end_by = time.time() + max_time
    buf = b""
    last_data = time.time()
    while time.time() < end_by:
        if chan.recv_ready():
            chunk = chan.recv(65535)
            buf += chunk
            last_data = time.time()
            if any(p in buf[-200:] for p in MORE_PATTERNS):
                chan.send(on_more_send)
        else:
            if time.time() - last_data > quiet_time:
                break
            time.sleep(0.1)
    return _strip_ansi(buf).decode(errors="ignore")


def connect_ssh(host, port, user, password, timeout=12, log=None):
    """Abre la conexión SSH con mensajes de error entendibles."""
    if log:
        log(f"Conectando a {host}:{port} ...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, port=int(port), username=user, password=password,
                       timeout=timeout, look_for_keys=False, allow_agent=False,
                       banner_timeout=timeout, auth_timeout=timeout)
    except paramiko.AuthenticationException:
        raise RuntimeError(f"Usuario o contraseña incorrectos para {user}@{host}.")
    except (socket.timeout, TimeoutError):
        raise RuntimeError(f"Tiempo agotado conectando a {host}:{port}. Revisa la IP, la ruta/VLAN y que SSH esté habilitado.")
    except (ConnectionRefusedError, paramiko.ssh_exception.NoValidConnectionsError):
        raise RuntimeError(f"{host}:{port} rechazó la conexión (¿SSH habilitado en el equipo? ¿puerto correcto?).")
    except paramiko.SSHException as e:
        raise RuntimeError(f"Error SSH con {host}:{port}: {e}")
    except OSError as e:
        raise RuntimeError(f"No se pudo llegar a {host}:{port}: {e}")
    return client


def run_automatic_session(host, user, password, port, disable_paging_cmds,
                           config_test, tests, save_cmds=None,
                           timeout=12, progress_cb=None):
    """
    Ejecuta la sesión completa y devuelve:
      config_text: str  -> salida del comando de configuración actual
      results: list[(key, label, cmd, output_text)]  -> una por cada prueba

    config_test: (key, label, cmd)
    tests: lista [(key, label, cmd), ...]

    Cada comando termina cuando vuelve el prompt del equipo (ver session_utils),
    así las capturas ya no se cortan ni se mezclan entre comandos.
    """
    def log(msg):
        if progress_cb:
            progress_cb(msg)

    client = connect_ssh(host, port, user, password, timeout=timeout, log=log)
    try:
        chan = client.invoke_shell(width=250, height=1000)
        sess = CliSession(SshIO(chan))
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

        chan.close()
    finally:
        client.close()
    log("Sesión SSH finalizada.")
    return config_text, results


def send_raw_lines_ssh(host, user, password, port, lines, progress_cb=None,
                        per_line_wait=0.8, timeout=12):
    """Envía una lista de líneas de configuración tal cual por SSH (para aplicar
    plantillas) y devuelve el log completo de lo que respondió el equipo."""
    def log(msg):
        if progress_cb:
            progress_cb(msg)

    log(f"Conectando a {host}:{port} ...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password,
                    timeout=timeout, look_for_keys=False, allow_agent=False,
                    banner_timeout=timeout, auth_timeout=timeout)
    chan = client.invoke_shell()
    time.sleep(1)
    _read_chunk(chan, quiet_time=0.8, max_time=4)

    full_log = []
    for line in lines:
        if not line.strip():
            continue
        log(f">> {line}")
        chan.send(line + "\n")
        out = _read_chunk(chan, quiet_time=per_line_wait, max_time=15)
        full_log.append(f"{line}\n{out}")

    chan.close()
    client.close()
    log("Aplicación de comandos finalizada (SSH).")
    return "\n".join(full_log)
