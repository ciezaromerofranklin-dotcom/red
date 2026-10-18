"""
logo_store.py
Resuelve qué logo usar en un PDF: uno guardado en la base de datos
(por id) o uno subido solo para ese reporte (nombre de archivo).
"""

import os
from typing import Optional, Union

from sqlalchemy.orm import Session

from app import models
from app.config import UPLOADS_DIR


def resolve_logo(
    db: Session,
    logo_id: Optional[str],
    logo_path: Optional[str],
    label: str,
    warnings: list,
) -> Union[bytes, str, None]:
    """
    Devuelve los bytes del logo guardado en la BD, o la ruta del archivo
    subido solo para este reporte, o None si no hay logo. Si el logo
    elegido ya no existe, agrega un aviso a `warnings` y sigue sin él.
    """
    if logo_id:
        logo = db.get(models.HeaderLogo, logo_id)
        if logo:
            return bytes(logo.data)
        warnings.append(
            f"El logo {label} elegido ya no existe en la base de datos; se omitió."
        )

    if logo_path:
        path = str(UPLOADS_DIR / os.path.basename(logo_path))
        if os.path.isfile(path):
            return path
        warnings.append(f"No se encontró el archivo del logo {label}; se omitió.")

    return None
