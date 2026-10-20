"""
report_project.py
Guarda dentro del propio PDF el "proyecto" con el que se generó (datos del
formulario + las fotos), para poder volver a abrirlo y seguir editando.

El proyecto va como archivo adjunto del PDF (no se ve al leerlo, no cambia su
aspecto) comprimido con gzip. Las fotos se incluyen dentro, así que el PDF
funciona aunque el servidor haya borrado sus archivos temporales.
"""

import base64
import gzip
import io
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

ATTACHMENT_NAME = "netops-proyecto.json.gz"
FORMAT_VERSION = 1
PATH_KEYS = ("imagePath", "path")
URL_KEYS = ("imageUrl", "url")
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_PROJECT_BYTES = 120 * 1024 * 1024


def _walk(node: Any, fn) -> None:
    if isinstance(node, dict):
        fn(node)
        for v in node.values():
            _walk(v, fn)
    elif isinstance(node, list):
        for v in node:
            _walk(v, fn)


def embed_project(pdf_path: str, project: dict, uploads_dir: Path) -> Optional[str]:
    """Adjunta el proyecto al PDF. Devuelve un aviso si no se pudo (el PDF sigue válido)."""
    try:
        from pypdf import PdfWriter
    except Exception:
        return "No se pudo guardar el proyecto dentro del PDF (falta pypdf); no podrás reabrirlo para editar."

    try:
        images: dict[str, str] = {}

        def collect(d: dict) -> None:
            for k in PATH_KEYS:
                v = d.get(k)
                if isinstance(v, str) and v and Path(v).suffix.lower() in ALLOWED_EXT:
                    name = os.path.basename(v)
                    f = uploads_dir / name
                    if name not in images and f.is_file():
                        images[name] = base64.b64encode(f.read_bytes()).decode("ascii")

        _walk(project, collect)

        blob = gzip.compress(
            json.dumps(
                {"app": "netops-suite", "version": FORMAT_VERSION, "project": project, "images": images},
                ensure_ascii=False,
            ).encode("utf-8"),
            compresslevel=6,
        )

        writer = PdfWriter(clone_from=pdf_path)
        writer.add_attachment(ATTACHMENT_NAME, blob)
        tmp = f"{pdf_path}.emb"
        with open(tmp, "wb") as fh:
            writer.write(fh)
        os.replace(tmp, pdf_path)
        return None
    except Exception as exc:  # el PDF ya está bien generado: solo se pierde la edición posterior
        logger.warning("No se pudo adjuntar el proyecto: %s", exc)
        return "No se pudo guardar el proyecto dentro del PDF; no podrás reabrirlo para editar."


def load_project(pdf_bytes: bytes, uploads_dir: Path) -> dict:
    """
    Lee el proyecto del PDF, restaura sus fotos en `uploads_dir` y devuelve
    el proyecto con las rutas ya apuntando a los archivos nuevos.
    Lanza ValueError con un mensaje claro si el PDF no se puede reabrir.
    """
    try:
        from pypdf import PdfReader
    except Exception:
        raise ValueError("El servidor no tiene pypdf instalado.")

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        files = reader.attachments
    except Exception:
        raise ValueError("El archivo no es un PDF válido.")

    blobs = files.get(ATTACHMENT_NAME)
    if not blobs:
        raise ValueError(
            "Este PDF no trae los datos para editarlo. Solo se pueden reabrir "
            "los PDF generados por esta aplicación (a partir de esta versión)."
        )

    try:
        data = json.loads(gzip.decompress(blobs[0]).decode("utf-8"))
        project = data["project"]
        images = data.get("images", {})
    except Exception:
        raise ValueError("Los datos de edición del PDF están dañados.")

    if data.get("version", 0) > FORMAT_VERSION:
        raise ValueError("El PDF fue creado con una versión más nueva de la aplicación.")

    new_names: dict[str, str] = {}
    total = 0
    for old, b64 in images.items():
        ext = Path(old).suffix.lower()
        if ext not in ALLOWED_EXT:
            continue
        raw = base64.b64decode(b64)
        total += len(raw)
        if total > MAX_PROJECT_BYTES:
            raise ValueError("El proyecto del PDF es demasiado grande.")
        name = f"{uuid.uuid4().hex}{ext}"
        (uploads_dir / name).write_bytes(raw)
        new_names[os.path.basename(old)] = name

    def remap(d: dict) -> None:
        for k in PATH_KEYS:
            v = d.get(k)
            if isinstance(v, str) and v:
                new = new_names.get(os.path.basename(v))
                if new:
                    d[k] = new
                    for uk in URL_KEYS:
                        if uk in d:
                            d[uk] = f"/api/files/uploads/{new}"
                else:
                    # la foto no venía en el PDF: se deja vacía en lugar de apuntar a nada
                    if Path(v).suffix.lower() in ALLOWED_EXT:
                        d[k] = ""
                        for uk in URL_KEYS:
                            if uk in d:
                                d[uk] = ""

    _walk(project, remap)
    return project
