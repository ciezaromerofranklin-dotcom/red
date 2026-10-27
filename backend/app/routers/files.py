
import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from vercel.blob import AsyncBlobClient

from app.config import UPLOADS_DIR, OUTPUTS_DIR

router = APIRouter(prefix="/api/files", tags=["files"])

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()

    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Extensión no permitida: {ext}")

    content = await file.read()

    if not content:
        raise HTTPException(400, "El archivo está vacío.")

    name = f"{uuid.uuid4().hex}{ext}"

    try:
        client = AsyncBlobClient()

        blob = await client.put(
            f"uploads/{name}",
            content,
            access="public",
            content_type=file.content_type or "application/octet-stream",
        )

        return {
            "path": blob.url,
            "url": blob.url,
        }

    except Exception as exc:
        print(f"Error al subir archivo a Vercel Blob: {exc}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo guardar el archivo en el almacenamiento."
        )


@router.get("/uploads/{filename}")
def get_upload(filename: str):
    # Compatibilidad con archivos que todavía existan en el disco local.
    path = UPLOADS_DIR / Path(filename).name

    if not path.is_file():
        raise HTTPException(
            404,
            "Archivo no encontrado en el almacenamiento local."
        )

    return FileResponse(str(path))


@router.get("/outputs/{filename}")
def get_output(filename: str):
    path = OUTPUTS_DIR / Path(filename).name

    if not path.is_file():
        raise HTTPException(404, "Archivo no encontrado.")

    return FileResponse(
        str(path),
        media_type="application/pdf",
        filename=filename,
    )
