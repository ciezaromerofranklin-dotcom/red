import os
import uuid
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app import models, schemas
from app.seed_data import CATEGORIAS
from app.services.logo_store import resolve_logo
from app.services.naming import build_report_filename
from app.services.pdf_photo_report import build_photo_report_pdf
from app.services.pdf_poder_judicial import build_pj_report_pdf

router = APIRouter(prefix="/api/photos", tags=["photos"])


# ============================================================
# ÍTEMS (descripciones del reporte)
# ============================================================

def _sort_key(item: models.PhotoItem):
    """
    Categorías en el orden oficial (seed_data.CATEGORIAS); las categorías
    creadas por el usuario van al final, ordenadas por nombre. Dentro de
    cada categoría manda "orden" y, si hay empate, el nombre.
    """
    try:
        rank = CATEGORIAS.index(item.categoria)
        custom = ""
    except ValueError:
        rank = len(CATEGORIAS)
        custom = (item.categoria or "").lower()
    return (rank, custom, item.orden or 0, (item.nombre or "").lower())


@router.get("/items", response_model=list[schemas.PhotoItemOut])
def list_items(categoria: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(models.PhotoItem)
    if categoria:
        q = q.filter(models.PhotoItem.categoria == categoria)
    return sorted(q.all(), key=_sort_key)


@router.post("/items", response_model=schemas.PhotoItemOut)
def create_item(payload: schemas.PhotoItemCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()

    if data.get("orden") is None:
        last = (
            db.query(func.max(models.PhotoItem.orden))
            .filter(models.PhotoItem.categoria == data["categoria"])
            .scalar()
        )
        data["orden"] = (last or 0) + 10

    item = models.PhotoItem(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/items/reorder", response_model=list[schemas.PhotoItemOut])
def reorder_items(payload: schemas.PhotoReorderRequest, db: Session = Depends(get_db)):
    """Guarda el orden de UNA categoría (ids en el orden deseado) en una sola operación."""
    ids = payload.ids

    if len(set(ids)) != len(ids):
        raise HTTPException(400, "Hay ítems repetidos en la lista.")

    items = {
        i.id: i
        for i in db.query(models.PhotoItem).filter(models.PhotoItem.id.in_(ids)).all()
    }

    if len(items) != len(ids):
        raise HTTPException(404, "Algún ítem ya no existe. Recarga la página.")

    if len({i.categoria for i in items.values()}) > 1:
        raise HTTPException(400, "Todos los ítems deben ser de la misma categoría.")

    for pos, item_id in enumerate(ids, start=1):
        items[item_id].orden = pos * 10

    db.commit()
    return [items[i] for i in ids]


@router.put("/items/{item_id}", response_model=schemas.PhotoItemOut)
def update_item(item_id: str, payload: schemas.PhotoItemCreate, db: Session = Depends(get_db)):
    item = db.get(models.PhotoItem, item_id)
    if not item:
        raise HTTPException(404, "Ítem no encontrado.")
    # exclude_none: si no se envía "orden", se conserva el actual
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{item_id}")
def delete_item(item_id: str, db: Session = Depends(get_db)):
    item = db.get(models.PhotoItem, item_id)
    if not item:
        raise HTTPException(404, "Ítem no encontrado.")
    db.delete(item)
    db.commit()
    return {"ok": True}


# ============================================================
# PDF
# ============================================================

def _resolve_upload_path(rel_path: Optional[str]) -> Optional[str]:
    if not rel_path:
        return None
    return str(UPLOADS_DIR / os.path.basename(rel_path))


@router.post("/pdf")
def generate_photo_report_pdf(
    payload: schemas.PhotoReportRequest,
    db: Session = Depends(get_db),
):
    warnings: list[str] = []

    items = []
    for i in payload.items:
        img_path = _resolve_upload_path(i.image_path)

        if img_path and not os.path.isfile(img_path):
            warnings.append(
                f"No se encontró la foto de «{i.descripcion}» en el servidor; "
                "el PDF indica «IMAGEN NO DISPONIBLE». Vuelve a subirla."
            )

        items.append(
            {
                "numero": i.numero,
                "descripcion": i.descripcion,
                "imagen": img_path,
                # GPON: solo lado cliente
                "lado": "cliente" if payload.tipo.startswith("gpon") else i.lado,
            }
        )

    meta = {
        "titulo": payload.titulo,
        "proy": payload.proy,
        "cliente": payload.cliente,
        "sot": payload.sot,
        "fecha": payload.fecha,
        "cid": payload.cid,
        "contrata": payload.contrata,
        "logo_izq": resolve_logo(
            db, payload.logo_izq_id, payload.logo_izq_path, "izquierdo", warnings
        ),
        "logo_der": resolve_logo(
            db, payload.logo_der_id, payload.logo_der_path, "derecho", warnings
        ),
    }

    # Nombre según los datos: RF_SOT-<sot>_<cliente>.pdf
    out_name = build_report_filename(payload.sot, payload.cliente)
    out_path = OUTPUTS_DIR / out_name

    # Se genera en un temporal y se renombra al final: nunca se sirve un
    # PDF a medio escribir y dos reportes simultáneos no se pisan.
    tmp_path = OUTPUTS_DIR / f".{uuid.uuid4().hex}.tmp"

    try:
        _, pages = build_photo_report_pdf(meta, items, str(tmp_path))
        os.replace(tmp_path, out_path)
    except Exception as exc:
        raise HTTPException(500, f"No se pudo generar el PDF: {exc}")
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "filename": out_name,
        "url": f"/api/files/outputs/{quote(out_name)}",
        "pages": pages,
        "warnings": warnings,
    }


@router.post("/pdf-pj")
def generate_pj_report_pdf(
    payload: schemas.PJReportRequest,
    db: Session = Depends(get_db),
):
    warnings: list[str] = []
    data = payload.model_dump()
    data["logo"] = resolve_logo(db, payload.logo_id, payload.logo_path, "de portada", warnings)
    data["foto_ubicacion"] = _resolve_upload_path(payload.foto_ubicacion)
    for sec in data["sections"]:
        for cell in sec["cells"]:
            cell["images"] = [_resolve_upload_path(p) for p in cell["images"]]

    out_name = build_report_filename(payload.sot or payload.sede, payload.sede, prefix="ID")
    out_path = OUTPUTS_DIR / out_name
    tmp_path = OUTPUTS_DIR / f".{uuid.uuid4().hex}.tmp"
    try:
        _, pages, pj_warnings = build_pj_report_pdf(data, str(tmp_path))
        os.replace(tmp_path, out_path)
    except Exception as exc:
        raise HTTPException(500, f"No se pudo generar el PDF: {exc}")
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "filename": out_name,
        "url": f"/api/files/outputs/{quote(out_name)}",
        "pages": pages,
        "warnings": warnings + pj_warnings,
    }
