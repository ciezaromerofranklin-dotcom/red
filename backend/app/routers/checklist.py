import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app import models, schemas
from app.services.device_link import run_tests
from app.services.vendor_commands import VENDORS
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
async def run_checklist_ws(websocket: WebSocket):
    """Ejecuta los ítems marcados como 'auto' en una sola conexión SSH/Serial,
    transmitiendo el progreso en vivo por WebSocket.

    - Desactiva el paginado (terminal length 0) para que 'show running-config'
      y similares salgan completos.
    - Un ítem con {PARAM} sin parámetro NO se envía al equipo: un 'ping' vacío
      abre el diálogo interactivo de Cisco y se tragaba los comandos siguientes.
    """
    await websocket.accept()
    params = await websocket.receive_json()
    payload = schemas.ChecklistRunRequest(**params)

    # Sesión de BD solo para leer los ítems (no se mantiene abierta durante toda la ejecución).
    db = SessionLocal()
    try:
        item_ids = [i.item_id for i in payload.items]
        db_items = db.query(models.ChecklistItem).filter(models.ChecklistItem.id.in_(item_ids)).all()
        by_id = {i.id: (i.nombre, i.comando or "") for i in db_items}
    finally:
        db.close()

    plan = []  # (item_id, nombre, comando | None, motivo_omitido)
    for ritem in payload.items:
        found = by_id.get(ritem.item_id)
        if not found:
            continue
        nombre, cmd = found
        if "{PARAM}" in cmd:
            param = (ritem.param or "").strip()
            if not param:
                plan.append((ritem.item_id, nombre, None, f"falta el parámetro para '{cmd}'"))
                continue
            cmd = cmd.replace("{PARAM}", param)
        if not cmd.strip():
            plan.append((ritem.item_id, nombre, None, "el ítem no tiene comando"))
            continue
        plan.append((ritem.item_id, nombre, cmd.strip(), None))

    tests = [(iid, nombre, cmd) for iid, nombre, cmd, why in plan if cmd]
    disable_paging = VENDORS["cisco_ios"]["disable_paging"] + ["terminal width 0"]

    def blocking(progress_cb):
        ran = {}
        if tests:
            _, results = run_tests(payload.connection, disable_paging, None, tests, None, progress_cb=progress_cb)
            ran = {k: (l, c, o) for k, l, c, o in results}
        out = []
        for iid, nombre, cmd, why in plan:
            if cmd is None:
                progress_cb(f"Omitido: {nombre} ({why})")
                out.append({"item_id": iid, "label": nombre, "cmd": "",
                            "output": f"(No se ejecutó: {why}. Escríbelo en el campo 'parámetro' y vuelve a ejecutar.)"})
            else:
                l, c, o = ran.get(iid, (nombre, cmd, ""))
                out.append({"item_id": iid, "label": l, "cmd": c, "output": o})
        return {"results": out}

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
