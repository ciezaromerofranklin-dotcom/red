"""
naming.py
Nombres de archivo para los PDF generados (sin dependencias externas).

Reporte fotográfico:  RF_SOT-<sot>_<cliente>.pdf
Ejemplo:              RF_SOT-9878773_NOMBRE DE LA EMPRESA.pdf
"""

import re
import datetime as dt
from typing import Optional

# Caracteres no permitidos en nombres de archivo (Windows/Linux/macOS)
_INVALID_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
_SPACES = re.compile(r"\s+")
# "SOT-123", "sot 123", "SOT: 123", "SOT#123" -> "123"
_SOT_PREFIX = re.compile(r"^\s*SOT\s*[-_:.#]*\s*", re.IGNORECASE)

MAX_PART_LEN = 100


def clean_part(text: Optional[str]) -> str:
    """Quita caracteres inválidos, colapsa espacios y recorta bordes."""
    text = _INVALID_CHARS.sub(" ", str(text or ""))
    text = _SPACES.sub(" ", text).strip(" .")
    return text[:MAX_PART_LEN].rstrip(" .")


def build_report_filename(
    sot: Optional[str],
    cliente: Optional[str],
    prefix: str = "RF",
    ext: str = ".pdf",
    now: Optional[dt.datetime] = None,
) -> str:
    """
    Arma el nombre del PDF a partir de los datos del reporte.

    - SOT con o sin el prefijo "SOT" -> siempre "SOT-<número>".
    - Respeta mayúsculas/minúsculas y espacios que escribió el usuario.
    - Si falta un dato, simplemente se omite esa parte.
    - Si faltan ambos, usa la fecha y hora para no pisar otros archivos.
    """
    parts = [prefix]

    sot_clean = clean_part(_SOT_PREFIX.sub("", str(sot or "")))
    if sot_clean:
        parts.append(f"SOT-{sot_clean}")

    cliente_clean = clean_part(cliente)
    if cliente_clean:
        parts.append(cliente_clean)

    if len(parts) == 1:
        now = now or dt.datetime.now()
        parts.append(now.strftime("%Y%m%d_%H%M%S"))

    return "_".join(parts) + ext
