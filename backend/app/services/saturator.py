"""
saturator.py
Generador de tráfico PROPIO para saturar un enlace, bidireccional y con el
ancho de banda en Mbps. Solo usa la librería estándar de Python, así que este
mismo archivo se puede copiar solo a otro equipo (cabecera del cliente, un VPS,
otra laptop) para correr el agente:

    python saturator.py server                       # agente en el extremo remoto
    python saturator.py client 10.1.1.1 --up 100 --down 100 --time 20

Dos modos de prueba
-------------------
1) "udp"  (con agente en el otro extremo)  -> MIDE de verdad, en los dos sentidos.
     - Subida:  este PC -> agente.  El agente cuenta lo que le llega y lo reporta
                cada segundo (así se ve cuánto pasó el enlace, no solo cuánto se envió).
     - Bajada:  agente -> este PC.  Este PC cuenta lo que recibe.
     - Pérdida real por sentido (por números de secuencia).
   Sirve para Internet (agente en un VPS/servidor tuyo) y para RPV/MPLS (agente en
   la cabecera o en otra laptop del otro lado).

2) "icmp" (SIN agente: cualquier IP que responda ping)
     - Se envían pings grandes a la velocidad pedida. Cada ping ocupa la subida
       (petición) y la bajada (respuesta) a la vez, así que es bidireccional y
       simétrico por naturaleza. Sirve contra la IP de cabecera, la DG o el
       siguiente salto. Límite: muchos equipos limitan el ICMP dirigido a ellos
       (CoPP); si lo que vuelve es mucho menos que lo enviado, puede ser el equipo
       y no el enlace.
     - Necesita permisos de administrador (socket raw) en Windows; en Linux/macOS
       intenta primero un socket ICMP sin privilegios.

Todos los Mbps se cuentan a nivel IP (tamaño del paquete IP completo), que es lo
que ve el router en `show interface` / `show policy-map interface`.
"""

import argparse
import hashlib
import hmac
import ipaddress
import json
import os
import random
import secrets
import socket
import struct
import sys
import threading
import time

MAGIC = b"NS"
HDR = struct.Struct("!2sBBIIQ")  # magic, tipo, flags, sesión, secuencia, reservado
HDR_LEN = HDR.size  # 20
IP_OVERHEAD = 28  # IP (20) + UDP (8) o ICMP (8)

T_HELLO, T_CHALLENGE, T_START, T_STARTED, T_UP, T_DOWN, T_REPORT, T_FIN, T_FIN_ACK = range(1, 10)

DEFAULT_PORT = 5301
MIN_SIZE, MAX_SIZE = 64, 9000
MAX_DURATION = 900
PUBLIC_ICMP_MAX_MBPS = 10.0  # contra IPs públicas el modo ICMP queda limitado (ver validate_config)
PUBLIC_ICMP_MAX_SECONDS = 30


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------
def clamp_size(size) -> int:
    return max(MIN_SIZE, min(MAX_SIZE, int(size)))


def pick_source_ip(target: str, source_ip: str = "") -> str:
    """IP local con la que se llegará al destino (o la que el usuario pidió)."""
    if source_ip:
        return source_ip
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((target, 9))
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


def _sock_buffers(sock, size=4 << 20):
    for opt in (socket.SO_RCVBUF, socket.SO_SNDBUF):
        try:
            sock.setsockopt(socket.SOL_SOCKET, opt, size)
        except OSError:
            pass


class TxMeter:
    """Cuenta lo enviado por segundo (bytes IP) y el total de paquetes."""

    def __init__(self, seconds: int):
        self.buckets = [0] * (seconds + 4)
        self.pkts = 0
        self.bytes = 0


def paced_send(send_pkt, pps: float, duration: float, stop: threading.Event,
               t0: float, meter: TxMeter, ip_bytes: int):
    """
    Envía paquetes a `pps` paquetes/s durante `duration` s (token bucket).
    send_pkt(seq) envía un paquete. Si el PC no alcanza el ritmo pedido, el atraso
    se descarta (no se acumula) y se nota en el caudal enviado.
    """
    if pps <= 0:
        return
    burst_max = max(64, int(pps * 0.05))
    start = time.perf_counter()
    due_total = 0  # paquetes que ya "tocaba" haber enviado
    seq = 0
    spin = pps > 20000
    while not stop.is_set():
        now = time.perf_counter()
        elapsed = now - start
        if elapsed >= duration:
            break
        want = int(elapsed * pps) - due_total
        if want < 1:
            time.sleep(0 if spin else 0.0005)
            continue
        if want > burst_max:
            due_total += want - burst_max  # descarta el atraso
            want = burst_max
        sent = 0
        try:
            for _ in range(want):
                send_pkt(seq)
                seq += 1
                sent += 1
        except (BlockingIOError, InterruptedError):
            pass
        except OSError:
            # buffer de envío lleno / red caída un instante: se reintenta en la siguiente vuelta
            time.sleep(0.001)
        due_total += want
        sec = int(now - t0)
        if 0 <= sec < len(meter.buckets):
            meter.buckets[sec] += sent * ip_bytes
        meter.pkts += sent
        meter.bytes += sent * ip_bytes


# ----------------------------------------------------------------------------
# AGENTE (lado remoto)
# ----------------------------------------------------------------------------
class _Session:
    def __init__(self, sid, addr, down_mbps, size, duration):
        self.sid, self.addr = sid, addr
        self.down_mbps, self.size, self.duration = down_mbps, size, duration
        self.t_start = time.perf_counter()
        self.deadline = self.t_start + duration + 6
        self.tot_pkts = self.tot_bytes = self.max_seq = 0
        self.rep_pkts = self.rep_bytes = 0
        self.last_rep = self.t_start
        self.sec = 0
        self.stop = threading.Event()
        self.down_meter = TxMeter(int(duration) + 2)
        self.closed_at = None


class Agent:
    """Agente UDP: recibe la subida, genera la bajada y reporta cada segundo."""

    MAX_SESSIONS = 64

    def __init__(self, port=DEFAULT_PORT, bind="0.0.0.0", key="", max_mbps=1000.0, log=print):
        self.port, self.bind, self.key = port, bind, key
        self.max_mbps = float(max_mbps)
        self.log = log
        self.secret = secrets.token_bytes(32)
        self.sessions = {}
        self.sock = None
        self._stop = threading.Event()
        self._threads = []

    # -- ciclo de vida -------------------------------------------------------
    def start(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        _sock_buffers(self.sock, 8 << 20)
        self.sock.bind((self.bind, self.port))
        self.sock.settimeout(0.3)
        self._stop.clear()
        for fn in (self._rx_loop, self._maint_loop):
            t = threading.Thread(target=fn, daemon=True)
            t.start()
            self._threads.append(t)
        self.log(f"Agente de saturación escuchando en UDP {self.bind}:{self.port}"
                 f"{' (con clave)' if self.key else ''}")

    def stop(self):
        self._stop.set()
        for s in list(self.sessions.values()):
            s.stop.set()
        for t in self._threads:
            t.join(timeout=1.5)
        self._threads.clear()
        if self.sock:
            self.sock.close()
            self.sock = None
        self.log("Agente detenido.")

    # -- helpers ----------------------------------------------------------------
    def _cookie(self, addr, sid) -> str:
        msg = f"{addr[0]}:{addr[1]}:{sid}".encode()
        return hmac.new(self.secret, msg, hashlib.sha256).hexdigest()[:16]

    def _send(self, addr, ptype, sid, body=b"", seq=0):
        try:
            self.sock.sendto(HDR.pack(MAGIC, ptype, 0, sid, seq, 0) + body, addr)
        except OSError:
            pass

    # -- recepción ----------------------------------------------------------------
    def _rx_loop(self):
        buf = bytearray(65535)
        view = memoryview(buf)
        while not self._stop.is_set():
            try:
                n, addr = self.sock.recvfrom_into(buf)
            except socket.timeout:
                continue
            except OSError:
                break
            if n < HDR_LEN or buf[:2] != MAGIC:
                continue
            ptype = buf[2]
            sid = int.from_bytes(buf[4:8], "big")
            if ptype == T_UP:
                s = self.sessions.get(sid)
                if s is not None and s.addr == addr:
                    s.tot_pkts += 1
                    s.tot_bytes += n + IP_OVERHEAD
                    seq = int.from_bytes(buf[8:12], "big")
                    if seq > s.max_seq:
                        s.max_seq = seq
            elif ptype == T_HELLO:
                self._send(addr, T_CHALLENGE, sid, self._cookie(addr, sid).encode())
            elif ptype == T_START:
                self._on_start(addr, sid, bytes(view[HDR_LEN:n]))
            elif ptype == T_FIN:
                self._on_fin(addr, sid)

    def _on_start(self, addr, sid, body):
        try:
            p = json.loads(body.decode())
            cookie = str(p.get("cookie", ""))
        except (ValueError, UnicodeDecodeError):
            return
        if not hmac.compare_digest(cookie, self._cookie(addr, sid)):
            return  # no es quien dice ser (anti-reflexión)
        if self.key:
            want = hmac.new(self.key.encode(), cookie.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(str(p.get("auth", "")), want):
                self.log(f"Clave incorrecta desde {addr[0]}")
                return
        if sid in self.sessions:  # START repetido (se perdió el STARTED)
            self._send(addr, T_STARTED, sid)
            return
        if len(self.sessions) >= self.MAX_SESSIONS:
            return
        duration = max(1.0, min(float(p.get("duration", 10)), MAX_DURATION))
        size = clamp_size(p.get("size", 1400))
        down = max(0.0, min(float(p.get("down_mbps", 0)), self.max_mbps))
        s = _Session(sid, addr, down, size, duration)
        self.sessions[sid] = s
        self._send(addr, T_STARTED, sid)
        self.log(f"Sesión {sid:08x} desde {addr[0]}: bajada {down:g} Mbps, {duration:g}s, paquete {size}B")
        if down > 0:
            threading.Thread(target=self._down_loop, args=(s,), daemon=True).start()

    def _on_fin(self, addr, sid):
        s = self.sessions.get(sid)
        if s is None or s.addr != addr:
            return
        s.stop.set()
        if s.closed_at is None:
            s.closed_at = time.perf_counter()
        self._send(addr, T_FIN_ACK, sid, json.dumps(self._totals(s)).encode())

    def _totals(self, s):
        return {"tot_pkts": s.tot_pkts, "tot_bytes": s.tot_bytes, "max_seq": s.max_seq,
                "dn_sent": s.down_meter.pkts}

    # -- bajada (agente -> cliente) ----------------------------------------------------
    def _down_loop(self, s: _Session):
        payload_len = s.size - IP_OVERHEAD
        buf = bytearray(payload_len)
        addr, sock = s.addr, self.sock

        def send_pkt(seq):
            HDR.pack_into(buf, 0, MAGIC, T_DOWN, 0, s.sid, seq & 0xFFFFFFFF, 0)
            sock.sendto(buf, addr)

        pps = s.down_mbps * 1e6 / 8 / s.size
        paced_send(send_pkt, pps, s.duration, s.stop, s.t_start, s.down_meter, s.size)

    # -- reportes cada segundo + limpieza ------------------------------------------------
    def _maint_loop(self):
        nxt = time.perf_counter() + 1.0
        while not self._stop.is_set():
            time.sleep(max(0.0, nxt - time.perf_counter()))
            nxt += 1.0
            now = time.perf_counter()
            for sid, s in list(self.sessions.items()):
                if s.closed_at is None and now < s.deadline:
                    dt = max(1e-3, now - s.last_rep)
                    rep = {"sec": s.sec, "dt": dt,
                           "rx_bytes": s.tot_bytes - s.rep_bytes, "rx_pkts": s.tot_pkts - s.rep_pkts,
                           "dn_sent": s.down_meter.pkts}
                    s.rep_bytes, s.rep_pkts, s.last_rep = s.tot_bytes, s.tot_pkts, now
                    s.sec += 1
                    self._send(s.addr, T_REPORT, sid, json.dumps(rep).encode())
                elif s.closed_at is None:
                    s.stop.set()
                    s.closed_at = now
                if s.closed_at is not None and now - s.closed_at > 6:
                    self.sessions.pop(sid, None)


# ----------------------------------------------------------------------------
# CLIENTE UDP (contra un agente)
# ----------------------------------------------------------------------------
class _Stream:
    def __init__(self, idx, nb):
        self.idx = idx
        self.sock = None
        self.sid = 0
        self.up_meter = TxMeter(nb)
        self.down_rx = [0] * (nb + 4)
        self.down_pkts = 0
        self.up_rx_series = [0.0] * (nb + 4)  # Mbps medidos por el agente
        self.fin = None
        self.fin_evt = threading.Event()
        self.last_report = None


def _handshake(stream, addr, params, key, stop):
    s, sid = stream.sock, stream.sid
    s.settimeout(0.6)
    cookie = None
    for _ in range(5):
        if stop.is_set():
            raise RuntimeError("Cancelado.")
        s.sendto(HDR.pack(MAGIC, T_HELLO, 0, sid, 0, 0), addr)
        try:
            while True:
                data, _a = s.recvfrom(2048)
                if len(data) >= HDR_LEN and data[:2] == MAGIC and data[2] == T_CHALLENGE:
                    cookie = data[HDR_LEN:].decode()
                    break
        except socket.timeout:
            continue
        break
    if cookie is None:
        raise RuntimeError(
            f"El agente en {addr[0]}:{addr[1]} (UDP) no responde. Revisa que esté corriendo "
            f"('python saturator.py server'), la IP/puerto y que el firewall/ACL permita UDP {addr[1]}.")
    body = dict(params, cookie=cookie)
    if key:
        body["auth"] = hmac.new(key.encode(), cookie.encode(), hashlib.sha256).hexdigest()
    start_pkt = HDR.pack(MAGIC, T_START, 0, sid, 0, 0) + json.dumps(body).encode()
    for _ in range(5):
        s.sendto(start_pkt, addr)
        try:
            while True:
                data, _a = s.recvfrom(2048)
                if len(data) >= HDR_LEN and data[:2] == MAGIC and data[2] == T_STARTED:
                    return
        except socket.timeout:
            continue
    raise RuntimeError("El agente respondió pero rechazó la sesión (¿clave incorrecta?).")


def _client_rx(stream, t0, stop_rx):
    buf = bytearray(65535)
    s = stream.sock
    s.settimeout(0.2)
    while not stop_rx.is_set():
        try:
            n = s.recv_into(buf)
        except socket.timeout:
            continue
        except OSError:
            break
        if n < HDR_LEN or buf[:2] != MAGIC:
            continue
        ptype = buf[2]
        if ptype == T_DOWN:
            sec = int(time.perf_counter() - t0)
            if 0 <= sec < len(stream.down_rx):
                stream.down_rx[sec] += n + IP_OVERHEAD
            stream.down_pkts += 1
        elif ptype == T_REPORT:
            try:
                rep = json.loads(bytes(buf[HDR_LEN:n]).decode())
                sec = int(rep["sec"])
                if 0 <= sec < len(stream.up_rx_series):
                    stream.up_rx_series[sec] = rep["rx_bytes"] * 8 / rep["dt"] / 1e6
                stream.last_report = rep
            except (ValueError, KeyError):
                pass
        elif ptype == T_FIN_ACK:
            try:
                stream.fin = json.loads(bytes(buf[HDR_LEN:n]).decode())
            except ValueError:
                stream.fin = {}
            stream.fin_evt.set()


# ----------------------------------------------------------------------------
# CLIENTE ICMP (sin agente)
# ----------------------------------------------------------------------------
def open_icmp_socket(source_ip: str):
    """Devuelve (socket, es_raw). Intenta raw y, si no hay permisos, el ICMP sin privilegios."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
        raw = True
    except PermissionError:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_ICMP)
            raw = False
        except (PermissionError, OSError):
            raise RuntimeError(
                "El modo ICMP necesita permisos de administrador. En Windows abre la terminal "
                "(o el programa) 'como administrador'; en Linux usa sudo o habilita "
                "net.ipv4.ping_group_range. Alternativa: modo UDP con agente.")
    except OSError as e:
        raise RuntimeError(f"No se pudo abrir el socket ICMP: {e}")
    if source_ip:
        try:
            s.bind((source_ip, 0))
        except OSError as e:
            s.close()
            raise RuntimeError(f"No se pudo usar {source_ip} como IP de origen: {e}")
    _sock_buffers(s)
    return s, raw


def _icmp_words_sum(b: bytes) -> int:
    if len(b) % 2:
        b += b"\0"
    return sum(struct.unpack(f"!{len(b)//2}H", b))


# ----------------------------------------------------------------------------
# Configuración, validación y ejecución
# ----------------------------------------------------------------------------
def validate_config(cfg: dict) -> dict:
    """Normaliza y limita la configuración. Devuelve (cfg, avisos)."""
    c = dict(cfg)
    notes = []
    c["mode"] = c.get("mode", "icmp")
    if c["mode"] not in ("udp", "icmp"):
        raise ValueError("Modo inválido (usa 'udp' o 'icmp').")
    target = str(c.get("target", "")).strip()
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(target)) if target else None
    except OSError:
        ip = None
    if ip is None or ip.version != 4:
        raise ValueError("Destino inválido: escribe una IPv4 (ej. 10.20.30.1).")
    c["target"] = str(ip)
    if ip.is_multicast or ip.is_unspecified or str(ip).endswith(".255"):
        raise ValueError("El destino no puede ser multicast, 0.0.0.0 ni una dirección de broadcast.")
    c["port"] = int(c.get("port") or DEFAULT_PORT)
    c["up_mbps"] = max(0.0, float(c.get("up_mbps") or 0))
    c["down_mbps"] = max(0.0, float(c.get("down_mbps") or 0))
    if c["up_mbps"] <= 0 and c["down_mbps"] <= 0:
        raise ValueError("Indica los Mbps de subida y/o bajada.")
    c["duration"] = max(3, min(int(c.get("duration") or 20), MAX_DURATION))
    c["size"] = clamp_size(c.get("size") or 1400)
    c["streams"] = max(1, min(int(c.get("streams") or 1), 8))
    c["source_ip"] = str(c.get("source_ip") or "").strip()
    c["key"] = str(c.get("key") or "")

    if c["mode"] == "icmp":
        rate = c["up_mbps"] if c["up_mbps"] > 0 else c["down_mbps"]
        if c["up_mbps"] > 0 and c["down_mbps"] > 0 and abs(c["up_mbps"] - c["down_mbps"]) > 0.01:
            notes.append("En modo ICMP la subida y la bajada son iguales (cada ping va y vuelve): "
                         f"se usará {rate:g} Mbps en ambos sentidos.")
        c["up_mbps"] = c["down_mbps"] = rate
        if ip.is_global:
            if rate > PUBLIC_ICMP_MAX_MBPS or c["duration"] > PUBLIC_ICMP_MAX_SECONDS:
                notes.append(f"Destino público: el modo ICMP se limita a {PUBLIC_ICMP_MAX_MBPS:g} Mbps y "
                             f"{PUBLIC_ICMP_MAX_SECONDS}s (inundar con pings un servidor ajeno no mide tu enlace y "
                             "puede bloquear tu IP). Para saturar hacia Internet usa el modo UDP con tu propio agente.")
            c["up_mbps"] = c["down_mbps"] = min(rate, PUBLIC_ICMP_MAX_MBPS)
            c["duration"] = min(c["duration"], PUBLIC_ICMP_MAX_SECONDS)
        c["streams"] = 1
    return c, notes


def _stats(series, skip_first=True):
    """(promedio, mínimo, máximo) de una serie de Mbps ignorando el primer segundo de arranque."""
    vals = series[1:] if skip_first and len(series) > 3 else series
    if not vals:
        return 0.0, 0.0, 0.0
    return sum(vals) / len(vals), min(vals), max(vals)


def _round(x, n=2):
    return round(float(x), n)


def run_test(cfg: dict, progress_cb=None, stop: threading.Event = None, mid_callback=None):
    """
    Ejecuta la prueba y devuelve un dict con el resumen y las series por segundo.

    mid_callback: función sin argumentos que se invoca UNA vez, cuando el tráfico ya
    está a régimen (ej. para capturar `show policy-map interface` en el router).
    """
    log = progress_cb or (lambda m: None)
    stop = stop or threading.Event()
    cfg, notes = validate_config(cfg)
    for n in notes:
        log("⚠ " + n)
    target, mode = cfg["target"], cfg["mode"]
    src = pick_source_ip(target, cfg["source_ip"])
    log(f"Modo {'UDP con agente' if mode == 'udp' else 'eco ICMP'} → {target}"
        f" | origen {src or 'automático'} | paquete {cfg['size']}B | {cfg['duration']}s")
    if mode == "udp":
        result = _run_udp(cfg, src, log, stop, mid_callback)
    else:
        result = _run_icmp(cfg, src, log, stop, mid_callback)
    result["notes"] = notes + result.get("notes", [])
    result.update(mode=mode, target=target, source_ip=src, size=cfg["size"],
                  streams=cfg["streams"], duration=cfg["duration"],
                  target_kind=cfg.get("target_kind", ""), cancelled=stop.is_set())
    return result


def _mid_thread(cfg, mid_callback, t0, stop, log):
    """Lanza mid_callback a mitad (o a `capture_after`) de la prueba, sin frenar el tráfico."""
    if not mid_callback:
        return None
    after = cfg.get("capture_after")
    after = float(after) if after not in (None, "") else cfg["duration"] / 2
    after = max(2.0, min(after, cfg["duration"] - 3))

    def run():
        while time.perf_counter() - t0 < after:
            if stop.wait(0.2):
                return
        log(f">> Tráfico a régimen ({after:g}s): capturando en el equipo...")
        try:
            mid_callback()
        except Exception as e:  # la captura no debe tumbar la prueba
            log(f"✖ Falló la captura en el equipo: {e}")

    th = threading.Thread(target=run, daemon=True)
    th.start()
    return th


def _run_udp(cfg, src, log, stop, mid_callback):
    dur, size, n = cfg["duration"], cfg["size"], cfg["streams"]
    up_total, down_total = cfg["up_mbps"], cfg["down_mbps"]
    nb = dur + 2
    addr = (cfg["target"], cfg["port"])
    streams = []
    try:
        for i in range(n):
            st = _Stream(i, nb)
            st.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            _sock_buffers(st.sock)
            st.sock.bind((src, 0))
            st.sid = random.getrandbits(32) or 1
            streams.append(st)
            _handshake(st, addr, {"down_mbps": down_total / n, "size": size, "duration": dur}, cfg["key"], stop)
        log(f"Agente OK ({n} flujo{'s' if n > 1 else ''}). Generando tráfico...")

        stop_rx, stop_tx = threading.Event(), threading.Event()
        t0 = time.perf_counter()
        rx_threads, tx_threads = [], []
        for st in streams:
            rx_threads.append(threading.Thread(target=_client_rx, args=(st, t0, stop_rx), daemon=True))
            if up_total > 0:
                buf = bytearray(size - IP_OVERHEAD)

                def make_send(st=st, buf=buf):
                    def send_pkt(seq):
                        HDR.pack_into(buf, 0, MAGIC, T_UP, 0, st.sid, seq & 0xFFFFFFFF, 0)
                        st.sock.sendto(buf, addr)
                    return send_pkt

                pps = (up_total / n) * 1e6 / 8 / size
                tx_threads.append(threading.Thread(
                    target=paced_send, args=(make_send(), pps, dur, stop_tx, t0, st.up_meter, size), daemon=True))
        for t in rx_threads + tx_threads:
            t.start()
        mid = _mid_thread(cfg, mid_callback, t0, stop, log)

        # progreso en vivo
        for sec in range(dur):
            deadline = t0 + sec + 1
            while time.perf_counter() < deadline:
                if stop.wait(0.1):
                    break
            if stop.is_set():
                log("Prueba cancelada.")
                break
            if sec >= 1:
                k = sec - 1
                up_tx = sum(s.up_meter.buckets[k] for s in streams) * 8 / 1e6
                dn_rx = sum(s.down_rx[k] for s in streams) * 8 / 1e6
                up_rx = sum(s.up_rx_series[k] for s in streams)
                log(f"[{k + 1:>3}s] ↑ enviado {up_tx:8.1f} Mbps (llegó al agente {up_rx:8.1f})"
                    f"  ↓ recibido {dn_rx:8.1f} Mbps")
        stop_tx.set()
        for t in tx_threads:
            t.join(timeout=2)
        time.sleep(0.6)  # deja llegar lo que viene en camino

        for st in streams:  # cierre y totales del agente
            pkt = HDR.pack(MAGIC, T_FIN, 0, st.sid, 0, 0)
            for _ in range(5):
                st.sock.sendto(pkt, addr)
                if st.fin_evt.wait(0.4):
                    break
        stop_rx.set()
        for t in rx_threads:
            t.join(timeout=1)
        if mid:
            mid.join(timeout=60)

        return _summarize_udp(cfg, streams, dur)
    finally:
        for st in streams:
            try:
                st.sock.close()
            except Exception:
                pass


def _summarize_udp(cfg, streams, dur):
    up_tx = [sum(s.up_meter.buckets[i] for s in streams) * 8 / 1e6 for i in range(dur)]
    up_rx = [sum(s.up_rx_series[i] for s in streams) for i in range(dur)]
    dn_rx = [sum(s.down_rx[i] for s in streams) * 8 / 1e6 for i in range(dur)]
    sent_up = sum(s.up_meter.pkts for s in streams)
    got_up = sum((s.fin or {}).get("tot_pkts", 0) for s in streams)
    sent_dn = sum((s.fin or {}).get("dn_sent", 0) for s in streams)
    got_dn = sum(s.down_pkts for s in streams)
    fin_ok = all(s.fin is not None for s in streams)

    loss_up = max(0.0, (1 - got_up / sent_up) * 100) if sent_up and fin_ok else None
    loss_dn = max(0.0, (1 - got_dn / sent_dn) * 100) if sent_dn and fin_ok else None

    notes = []
    res = {"series": {"t": list(range(1, dur + 1)), "up_tx": up_tx, "up_rx": up_rx, "down_rx": dn_rx}}
    for key, tgt, tx, rx, loss in (
        ("up", cfg["up_mbps"], up_tx, up_rx, loss_up),
        ("down", cfg["down_mbps"], None, dn_rx, loss_dn),
    ):
        if tgt <= 0:
            res[key] = None
            continue
        avg, mn, mx = _stats(rx)
        d = {"target_mbps": _round(tgt), "rx_avg": _round(avg), "rx_min": _round(mn), "rx_max": _round(mx),
             "pct_target": _round(avg / tgt * 100, 1), "loss_pct": None if loss is None else _round(loss, 2)}
        if tx is not None:
            d["tx_avg"] = _round(_stats(tx)[0])
        res[key] = d
    up = res.get("up")
    if up and up["tx_avg"] < 0.9 * up["target_mbps"]:
        notes.append(f"Este PC solo logró generar {up['tx_avg']:g} Mbps de subida (pedido {up['target_mbps']:g}): "
                     "el límite es el PC/tarjeta de red, no el enlace. Sube los 'flujos' o baja los Mbps.")
    elif up and up["loss_pct"] is not None and up["loss_pct"] > 2:
        notes.append(f"Subida: el enlace entregó ~{up['rx_avg']:g} Mbps de {up['target_mbps']:g} enviados "
                     f"({up['loss_pct']:g}% de pérdida) → el enlace/policer limita la subida a ese valor.")
    dn = res.get("down")
    if dn and dn["loss_pct"] is not None and dn["loss_pct"] > 2:
        notes.append(f"Bajada: llegaron ~{dn['rx_avg']:g} Mbps de {dn['target_mbps']:g} ({dn['loss_pct']:g}% de pérdida) "
                     "→ el enlace/policer limita la bajada a ese valor (o el PC no alcanza a recibir).")
    if not fin_ok:
        notes.append("No llegó el cierre del agente: las pérdidas no se pudieron calcular con exactitud.")
    res["notes"] = notes
    return res


def _run_icmp(cfg, src, log, stop, mid_callback):
    dur, size = cfg["duration"], cfg["size"]
    rate = cfg["up_mbps"]
    sock, raw = open_icmp_socket(src)
    target_packed = socket.inet_aton(cfg["target"])
    ident = random.getrandbits(16)
    plen = size - IP_OVERHEAD
    if plen < 8:
        plen = 8
    buf = bytearray(8 + plen)  # cabecera ICMP (8) + [timestamp 8 + relleno]
    plen_total = len(buf)
    base_sum = 0x0800 + ident  # tipo=8,código=0 | id  (checksum y seq se suman por paquete)
    base_sum += _icmp_words_sum(bytes(plen_total - 8)) if plen_total > 8 else 0
    nb = dur + 2
    meter = TxMeter(nb)
    rx_bytes = [0] * (nb + 4)
    rtts = []
    state = {"rx": 0, "err": 0}
    stop_rx, stop_tx = threading.Event(), threading.Event()
    addr = (cfg["target"], 0)

    def send_pkt(seq):
        s16 = seq & 0xFFFF
        ts = time.perf_counter()
        w = struct.unpack("!4H", struct.pack("!d", ts))
        tot = base_sum + s16 + w[0] + w[1] + w[2] + w[3]
        tot = (tot & 0xFFFF) + (tot >> 16)
        tot = (tot & 0xFFFF) + (tot >> 16)
        struct.pack_into("!BBHHHd", buf, 0, 8, 0, (~tot) & 0xFFFF, ident, s16, ts)
        sock.sendto(buf, addr)

    def rx_loop(t0):
        sock.settimeout(0.2)
        while not stop_rx.is_set():
            try:
                data = sock.recv(65535)
            except socket.timeout:
                continue
            except OSError:
                break
            off = 0
            has_ip = len(data) > 20 and (data[0] >> 4) == 4 and data[9] == 1
            if has_ip:
                off = (data[0] & 0x0F) * 4
                if data[12:16] != target_packed:
                    continue
            icmp = data[off:]
            if len(icmp) < 8:
                continue
            itype = icmp[0]
            if itype == 0:
                rid = struct.unpack_from("!H", icmp, 4)[0]
                if raw and rid != ident:
                    continue
                now = time.perf_counter()
                if len(icmp) >= 16:
                    try:
                        sent_ts = struct.unpack_from("!d", icmp, 8)[0]
                        rtt = (now - sent_ts) * 1000
                        if 0 <= rtt < 60000 and (len(rtts) < 50000):
                            rtts.append(rtt)
                    except struct.error:
                        pass
                sec = int(now - t0)
                if 0 <= sec < len(rx_bytes):
                    rx_bytes[sec] += len(icmp) + (20)  # bytes IP de la respuesta
                state["rx"] += 1
            elif itype in (3, 11, 12):
                state["err"] += 1

    try:
        t0 = time.perf_counter()
        rx_t = threading.Thread(target=rx_loop, args=(t0,), daemon=True)
        pps = rate * 1e6 / 8 / size
        tx_t = threading.Thread(target=paced_send, args=(send_pkt, pps, dur, stop_tx, t0, meter, size), daemon=True)
        rx_t.start()
        tx_t.start()
        mid = _mid_thread(cfg, mid_callback, t0, stop, log)
        for sec in range(dur):
            deadline = t0 + sec + 1
            while time.perf_counter() < deadline:
                if stop.wait(0.1):
                    break
            if stop.is_set():
                log("Prueba cancelada.")
                break
            if sec >= 1:
                k = sec - 1
                tx = meter.buckets[k] * 8 / 1e6
                rx = rx_bytes[k] * 8 / 1e6
                log(f"[{k + 1:>3}s] ↑ enviado {tx:8.1f} Mbps  ↓ eco recibido {rx:8.1f} Mbps")
        stop_tx.set()
        tx_t.join(timeout=2)
        time.sleep(1.0)
        stop_rx.set()
        rx_t.join(timeout=1)
        if mid:
            mid.join(timeout=60)
    finally:
        sock.close()

    tx_series = [meter.buckets[i] * 8 / 1e6 for i in range(dur)]
    rx_series = [rx_bytes[i] * 8 / 1e6 for i in range(dur)]
    tx_avg = _stats(tx_series)[0]
    rx_avg, rx_min, rx_max = _stats(rx_series)
    loss = max(0.0, (1 - state["rx"] / meter.pkts) * 100) if meter.pkts else 0.0
    notes = []
    if rate > 0 and tx_avg < 0.9 * rate:
        notes.append(f"Este PC solo logró enviar {tx_avg:.1f} Mbps (pedido {rate:g}): límite del PC, no del enlace.")
    if tx_avg > 0 and rx_avg < 0.5 * tx_avg:
        notes.append("Volvió menos de la mitad de lo enviado. Si el destino es un router (DG / siguiente salto) "
                     "puede ser su límite de ICMP (CoPP) y no el enlace; confirma con una IP de cabecera detrás del "
                     "enlace o con el modo UDP + agente.")
    if state["err"]:
        notes.append(f"Se recibieron {state['err']} mensajes ICMP de error (inalcanzable/TTL): revisa la ruta.")
    rtt = {}
    if rtts:
        jitter = sum(abs(a - b) for a, b in zip(rtts, rtts[1:])) / max(1, len(rtts) - 1)
        rtt = {"avg": _round(sum(rtts) / len(rtts)), "min": _round(min(rtts)), "max": _round(max(rtts)),
               "jitter": _round(jitter)}
    res = {
        "series": {"t": list(range(1, dur + 1)), "up_tx": tx_series, "up_rx": rx_series, "down_rx": rx_series},
        "up": {"target_mbps": _round(rate), "tx_avg": _round(tx_avg), "rx_avg": _round(rx_avg),
               "rx_min": _round(rx_min), "rx_max": _round(rx_max),
               "pct_target": _round(rx_avg / rate * 100, 1) if rate else 0, "loss_pct": _round(loss, 2)},
        "down": {"target_mbps": _round(rate), "rx_avg": _round(rx_avg), "rx_min": _round(rx_min),
                 "rx_max": _round(rx_max), "pct_target": _round(rx_avg / rate * 100, 1) if rate else 0,
                 "loss_pct": _round(loss, 2)},
        "rtt": rtt,
        "icmp_note": "Pérdida y Mbps recibidos = ida+vuelta (cada eco usa la subida y la bajada).",
        "notes": notes,
    }
    return res


# ----------------------------------------------------------------------------
# Línea de comandos
# ----------------------------------------------------------------------------
def _cli():
    ap = argparse.ArgumentParser(description="Saturador de enlaces NetOps (agente y cliente)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sv = sub.add_parser("server", help="Corre el agente (extremo remoto)")
    sv.add_argument("--port", type=int, default=DEFAULT_PORT)
    sv.add_argument("--bind", default="0.0.0.0")
    sv.add_argument("--key", default="", help="Clave compartida opcional")
    sv.add_argument("--max-mbps", type=float, default=1000.0, help="Tope de bajada por sesión")
    cl = sub.add_parser("client", help="Corre una prueba")
    cl.add_argument("target")
    cl.add_argument("--mode", choices=["udp", "icmp"], default="udp")
    cl.add_argument("--port", type=int, default=DEFAULT_PORT)
    cl.add_argument("--up", type=float, default=0, help="Mbps de subida")
    cl.add_argument("--down", type=float, default=0, help="Mbps de bajada")
    cl.add_argument("--time", type=int, default=20)
    cl.add_argument("--size", type=int, default=1400, help="Tamaño del paquete IP")
    cl.add_argument("--streams", type=int, default=1)
    cl.add_argument("--source", default="")
    cl.add_argument("--key", default="")
    a = ap.parse_args()

    if a.cmd == "server":
        ag = Agent(a.port, a.bind, a.key, a.max_mbps)
        ag.start()
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            ag.stop()
        return
    stop = threading.Event()
    try:
        res = run_test({"mode": a.mode, "target": a.target, "port": a.port, "up_mbps": a.up, "down_mbps": a.down,
                        "duration": a.time, "size": a.size, "streams": a.streams, "source_ip": a.source,
                        "key": a.key}, progress_cb=print, stop=stop)
    except KeyboardInterrupt:
        stop.set()
        return
    except (RuntimeError, ValueError) as e:
        print("ERROR:", e)
        sys.exit(1)
    print(json.dumps({k: v for k, v in res.items() if k != "series"}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    _cli()
