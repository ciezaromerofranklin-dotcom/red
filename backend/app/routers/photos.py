import os
import uuid
import asyncio
import tempfile
import logging
from urllib.parse import urlparse
from urllib.request import urlopen
from typing import Optional
from vercel.blob import AsyncBlobClient
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import UPLOADS_DIR
from app import auth, models, schemas
from app.services.clients_service import safe_upsert
from app.seed_data import CATEGORIAS, TIPO_CATEGORIAS
from app.services.logo_store import resolve_logo
from app.services.naming import build_report_filename
from app.services.pdf_photo_report import build_photo_report_pdf
from app.services.pdf_poder_judicial import build_pj_report_pdf
from app.services.report_project import embed_project, load_project

logger = logging.getLogger(__name__)
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
    orden_oficial = TIPO_CATEGORIAS.get(getattr(item, "tipo", None) or "fibra", CATEGORIAS)
    try:
        rank = orden_oficial.index(item.categoria)
        custom = ""
    except ValueError:
        rank = len(orden_oficial)
        custom = (item.categoria or "").lower()
    return (rank, custom, item.orden or 0, (item.nombre or "").lower())


@router.get("/items", response_model=list[schemas.PhotoItemOut])
def list_items(
    categoria: Optional[str] = None,
    tipo: str = "fibra",
    db: Session = Depends(get_db),
):
    if tipo not in TIPO_CATEGORIAS:
        raise HTTPException(400, "Tipo de reporte inválido.")
    q = db.query(models.PhotoItem).filter(models.PhotoItem.tipo == tipo)
    if categoria:
        q = q.filter(models.PhotoItem.categoria == categoria)
    return sorted(q.all(), key=_sort_key)


@router.post("/items", response_model=schemas.PhotoItemOut)
def create_item(payload: schemas.PhotoItemCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    data["tipo"] = data.get("tipo") or "fibra"

    if data.get("orden") is None:
        last = (
            db.query(func.max(models.PhotoItem.orden))
            .filter(
                models.PhotoItem.categoria == data["categoria"],
                models.PhotoItem.tipo == data["tipo"],
            )
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

def _download_blob_image(url: str, temp_files: list[str]) -> str:
    """Descarga una imagen pública de Vercel Blob a un archivo temporal."""

    parsed = urlparse(url)

    if parsed.scheme != "https":
        raise ValueError("La URL de la imagen debe utilizar HTTPS.")

    hostname = (parsed.hostname or "").lower()

    if not (
        hostname.endswith(".public.blob.vercel-storage.com")
        or hostname == "blob.vercel-storage.com"
    ):
        raise ValueError("El dominio de la imagen no está permitido.")

    suffix = os.path.splitext(parsed.path)[1].lower()

    if suffix not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        suffix = ".img"

    temp_path = None

    try:
        with urlopen(url, timeout=20) as response:
            content = response.read(20 * 1024 * 1024 + 1)

        if not content:
            raise ValueError("La imagen descargada está vacía.")

        if len(content) > 20 * 1024 * 1024:
            raise ValueError("La imagen supera el límite de 20 MB.")

        with tempfile.NamedTemporaryFile(
            mode="wb",
            suffix=suffix,
            prefix="netops_img_",
            dir="/tmp",
            delete=False,
        ) as temp_file:
            temp_path = temp_file.name
            temp_file.write(content)

        temp_files.append(temp_path)
        return temp_path

    except Exception:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        raise


async def _resolve_upload_path(
    rel_path: Optional[str],
    temp_files: list[str],
) -> Optional[str]:
    """Resuelve imágenes de Vercel Blob y archivos locales existentes."""

    if not rel_path:
        return None

    value = str(rel_path).strip()

    if value.startswith(("https://", "http://")):
        try:
            return await asyncio.to_thread(
                _download_blob_image,
                value,
                temp_files,
            )
        except Exception as exc:
            logger.warning(
                "No se pudo recuperar la imagen desde Blob: %s",
                exc,
            )
            return None

    # Compatibilidad con archivos locales antiguos.
    filename = os.path.basename(value)
    local_path = UPLOADS_DIR / filename

    if local_path.is_file():
        return str(local_path)

    logger.warning("No se encontró la imagen: %s", filename)
    return None


@router.post("/pdf")
async def generate_photo_report_pdf(
    payload: schemas.PhotoReportRequest,
    db: Session = Depends(get_db),
    me: models.User = Depends(auth.current_user),
):
    warnings: list[str] = []
    temp_files: list[str] = []
    tmp_path = f"/tmp/{uuid.uuid4().hex}.pdf"

    try:
        items = []

        for i in payload.items:
            img_path = await _resolve_upload_path(i.image_path, temp_files)

            if i.image_path and not img_path:
                warnings.append(
                    f"No se pudo recuperar la foto de «{i.descripcion}»; "
                    "el PDF indicará «IMAGEN NO DISPONIBLE». Vuelve a subirla."
                )

            items.append({
                "numero": i.numero,
                "descripcion": i.descripcion,
                "imagen": img_path,
                "lado": "cliente" if payload.tipo.startswith("gpon") else i.lado,
            })

        meta = {
            "titulo": payload.titulo,
            "proy": payload.proy,
            "cliente": payload.cliente,
            "sot": payload.sot,
            "fecha": payload.fecha,
            "cid": payload.cid,
            "contrata": payload.contrata,
            "logo_izq": resolve_logo(
                db, payload.logo_izq_id, payload.logo_izq_path,
                "izquierdo", warnings
            ),
            "logo_der": resolve_logo(
                db, payload.logo_der_id, payload.logo_der_path,
                "derecho", warnings
            ),
        }

        out_name = build_report_filename(payload.sot, payload.cliente)

        # Generar el PDF sin escribir en el sistema de archivos permanente.
        _, pages = build_photo_report_pdf(meta, items, tmp_path)

        if payload.project is not None:
            msg = embed_project(tmp_path, payload.project, UPLOADS_DIR)
            if msg:
                warnings.append(msg)

        with open(tmp_path, "rb") as pdf_file:
            pdf_bytes = pdf_file.read()

        if not pdf_bytes:
            raise RuntimeError("El PDF generado está vacío.")

        client = AsyncBlobClient()
        blob = await client.put(
            f"outputs/{uuid.uuid4().hex}-{out_name}",
            pdf_bytes,
            access="public",
            content_type="application/pdf",
        )

        # Cliente (SOT) del usuario: se crea o se actualiza con lo que se acaba de generar.
        safe_upsert(db, me, sot=payload.sot, cliente=payload.cliente, cid=payload.cid,
                    fecha_texto=payload.fecha, modulo=f"fotografico_{payload.tipo}",
                    datos={"proy": payload.proy, "contrata": payload.contrata})

        return {
            "filename": out_name,
            "url": blob.url,
            "pages": pages,
            "warnings": warnings,
        }

    except Exception as exc:
        logger.exception("Error al generar el reporte PDF")
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo generar o guardar el PDF: {exc}",
        )

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

        for temp_file in temp_files:
            if os.path.exists(temp_file):
                os.remove(temp_file)
                
@router.post("/pdf-pj")
async def generate_pj_report_pdf(
    payload: schemas.PJReportRequest,
    db: Session = Depends(get_db),
    me: models.User = Depends(auth.current_user),
):
    warnings: list[str] = []
    temp_files: list[str] = []
    tmp_path = f"/tmp/{uuid.uuid4().hex}.pdf"

    try:
        data = payload.model_dump()

        data["logo"] = resolve_logo(
            db, payload.logo_id, payload.logo_path, "de portada", warnings
        )

        data["foto_ubicacion"] = await _resolve_upload_path(
            payload.foto_ubicacion, temp_files
        )

        for sec in data["sections"]:
            for cell in sec["cells"]:
                resolved_images = []

                for image_path in cell["images"]:
                    resolved = await _resolve_upload_path(
                        image_path, temp_files
                    )
                    resolved_images.append(resolved)

                    if image_path and not resolved:
                        warnings.append(
                            "No se pudo recuperar una imagen de una sección "
                            "del reporte del Poder Judicial."
                        )

                cell["images"] = resolved_images

        out_name = build_report_filename(
            payload.sot or payload.sede,
            payload.sede,
            prefix="ID",
        )

        _, pages, pj_warnings = build_pj_report_pdf(data, tmp_path)

        if payload.project is not None:
            msg = embed_project(tmp_path, payload.project, UPLOADS_DIR)
            if msg:
                pj_warnings.append(msg)

        with open(tmp_path, "rb") as pdf_file:
            pdf_bytes = pdf_file.read()

        if not pdf_bytes:
            raise RuntimeError("El PDF generado está vacío.")

        client = AsyncBlobClient()
        blob = await client.put(
            f"outputs/{uuid.uuid4().hex}-{out_name}",
            pdf_bytes,
            access="public",
            content_type="application/pdf",
        )

        # La fecha del informe es la de su última versión (o el período si no hay).
        pj_fecha = next((c.fecha for c in reversed(payload.cambios) if (c.fecha or "").strip()), "") or payload.periodo
        safe_upsert(db, me, sot=payload.sot, cliente=payload.sede, fecha_texto=pj_fecha,
                    modulo="poder_judicial", datos={"direccion": payload.direccion})

        return {
            "filename": out_name,
            "url": blob.url,
            "pages": pages,
            "warnings": warnings + pj_warnings,
        }

    except Exception as exc:
        logger.exception("Error al generar el PDF del Poder Judicial")
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo generar o guardar el PDF: {exc}",
        )

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

        for temp_file in temp_files:
            if os.path.exists(temp_file):
                os.remove(temp_file)

@router.post("/import-pdf")
async def import_report_pdf(file: UploadFile = File(...)):
    """Abre un PDF generado por la app y devuelve el estado para seguir editándolo."""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "El archivo está vacío.")
    try:
        project = load_project(raw, UPLOADS_DIR)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return project
