import uuid

from fastapi import APIRouter, Depends, WebSocket
from sqlalchemy.orm import Session

from app.config import OUTPUTS_DIR
from app.database import get_db
from app import schemas
from app.services.logo_store import resolve_logo
from app.services.vendor_commands import get_tests, VENDORS
from app.services.device_link import run_tests
from app.services.pdf_core import build_pdf
from app.ws_utils import run_streaming

router = APIRouter(prefix="/api/tests", tags=["tests"])


@router.websocket("/run")
async def run_tests_ws(websocket: WebSocket):
    await websocket.accept()
    params = await websocket.receive_json()
    payload = schemas.RunTestsRequest(**params)

    vendor = VENDORS[payload.vendor_key]
    tests = get_tests(payload.vendor_key, payload.device_type, uplink=payload.uplink, ping=payload.ping)
    config_test = vendor.get("config_cmd")
    disable_paging = vendor.get("disable_paging", [])
    save_cmds = vendor.get("save_cmds", [])

    def blocking(progress_cb):
        config_text, results = run_tests(
            payload.connection, disable_paging, config_test, tests, save_cmds, progress_cb=progress_cb)
        return {
            "config_text": config_text,
            "results": [{"key": k, "label": l, "cmd": c, "output": o} for k, l, c, o in results],
        }

    await run_streaming(websocket, blocking)
    await websocket.close()


@router.post("/pdf")
def generate_tests_pdf(payload: schemas.TestsPdfRequest, db: Session = Depends(get_db)):
    warnings: list = []
    meta = {
        "device_id": payload.device_id, "ip": payload.ip, "vendor_label": payload.vendor_label,
        "sede": payload.sede, "fecha": payload.fecha,
        "logo_izq": resolve_logo(db, payload.logo_izq_id, payload.logo_izq_path, "izquierdo", warnings),
        "logo_der": resolve_logo(db, payload.logo_der_id, payload.logo_der_path, "derecho", warnings),
    }
    results = [(r["key"], r["label"], r["cmd"], r["output"]) for r in payload.results]
    out_name = f"pruebas_{uuid.uuid4().hex[:10]}.pdf"
    out_path = str(OUTPUTS_DIR / out_name)
    build_pdf(meta, payload.config_text, results, out_path=out_path)
    return {"filename": out_name, "url": f"/api/files/outputs/{out_name}", "warnings": warnings}
