"""
session_utils.py
Lectura confiable de la salida de un equipo (router/switch) por SSH o Serial.

Por qué existe:
  El código anterior daba por terminado un comando cuando el equipo llevaba
  ~1.3 s sin enviar nada. Con comandos lentos (ping, show running-config,
  traceroute, write memory) eso cortaba la salida a la mitad y el resto
  "se derramaba" en la captura del comando SIGUIENTE (capturas mezcladas).

  Ahora se aprende el prompt del equipo (ej. "RTR-CLIENTE#") y cada comando
  se da por terminado SOLO cuando ese prompt vuelve a aparecer. Si el
  comando se cuelga, se envía Ctrl+C y se re-sincroniza el prompt para que
  el siguiente comando no herede basura.
"""

import re
import time

ANSI_RE = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]")
MORE_PATTERNS = (b"--More--", b"---- More ----", b"--More(", b"<--- More --->", b"-- more --")
MORE_CLEAN_RE = re.compile(r" ?(?:--More--|---- More ----|<--- More --->|-- more --) ?(?:\x08+ *\x08*)?")

# Una línea que parece un prompt:
#   Cisco / Linux : "Router#", "RTR-01>", "RTR-01(config)#", "user@host>"
#   FortiGate     : "FGT-01 #", "FGT-01 (console) #"
#   Huawei VRP    : "<rINT_M&B-VERTICAL>" (vista usuario) y "[rINT_M&B-VERTICAL]" (vista sistema)
GENERIC_PROMPT_RE = re.compile(
    r"^(?:[\w.\-/@:~()&\[\] ]{1,80}[#>]|<[^<>\n]{1,80}>|\[[^\[\]\n]{1,80}\])\s?$"
)


def clean_text(data: bytes) -> str:
    """Quita colores ANSI, restos de '--More--', retrocesos y retornos de carro."""
    data = ANSI_RE.sub(b"", data)
    text = data.decode(errors="ignore")
    text = MORE_CLEAN_RE.sub("", text)
    text = text.replace("\x08", "").replace("\r\n", "\n").replace("\r", "")
    return text


def learn_prompt(text: str):
    """Devuelve el prompt del equipo (última línea no vacía) o None si no parece uno."""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return None
    last = lines[-1]
    return last if GENERIC_PROMPT_RE.match(last) else None


def make_prompt_matcher(prompt):
    """
    Devuelve una función texto -> bool que indica si el texto TERMINA en el
    prompt del equipo. Acepta el cambio de modo:
      Cisco    RTR-01#   -> RTR-01(config)#
      Fortinet FGT-01 #  -> FGT-01 (console) #
      Huawei   <RTR-01>  -> [RTR-01]  /  [RTR-01-GigabitEthernet0/0/1]
    """
    if not prompt:
        return None
    p = prompt.strip()
    if p[0] in "<[":  # Huawei
        host = re.escape(p[1:-1].split("-GigabitEthernet")[0].strip())
        pat = re.compile(rf"(?:^|\n)[<\[]{host}(?:-[^\]>\n]*)?[\]>]\s?$")
    else:
        host = re.escape(p[:-1].split("(")[0].strip())
        pat = re.compile(rf"(?:^|\n){host}\s?(?:\([^)\n]*\)\s?)?[#>]\s?$")
    return lambda text: bool(pat.search(text[-300:]))


# Respuestas automáticas SOLO para comandos que las necesitan (guardar la configuración).
# Cualquier otra pregunta interactiva (reload, delete...) NO se contesta sola.
CONFIRM_RULES = [
    # (el comando empieza con..., el texto termina en..., respuesta)
    (("save",), re.compile(r"\[Y/N\]\s*:?\s*$", re.I), "y"),
    (("copy running-config startup-config", "copy run start"), re.compile(r"\[startup-config\]\??\s*$", re.I), ""),
]


def command_max_time(cmd: str) -> int:
    """Tiempo máximo (s) que se espera por un comando antes de abortarlo."""
    c = cmd.strip().lower()
    if c.startswith(("ping", "traceroute", "tracert", "execute ping", "execute traceroute")):
        return 150
    if c.startswith(("show tech", "copy", "write", "wr ", "wr", "save", "show running", "show startup", "show config",
                     "display current", "display saved", "show full", "execute ping", "execute traceroute")):
        return 90
    return 45


class CliIO:
    """Adaptador mínimo: SSH (paramiko Channel) o Serial (pyserial) detrás de la misma interfaz."""

    def read_available(self) -> bytes:  # pragma: no cover - interfaz
        raise NotImplementedError

    def send(self, data: bytes) -> None:  # pragma: no cover - interfaz
        raise NotImplementedError


class SshIO(CliIO):
    def __init__(self, chan):
        self.chan = chan

    def read_available(self) -> bytes:
        return self.chan.recv(65535) if self.chan.recv_ready() else b""

    def send(self, data: bytes) -> None:
        self.chan.send(data)


class SerialIO(CliIO):
    def __init__(self, ser):
        self.ser = ser

    def read_available(self) -> bytes:
        n = self.ser.in_waiting
        return self.ser.read(n) if n else b""

    def send(self, data: bytes) -> None:
        self.ser.write(data)


def read_output(io, is_prompt=None, quiet_time=1.2, max_time=45, settle=0.35, idle_abort=20, confirm=None):
    """
    Lee hasta que el comando termina. Devuelve (texto, terminó_bien).

    - Con prompt conocido: termina cuando el prompt vuelve a aparecer.
    - Sin prompt conocido: termina tras `quiet_time` s sin datos (modo antiguo).
    - Responde "--More--" enviando espacio.
    - Si no llega NADA nuevo durante `idle_abort` s, o se pasa de `max_time`,
      devuelve terminó_bien=False.
    """
    end_by = time.time() + max_time
    buf = b""
    last_data = time.time()
    answered = False
    while time.time() < end_by:
        chunk = io.read_available()
        if chunk:
            buf += chunk
            last_data = time.time()
            if any(p in buf[-200:] for p in MORE_PATTERNS):
                io.send(b" ")
            continue
        idle = time.time() - last_data
        if confirm is not None and not answered and idle >= 0.5 and confirm[0].search(clean_text(buf)):
            io.send(confirm[1].encode() + b"\n")  # p. ej. "save" -> [Y/N]: y
            answered = True
            continue
        if is_prompt is not None:
            if idle >= settle and is_prompt(clean_text(buf)):
                return clean_text(buf), True
            if idle >= idle_abort:
                return clean_text(buf), False
        elif idle > quiet_time:
            return clean_text(buf), True
        time.sleep(0.05)
    return clean_text(buf), False


class CliSession:
    """Una sesión ya abierta con el equipo: aprende el prompt y ejecuta comandos de a uno."""

    def __init__(self, io, eol: bytes = b"\n"):
        self.io = io
        self.eol = eol
        self.prompt = None
        self.is_prompt = None

    def login_sync(self):
        """Despierta la consola, descarta el banner y aprende el prompt."""
        time.sleep(0.5)
        self.io.send(self.eol)
        text, _ = read_output(self.io, None, quiet_time=1.0, max_time=6)
        self.prompt = learn_prompt(text)
        self.is_prompt = make_prompt_matcher(self.prompt)
        return self.prompt

    def run(self, cmd: str, log=None):
        """Ejecuta un comando y devuelve su salida completa.

        Un comando puede tener varias líneas (p. ej. FortiGate:
        'execute ping-options repeat-count 30' + 'execute ping 8.8.8.8'): se envían de a
        una, esperando el prompt entre cada una, y las salidas se juntan.
        """
        lines = [l.strip() for l in cmd.splitlines() if l.strip()]
        if len(lines) > 1:
            return "\n".join(self._run_one(l, log) for l in lines)
        return self._run_one(lines[0] if lines else cmd.strip(), log)

    def _run_one(self, cmd: str, log=None):
        confirm = None
        low = cmd.lower()
        for starts, pat, answer in CONFIRM_RULES:
            if low.startswith(starts):
                confirm = (pat, answer)
                break
        self.io.send(cmd.encode() + self.eol)
        out, ok = read_output(self.io, self.is_prompt, quiet_time=1.3, max_time=command_max_time(cmd), confirm=confirm)
        if not ok and self.is_prompt is not None:
            if log:
                log(f"  ! '{cmd}' no terminó a tiempo: se cancela (Ctrl+C) para no contaminar el siguiente comando")
            self.io.send(b"\x03")
            tail, _ = read_output(self.io, self.is_prompt, quiet_time=1.0, max_time=6, idle_abort=4)
            out += "\n" + tail + "\n[Comando cancelado por tiempo de espera]"
        return out
