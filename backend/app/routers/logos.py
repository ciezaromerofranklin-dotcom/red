"""
logos.py
Biblioteca de logos guardados en la base de datos, compartida por todos los
PDF (Pruebas, CheckList y Reporte fotográfico). El binario va en la BD, no en
disco, para que no se pierda cuando el servidor se reinicia o se redespliega.

posicion: 'izq' (empresa) o 'der' (Claro).
"""

import io
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db

router = APIRouter(prefix="/api/logos", tags=["logos"])

POSICIONES = ("izq", "der")
MAX_LOGO_BYTES = 5 * 1024 * 1024
# El logo se dibuja muy pequeño en el PDF: 1200x400 px sobra calidad.
LOGO_MAX_PX = (1200, 400)


def _logo_out(row) -> dict:
    api_url = os.getenv(
        "PUBLIC_API_URL",
        "https://red-five-zeta.vercel.app",
    ).rstrip("/")

    return {
        "id": row.id,
        "posicion": row.posicion,
        "nombre": row.nombre,
        "url": f"{api_url}/api/logos/{row.id}/image",
    }


@router.get("", response_model=list[schemas.HeaderLogoOut])
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


@router.post("", response_model=schemas.HeaderLogoOut)
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


@router.get("/{logo_id}/image")
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


@router.delete("/{logo_id}")
def delete_logo(logo_id: str, db: Session = Depends(get_db)):
    logo = db.get(models.HeaderLogo, logo_id)
    if not logo:
        raise HTTPException(404, "Logo no encontrado.")
    db.delete(logo)
    db.commit()
    return {"ok": True}
