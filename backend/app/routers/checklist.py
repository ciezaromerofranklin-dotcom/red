import os
import re
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app import models, schemas
from app.services.device_link import run_tests
from app.services.vendor_commands import VENDORS
from app.services.logo_store import resolve_logo
from app.services.pdf_checklist import build_checklist_pdf
from app.services.naming import build_checklist_filename
from app import checklist_profiles
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


_VAR_RE = re.compile(r"\{([A-Z][A-Z0-9_]*)\}")


@router.websocket("/run")
async def run_checklist_ws(websocket: WebSocket):
    """Ejecuta los ítems automáticos en una sola conexión SSH/Serial y transmite el
    progreso en vivo por WebSocket.

    - Cada ítem llega con su comando ya armado (variables reemplazadas), así que sirven
      también los ítems creados o editados solo en la pantalla.
    - Se desactiva el paginado según la marca (Cisco / Huawei / Fortinet).
    - Un ítem con variables sin completar ({WAN_NH}, {PARAM}...) NO se envía al equipo: un
      'ping' vacío abre el diálogo interactivo de Cisco y se tragaba los comandos siguientes.
    """
    await websocket.accept()
    params = await websocket.receive_json()
    payload = schemas.ChecklistRunRequest(**params)

    # Compatibilidad: si un ítem no trae comando, se busca en la BD por su id.
    legacy_ids = [i.item_id for i in payload.items if i.comando is None]
    legacy = {}
    if legacy_ids:
        db = SessionLocal()
        try:
            rows = db.query(models.ChecklistItem).filter(models.ChecklistItem.id.in_(legacy_ids)).all()
            legacy = {r.id: (r.nombre, r.comando or "") for r in rows}
        finally:
            db.close()

    plan = []  # (item_id, nombre, comando | None, motivo_omitido)
    for ritem in payload.items:
        if ritem.comando is not None:
            nombre, cmd = ritem.nombre or ritem.item_id, ritem.comando
        elif ritem.item_id in legacy:
            nombre, cmd = legacy[ritem.item_id]
        else:
            continue
        if (ritem.param or "").strip():
            cmd = cmd.replace("{PARAM}", ritem.param.strip())
        pending = sorted(set(_VAR_RE.findall(cmd)))
        if pending:
            plan.append((ritem.item_id, nombre, None, "faltan datos: " + ", ".join(pending)))
            continue
        if not cmd.strip():
            plan.append((ritem.item_id, nombre, None, "el ítem no tiene comando"))
            continue
        plan.append((ritem.item_id, nombre, cmd.strip(), None))

    tests = [(iid, nombre, cmd) for iid, nombre, cmd, why in plan if cmd]
    vendor = payload.vendor if payload.vendor in VENDORS else "cisco_ios"
    disable_paging = list(VENDORS[vendor]["disable_paging"])
    if vendor == "cisco_ios":
        disable_paging.append("terminal width 0")

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
                            "output": f"(No se ejecutó: {why}. Complétalo arriba y vuelve a ejecutar.)"})
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
    """Genera el PDF. Se nombra  checklist_sot_<SOT>-<cliente>.pdf  (ver services/naming.py)."""
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
        "titulo": payload.titulo, "subtitulo": payload.subtitulo,
        "servicio_label": payload.servicio_label,
        # En la cabecera ya se escribe "SOT: ..." (no repetir si lo tipearon como "SOT-123").
        "sot": re.sub(r"^\s*SOT\s*[-_:.#]*\s*", "", payload.sot, flags=re.I).strip(), "cid": payload.cid, "fecha": payload.fecha, "pie": payload.pie,
        "device_id": payload.device_id,
        "logo": resolve_logo(db, payload.logo_id, payload.logo_path, "", warnings),
    }

    out_name = build_checklist_filename(payload.sot, payload.cliente)
    out_path = str(OUTPUTS_DIR / out_name)
    build_checklist_pdf(meta, sections_list, out_path)
    return {"filename": out_name, "url": f"/api/files/outputs/{quote(out_name)}", "warnings": warnings}


# ---------------------------------------------------------------------------
# Perfiles (plantillas de CheckList): listar, guardar el checklist actual como perfil, restaurar
# ---------------------------------------------------------------------------
@router.get("/profiles")
def list_profiles(db: Session = Depends(get_db)):
    """Perfiles con su marca y si son de fábrica (se pueden restaurar)."""
    builtin = {p["clave"] for p in checklist_profiles.PROFILES}
    counts = {}
    for it in db.query(models.ChecklistItem.servicio).all():
        counts[it[0]] = counts.get(it[0], 0) + 1
    out = []
    for svc in db.query(models.Service).all():
        out.append({"clave": svc.clave, "etiqueta": svc.etiqueta, "vendor": svc.vendor or "",
                    "builtin": svc.clave in builtin, "items": counts.get(svc.clave, 0)})
    order = {k: i for i, k in enumerate(checklist_profiles.PROFILE_ORDER)}
    out.sort(key=lambda x: (order.get(x["clave"], 999), x["etiqueta"].lower()))
    return out


@router.post("/profiles")
def save_profile(payload: schemas.ChecklistProfileSave, db: Session = Depends(get_db)):
    """Guarda (crea o reemplaza) un perfil con la lista de ítems recibida."""
    clave = re.sub(r"[^a-z0-9_]+", "_", payload.clave.strip().lower()).strip("_")
    if not clave:
        raise HTTPException(400, "Indica un nombre para el perfil.")
    if not payload.items:
        raise HTTPException(400, "No hay ítems para guardar.")
    svc = db.query(models.Service).filter_by(clave=clave).first()
    if svc is None:
        svc = models.Service(clave=clave, etiqueta=payload.etiqueta.strip() or clave, vendor=payload.vendor or "")
        db.add(svc)
    else:
        if payload.etiqueta.strip():
            svc.etiqueta = payload.etiqueta.strip()
        if payload.vendor:
            svc.vendor = payload.vendor
    db.query(models.ChecklistItem).filter(models.ChecklistItem.servicio == clave).delete()
    for i, it in enumerate(payload.items):
        modo = "manual" if it.modo == "manual" else "auto"
        db.add(models.ChecklistItem(servicio=clave, seccion=it.seccion, nombre=it.nombre,
                                    orden=(i + 1) * 10, modo=modo, comando=it.comando if modo == "auto" else ""))
    db.commit()
    return {"clave": clave, "etiqueta": svc.etiqueta, "items": len(payload.items)}


@router.post("/profiles/{clave}/restore")
def restore_profile(clave: str, db: Session = Depends(get_db)):
    """Deja un perfil de fábrica como el original (descarta las ediciones del perfil)."""
    try:
        n = checklist_profiles.restore_profile(db, clave)
    except KeyError:
        raise HTTPException(404, "Ese perfil no es de fábrica.")
    return {"clave": clave, "items": n}
