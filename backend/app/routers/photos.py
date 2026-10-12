import io
import os
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app import models, schemas
from app.seed_data import CATEGORIAS
from app.services.naming import build_report_filename
from app.services.pdf_photo_report import build_photo_report_pdf

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
# LOGOS DE CABECERA (guardados en la base de datos)
# ============================================================

POSICIONES = ("izq", "der")
MAX_LOGO_BYTES = 5 * 1024 * 1024
# El logo se dibuja a 1.3 cm de alto: con 1200x400 px sobra calidad.
LOGO_MAX_PX = (1200, 400)


def _logo_url(logo_id: str) -> str:
    return f"/api/photos/logos/{logo_id}/image"


def _logo_out(row) -> dict:
    return {
        "id": row.id,
        "posicion": row.posicion,
        "nombre": row.nombre,
        "url": _logo_url(row.id),
    }


@router.get("/logos", response_model=list[schemas.HeaderLogoOut])
def list_logos(posicion: Optional[str] = None, db: Session = Depends(get_db)):
    if posicion is not None and posicion not in POSICIONES:
        raise HTTPException(400, "Posición inválida (usa 'izq' o 'der').")

    # Solo columnas livianas: no se carga el binario de cada logo en el listado.
    q = db.query(
        models.HeaderLogo.id,
        models.HeaderLogo.posicion,
        models.HeaderLogo.nombre,
    )
    if posicion:
        q = q.filter(models.HeaderLogo.posicion == posicion)

    rows = q.order_by(func.lower(models.HeaderLogo.nombre), models.HeaderLogo.created_at).all()
    return [_logo_out(r) for r in rows]


@router.post("/logos", response_model=schemas.HeaderLogoOut)
def create_logo(
    file: UploadFile = File(...),
    nombre: str = Form(""),
    posicion: str = Form("izq"),
    db: Session = Depends(get_db),
):
    if posicion not in POSICIONES:
        raise HTTPException(400, "Posición inválida (usa 'izq' o 'der').")

    raw = file.file.read()
    if not raw:
        raise HTTPException(400, "El archivo está vacío.")
    if len(raw) > MAX_LOGO_BYTES:
        raise HTTPException(413, "El logo supera los 5 MB.")

    try:
        with Image.open(io.BytesIO(raw)) as src:
            img = ImageOps.exif_transpose(src)
            img.load()

        if img.mode not in ("RGB", "RGBA", "L", "LA"):
            img = img.convert("RGBA")

        img.thumbnail(LOGO_MAX_PX, Image.Resampling.LANCZOS)

        out = io.BytesIO()
        img.save(out, "PNG", optimize=True)
        data = out.getvalue()
    except Exception:
        raise HTTPException(400, "El archivo no es una imagen válida.")

    nombre = (nombre or "").strip() or Path(file.filename or "").stem.strip() or "Logo"

    logo = models.HeaderLogo(
        posicion=posicion,
        nombre=nombre[:80],
        content_type="image/png",
        data=data,
    )
    db.add(logo)
    db.commit()
    db.refresh(logo)
    return _logo_out(logo)


@router.get("/logos/{logo_id}/image")
def get_logo_image(logo_id: str, db: Session = Depends(get_db)):
    logo = db.get(models.HeaderLogo, logo_id)
    if not logo:
        raise HTTPException(404, "Logo no encontrado.")
    return Response(
        content=bytes(logo.data),
        media_type=logo.content_type or "image/png",
        # El contenido de un id nunca cambia -> se puede cachear sin riesgo.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.delete("/logos/{logo_id}")
def delete_logo(logo_id: str, db: Session = Depends(get_db)):
    logo = db.get(models.HeaderLogo, logo_id)
    if not logo:
        raise HTTPException(404, "Logo no encontrado.")
    db.delete(logo)
    db.commit()
    return {"ok": True}


# ============================================================
# PDF
# ============================================================

def _resolve_upload_path(rel_path: Optional[str]) -> Optional[str]:
    if not rel_path:
        return None
    return str(UPLOADS_DIR / os.path.basename(rel_path))


def _resolve_logo(
    db: Session,
    logo_id: Optional[str],
    logo_path: Optional[str],
    label: str,
    warnings: list[str],
):
    """
    Devuelve los bytes del logo guardado en la BD, o la ruta del archivo
    subido solo para este reporte, o None si no hay logo.
    """
    if logo_id:
        logo = db.get(models.HeaderLogo, logo_id)
        if logo:
            return bytes(logo.data)
        warnings.append(
            f"El logo {label} elegido ya no existe en la base de datos; se omitió."
        )

    path = _resolve_upload_path(logo_path)
    if path:
        if os.path.isfile(path):
            return path
        warnings.append(f"No se encontró el archivo del logo {label}; se omitió.")

    return None


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
                "lado": i.lado,
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
        "logo_izq": _resolve_logo(
            db, payload.logo_izq_id, payload.logo_izq_path, "izquierdo", warnings
        ),
        "logo_der": _resolve_logo(
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
