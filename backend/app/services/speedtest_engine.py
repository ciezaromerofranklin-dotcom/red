"""
speedtest_engine.py
Speedtest propio, sin navegador: mide latencia, bajada y subida contra los
endpoints públicos de Cloudflare (/__down y /__up) con varias conexiones en
paralelo, y genera una imagen de evidencia. Corre en el PC donde está el backend,
así que mide la línea de ESE PC (la del cliente si estás en sitio).
"""

import http.client
import os
import ssl
import threading
import time
from datetime import datetime
from urllib.parse import urlparse

from PIL import Image, ImageDraw

from app.services.saturator_chart import _font, BG, FG, GRID, MUTED, C_UP, C_DOWN

DEFAULT_BASE = "https://speed.cloudflare.com"
CHUNK = 64 * 1024


def _connect(base: str, timeout=10):
    u = urlparse(base)
    if u.scheme == "https":
        return http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=timeout,
                                           context=ssl.create_default_context())
    return http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)


def _latency(base, samples=10):
    rtts = []
    conn = _connect(base)
    try:
        for i in range(samples + 1):
            t = time.perf_counter()
            conn.request("GET", "/__down?bytes=0")
            conn.getresponse().read()
            if i:  # la primera incluye TLS/DNS
                rtts.append((time.perf_counter() - t) * 1000)
    finally:
        conn.close()
    jitter = sum(abs(a - b) for a, b in zip(rtts, rtts[1:])) / max(1, len(rtts) - 1)
    return sum(rtts) / len(rtts), min(rtts), jitter


def _phase(worker, seconds, streams, stop, log, label):
    """Corre `worker` en N hilos y mide Mbps por segundo (ignora el primer segundo)."""
    counters = [0] * streams
    errors = []
    end = time.perf_counter() + seconds
    threads = [threading.Thread(target=worker, args=(i, counters, end, stop, errors), daemon=True) for i in range(streams)]
    for t in threads:
        t.start()
    t0, last, series = time.perf_counter(), 0, []
    while time.perf_counter() < end and not stop.is_set():
        time.sleep(1.0)
        total = sum(counters)
        mbps = (total - last) * 8 / 1e6
        last = total
        series.append(mbps)
        log(f"  {label}: {mbps:8.1f} Mbps")
    for t in threads:
        t.join(timeout=3)
    if not series and errors:
        raise RuntimeError(f"Falló la prueba de {label.lower()}: {errors[0]}")
    steady = series[1:] if len(series) > 2 else series
    return (sum(steady) / len(steady) if steady else 0.0), series


def run_native_speedtest(progress_cb=None, stop=None, base=DEFAULT_BASE, seconds=10, streams=4):
    log = progress_cb or (lambda m: None)
    stop = stop or threading.Event()
    seconds = max(4, min(int(seconds), 30))
    streams = max(1, min(int(streams), 8))
    try:
        log(f"Midiendo latencia contra {urlparse(base).hostname} ...")
        lat, lat_min, jitter = _latency(base)
        log(f"  Latencia {lat:.0f} ms (mín {lat_min:.0f}) | jitter {jitter:.1f} ms")
    except (OSError, http.client.HTTPException) as e:
        raise RuntimeError(f"No hay salida a Internet desde este PC hacia {urlparse(base).hostname}: {e}")

    def down_worker(i, counters, end, stop, errors):
        try:
            conn = _connect(base)
            while time.perf_counter() < end and not stop.is_set():
                conn.request("GET", "/__down?bytes=50000000")
                resp = conn.getresponse()
                while time.perf_counter() < end and not stop.is_set():
                    chunk = resp.read(CHUNK)
                    if not chunk:
                        break
                    counters[i] += len(chunk)
                if time.perf_counter() < end:
                    continue
                conn.close()  # corta la descarga restante
                break
        except (OSError, http.client.HTTPException) as e:
            errors.append(e)

    payload = os.urandom(CHUNK)

    def up_worker(i, counters, end, stop, errors):
        try:
            conn = _connect(base, timeout=15)
            size = 8 * 1024 * 1024
            while time.perf_counter() < end and not stop.is_set():
                conn.putrequest("POST", "/__up")
                conn.putheader("Content-Length", str(size))
                conn.putheader("Content-Type", "application/octet-stream")
                conn.endheaders()
                sent = 0
                while sent < size:
                    if time.perf_counter() >= end or stop.is_set():
                        conn.close()
                        return
                    conn.send(payload)
                    sent += CHUNK
                    counters[i] += CHUNK
                conn.getresponse().read()
        except (OSError, http.client.HTTPException) as e:
            errors.append(e)

    log("Midiendo bajada ...")
    down, down_series = _phase(down_worker, seconds, streams, stop, log, "Bajada")
    log("Midiendo subida ...")
    up, up_series = _phase(up_worker, seconds, streams, stop, log, "Subida")
    log(f"Resultado: ↓ {down:.1f} Mbps | ↑ {up:.1f} Mbps | latencia {lat:.0f} ms")
    return {"down_mbps": round(down, 2), "up_mbps": round(up, 2), "latency_ms": round(lat, 1),
            "jitter_ms": round(jitter, 1), "server": urlparse(base).hostname,
            "streams": streams, "seconds": seconds, "down_series": down_series, "up_series": up_series}


def render_speed_png(res: dict, out_path: str, titulo="Speedtest"):
    W, H = 1280, 520
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((40, 24), titulo, fill=FG, font=_font(30, True))
    d.text((40, 66), f"Servidor {res['server']}  |  {res['streams']} conexiones  |  {res['seconds']}s por sentido  |  "
                     f"{datetime.now().strftime('%d/%m/%Y %H:%M')}", fill=MUTED, font=_font(18))
    boxes = [("BAJADA", f"{res['down_mbps']:g}", "Mbps", C_DOWN, res["down_series"]),
             ("SUBIDA", f"{res['up_mbps']:g}", "Mbps", C_UP, res["up_series"])]
    bw = (W - 100) // 2
    for k, (name, val, unit, color, series) in enumerate(boxes):
        x = 40 + k * (bw + 20)
        d.rounded_rectangle([x, 110, x + bw, 400], radius=14, outline=GRID, width=2)
        d.text((x + 24, 124), name, fill=MUTED, font=_font(22, True))
        d.text((x + 24, 154), val, fill=color, font=_font(84, True))
        d.text((x + 24 + d.textlength(val, font=_font(84, True)) + 12, 208), unit, fill=MUTED, font=_font(28))
        if len(series) > 1:  # mini gráfica
            gx0, gy0, gx1, gy1 = x + 24, 270, x + bw - 24, 380
            top = max(series) * 1.15 or 1
            pts = [(gx0 + (gx1 - gx0) * i / (len(series) - 1), gy1 - (gy1 - gy0) * v / top) for i, v in enumerate(series)]
            d.line(pts, fill=color, width=3)
            d.line([(gx0, gy1), (gx1, gy1)], fill=GRID, width=1)
    d.text((40, 430), f"Latencia: {res['latency_ms']:g} ms    Jitter: {res['jitter_ms']:g} ms", fill=FG, font=_font(26, True))
    img.save(out_path, "PNG")
    return out_path
