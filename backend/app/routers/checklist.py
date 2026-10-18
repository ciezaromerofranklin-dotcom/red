import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app import models, schemas
from app.services.device_link import run_tests
from app.services.logo_store import resolve_logo
from app.services.pdf_checklist import build_checklist_pdf
from app.ws_utils import run_streaming

router = APIRouter(prefix="/api/checklist", tags=["checklist"])


@router.get("/items", response_model=list[schemas.ChecklistItemOut])
def list_items(servicio: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(models.ChecklistItem)
    if servicio:
        q = q.filter(models.ChecklistItem.servicio == servicio)
    return q.order_by(models.ChecklistItem.orden).all()


@router.post("/items", response_model=schemas.ChecklistItemOut)
def create_item(payload: schemas.ChecklistItemCreate, db: Session = Depends(get_db)):
    item = models.ChecklistItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/items/{item_id}", response_model=schemas.ChecklistItemOut)
def update_item(item_id: str, payload: schemas.ChecklistItemCreate, db: Session = Depends(get_db)):
    item = db.query(models.ChecklistItem).get(item_id)
    if not item:
        raise HTTPException(404, "Ítem no encontrado.")
    for k, v in payload.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{item_id}")
def delete_item(item_id: str, db: Session = Depends(get_db)):
    item = db.query(models.ChecklistItem).get(item_id)
    if not item:
        raise HTTPException(404, "Ítem no encontrado.")
    db.delete(item)
    db.commit()
    return {"ok": True}


@router.websocket("/run")
async def run_checklist_ws(websocket: WebSocket, db: Session = Depends(get_db)):
    """Ejecuta los ítems marcados como 'auto' en una sola conexión SSH/Serial,
    transmitiendo el progreso en vivo por WebSocket."""
    await websocket.accept()
    params = await websocket.receive_json()
    payload = schemas.ChecklistRunRequest(**params)

    item_ids = [i.item_id for i in payload.items]
    db_items = db.query(models.ChecklistItem).filter(models.ChecklistItem.id.in_(item_ids)).all()
    by_id = {i.id: i for i in db_items}

    tests = []
    for ritem in payload.items:
        item = by_id.get(ritem.item_id)
        if not item:
            continue
        cmd = item.comando or ""
        if "{PARAM}" in cmd:
            cmd = cmd.replace("{PARAM}", ritem.param or "")
        tests.append((item.id, item.nombre, cmd))

    def blocking(progress_cb):
        _, results = run_tests(payload.connection, [], None, tests, None, progress_cb=progress_cb)
        return {"results": [{"item_id": k, "label": l, "cmd": c, "output": o} for k, l, c, o in results]}

    await run_streaming(websocket, blocking)
    await websocket.close()


def _resolve_upload_path(rel_path: str) -> str:
    """rel_path es lo que devolvió /api/uploads (nombre de archivo)."""
    return str(UPLOADS_DIR / os.path.basename(rel_path))


@router.post("/pdf")
def generate_checklist_pdf(payload: schemas.ChecklistPdfRequest, db: Session = Depends(get_db)):
    warnings: list = []
    sections_order = []
    sections = {}
    for it in payload.items:
        if it.seccion not in sections:
            sections[it.seccion] = []
            sections_order.append(it.seccion)
        d = {"nombre": it.nombre, "modo": it.modo}
        if it.modo == "manual":
            d["images"] = [_resolve_upload_path(p) for p in it.image_paths]
        else:
            d["cmd"] = it.cmd
            d["output"] = it.output
        sections[it.seccion].append(d)

    sections_list = [(s, sections[s]) for s in sections_order]
    meta = {
        "titulo": payload.titulo, "servicio_label": payload.servicio_label,
        "sot": payload.sot, "cid": payload.cid, "fecha": payload.fecha,
        "device_id": payload.device_id,
        "logo": resolve_logo(db, payload.logo_id, payload.logo_path, "", warnings),
    }

    out_name = f"checklist_{uuid.uuid4().hex[:10]}.pdf"
    out_path = str(OUTPUTS_DIR / out_name)
    build_checklist_pdf(meta, sections_list, out_path)
    return {"filename": out_name, "url": f"/api/files/outputs/{out_name}", "warnings": warnings}
