"""
tools.py
Herramientas de automatizacion:
  - Speedtest: (a) navegador Chrome headless con captura de pantalla real
    (fast.com u otra web) o (b) motor propio sin navegador que mide latencia,
    bajada y subida y genera la imagen de evidencia.
  - Saturacion propia bidireccional (UDP con agente o eco ICMP), en Mbps, hacia
    Internet o RPV (IP de cabecera, DG o siguiente salto), con captura opcional en
    el router mientras el trafico esta a regimen.
  - Ostinato + captura de saturacion (comando externo propio del usuario).

IMPORTANTE: todo esto genera trafico desde el PC donde corre el BACKEND. Para
probar el enlace de un cliente, el backend debe correr en TU laptop (conectada
al cliente), no en un servidor en la nube.
"""

import asyncio
import subprocess
import threading
import time
import uuid
from typing import Optional, List

from fastapi import APIRouter, HTTPException, WebSocket
from pydantic import BaseModel

from app.config import UPLOADS_DIR
from app.services import netinfo
from app.services.device_link import run_tests
from app.services.saturator import Agent, DEFAULT_PORT, run_test
from app.services.saturator_chart import render_saturation_png
from app.services.speedtest_engine import DEFAULT_BASE, render_speed_png, run_native_speedtest
from app.ws_utils import run_streaming

router = APIRouter(prefix="/api/tools", tags=["tools"])


async def _watch_stop(websocket: WebSocket, stop: threading.Event):
    """Escucha al navegador: un mensaje 'stop' (o cerrar la pagina) detiene la prueba en curso."""
    try:
        while True:
            msg = await websocket.receive_text()
            if "stop" in msg.lower():
                stop.set()
    except Exception:
        stop.set()


async def _run_cancellable(websocket: WebSocket, blocking_fn, stop: threading.Event):
    watcher = asyncio.create_task(_watch_stop(websocket, stop))
    try:
        await run_streaming(websocket, blocking_fn)
    except Exception:
        stop.set()  # el navegador se desconecto: no dejar trafico corriendo
    finally:
        watcher.cancel()
    try:
        await websocket.close()
    except Exception:
        pass


@router.get("/net-info")
def get_net_info():
    """IPs de las tarjetas, puerta de enlace (DG) y si hay permisos de administrador."""
    return netinfo.net_info()


class SpeedtestRequest(BaseModel):
    engine: str = "fast"            # "fast" = navegador con captura real | "nativo" = motor propio
    url: str = "https://fast.com"
    wait_seconds: int = 60          # tope de espera (la captura se toma apenas termina el test)
    seconds: int = 10               # nativo: segundos por sentido
    streams: int = 4                # nativo: conexiones en paralelo
    titulo: str = "Speedtest"


def _wait_selector(page, selector, total_s, progress_cb, label):
    """Espera un selector con avisos cada 5 s. Devuelve True si aparecio."""
    from playwright.sync_api import TimeoutError as PWTimeout
    waited = 0
    while waited < total_s:
        step = min(5, total_s - waited)
        try:
            page.wait_for_selector(selector, timeout=step * 1000)
            return True
        except PWTimeout:
            waited += step
            progress_cb(f"  ... {label} ({waited}s)")
    return False


def _browser_speedtest(payload: SpeedtestRequest, progress_cb):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError("Playwright no esta instalado. Ejecuta: pip install playwright && python -m playwright install chromium"
                           " (o usa el motor 'nativo', que no necesita navegador).")
    out_name = f"speedtest_{uuid.uuid4().hex[:10]}.png"
    out_path = str(UPLOADS_DIR / out_name)
    is_fast = "fast.com" in payload.url

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        except Exception as e:
            raise RuntimeError(
                "No se pudo abrir Chromium. Instala el navegador con: python -m playwright install chromium "
                "(en Linux/Docker: python -m playwright install --with-deps chromium). "
                "O usa el motor 'nativo'. Detalle: " + str(e).splitlines()[0])
        try:
            page = browser.new_context(viewport={"width": 1280, "height": 900}, locale="es-PE").new_page()
            progress_cb(f"Abriendo {payload.url} ...")
            try:
                page.goto(payload.url, timeout=30000, wait_until="domcontentloaded")
            except Exception as e:
                raise RuntimeError(f"No se pudo cargar {payload.url} (este PC necesita salida a Internet): {str(e).splitlines()[0]}")
            if is_fast:
                progress_cb("Esperando que termine la bajada...")
                if _wait_selector(page, "#speed-value.succeeded", payload.wait_seconds, progress_cb, "midiendo bajada"):
                    progress_cb("Bajada lista. Abriendo detalle (subida y latencia)...")
                    try:
                        page.click("#show-more-details-link", timeout=3000)
                        _wait_selector(page, "#upload-value.succeeded", min(40, payload.wait_seconds), progress_cb, "midiendo subida")
                    except Exception:
                        progress_cb("  (no se pudo abrir el detalle; se captura lo visible)")
                else:
                    progress_cb("El test no marco 'terminado' a tiempo; se captura lo que hay en pantalla.")
                time.sleep(1.5)
            else:
                remaining = payload.wait_seconds
                progress_cb(f"Pagina cargada. Esperando {remaining}s a que el test termine...")
                while remaining > 0:
                    step = min(5, remaining)
                    time.sleep(step)
                    remaining -= step
                    progress_cb(f"  ... {remaining}s restantes")
            page.screenshot(path=out_path)
        finally:
            browser.close()
    progress_cb("Captura de resultado guardada.")
    return {"path": out_name, "url": f"/api/files/uploads/{out_name}", "engine": "fast"}


@router.websocket("/speedtest")
async def speedtest_ws(websocket: WebSocket):
    """
    Speedtest en el PC donde corre el backend.
      engine="fast":   Chrome headless; la captura se toma cuando el test TERMINA (no a tiempo fijo).
      engine="nativo": motor propio sin navegador (latencia + bajada + subida) con imagen de evidencia.
    """
    await websocket.accept()
    params = await websocket.receive_json()
    payload = SpeedtestRequest(**params)
    stop = threading.Event()

    def blocking(progress_cb):
        if payload.engine == "nativo":
            res = run_native_speedtest(progress_cb, stop, DEFAULT_BASE, payload.seconds, payload.streams)
            out_name = f"speedtest_{uuid.uuid4().hex[:10]}.png"
            render_speed_png(res, str(UPLOADS_DIR / out_name), payload.titulo)
            progress_cb("Imagen de evidencia generada.")
            res.pop("down_series", None)
            res.pop("up_series", None)
            return {"path": out_name, "url": f"/api/files/uploads/{out_name}", "engine": "nativo", "summary": res}
        return _browser_speedtest(payload, progress_cb)

    await _run_cancellable(websocket, blocking, stop)


# ---------------------------------------------------------------------------
# Saturacion propia
# ---------------------------------------------------------------------------
class CaptureSpec(BaseModel):
    connection: dict
    wan_cmd: str
    sup_cmd: Optional[str] = None
    after_s: Optional[float] = None
    disable_paging_cmds: List[str] = ["terminal length 0", "terminal width 0"]


class SaturationRequest(BaseModel):
    mode: str = "icmp"            # "icmp" (sin agente) | "udp" (con agente en el otro extremo)
    target: str
    target_kind: str = ""         # cabecera | dg | siguiente_salto | manual (solo para el reporte)
    port: int = DEFAULT_PORT
    up_mbps: float = 0
    down_mbps: float = 0
    duration: int = 20
    size: int = 1400
    streams: int = 1
    source_ip: str = ""
    key: str = ""
    titulo: str = "Prueba de saturacion"
    capture: Optional[CaptureSpec] = None


@router.websocket("/saturacion")
async def saturacion_ws(websocket: WebSocket):
    """
    Genera trafico bidireccional a los Mbps indicados, muestra el caudal real por segundo y,
    si se pidio, captura WAN/SUP en el router cuando el trafico ya esta a regimen.
    Enviar el texto "stop" por el WebSocket (o cerrar la pagina) detiene el trafico.
    """
    await websocket.accept()
    params = await websocket.receive_json()
    payload = SaturationRequest(**params)
    stop = threading.Event()

    def blocking(progress_cb):
        cap_out = {}
        mid = None
        if payload.capture and payload.capture.wan_cmd.strip():
            cap = payload.capture

            def mid():
                tests = [("wan", "Saturacion WAN", cap.wan_cmd.strip())]
                if cap.sup_cmd and cap.sup_cmd.strip():
                    tests.append(("sup", "Saturacion SUP", cap.sup_cmd.strip()))
                _, results = run_tests(cap.connection, cap.disable_paging_cmds, None, tests, None,
                                       progress_cb=progress_cb)
                for k, _l, _c, o in results:
                    cap_out[k] = o

        cfg = payload.model_dump(exclude={"capture", "titulo"})
        if payload.capture:
            cfg["capture_after"] = payload.capture.after_s
        result = run_test(cfg, progress_cb, stop, mid_callback=mid)

        out_name = f"saturacion_{uuid.uuid4().hex[:10]}.png"
        render_saturation_png(result, str(UPLOADS_DIR / out_name), payload.titulo)
        result["image"] = {"path": out_name, "url": f"/api/files/uploads/{out_name}"}
        result["wan_output"] = cap_out.get("wan")
        result["sup_output"] = cap_out.get("sup")
        progress_cb("Prueba terminada. Imagen de evidencia generada.")
        return result

    await _run_cancellable(websocket, blocking, stop)


# ---------------------------------------------------------------------------
# Agente propio (para ser el "otro extremo" desde este mismo backend)
# ---------------------------------------------------------------------------
_agent: Optional[Agent] = None
_agent_lock = threading.Lock()


class AgentRequest(BaseModel):
    port: int = DEFAULT_PORT
    key: str = ""
    max_mbps: float = 1000.0


@router.get("/agente")
def agent_status():
    return {"running": _agent is not None, "port": _agent.port if _agent else None}


@router.post("/agente/start")
def agent_start(req: AgentRequest):
    """Levanta el agente UDP en este PC (para probar con otra laptop/equipo como cliente)."""
    global _agent
    with _agent_lock:
        if _agent is not None:
            return {"running": True, "port": _agent.port}
        ag = Agent(port=req.port, key=req.key, max_mbps=req.max_mbps, log=lambda m: None)
        try:
            ag.start()
        except OSError as e:
            raise HTTPException(400, f"No se pudo abrir el puerto UDP {req.port}: {e}")
        _agent = ag
    return {"running": True, "port": req.port}


@router.post("/agente/stop")
def agent_stop():
    global _agent
    with _agent_lock:
        if _agent is not None:
            _agent.stop()
            _agent = None
    return {"running": False}


class OstinatoRequest(BaseModel):
    connection: dict
    ostinato_start_cmd: str
    wait_seconds: int = 60
    wan_cmd: str
    sup_cmd: Optional[str] = None
    disable_paging_cmds: List[str] = []


@router.websocket("/ostinato-saturacion")
async def ostinato_ws(websocket: WebSocket):
    """
    1. Ejecuta `ostinato_start_cmd` en el servidor (arranca el trafico).
    2. Espera `wait_seconds` (con progreso en vivo) para que la
       saturacion suba hasta el ancho de banda del servicio.
    3. Ejecuta `wan_cmd` (y `sup_cmd` si se dio) en el router por
       SSH/Serial, devolviendo la salida de cada uno lista para pegar
       como captura en el checklist (WAN arriba, SUP debajo).
    """
    await websocket.accept()
    params = await websocket.receive_json()
    payload = OstinatoRequest(**params)

    def blocking(progress_cb):
        progress_cb(f">> Iniciando trafico Ostinato: {payload.ostinato_start_cmd}")
        try:
            subprocess.Popen(
                payload.ostinato_start_cmd, shell=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            progress_cb(f"No se pudo lanzar el comando de Ostinato: {e}")

        progress_cb(f"Esperando {payload.wait_seconds}s a que la saturacion suba al ancho de banda del servicio...")
        remaining = payload.wait_seconds
        while remaining > 0:
            step = min(5, remaining)
            time.sleep(step)
            remaining -= step
            progress_cb(f"  ... {remaining}s restantes")

        tests = [("wan", "Saturacion WAN", payload.wan_cmd)]
        if payload.sup_cmd:
            tests.append(("sup", "Saturacion SUP", payload.sup_cmd))

        progress_cb("Capturando en el router...")
        _, results = run_tests(
            payload.connection, payload.disable_paging_cmds, None, tests, None,
            progress_cb=progress_cb,
        )
        by_key = {k: o for k, l, c, o in results}
        return {
            "wan_output": by_key.get("wan", ""),
            "sup_output": by_key.get("sup", "") if payload.sup_cmd else None,
        }

    await run_streaming(websocket, blocking)
    await websocket.close()
