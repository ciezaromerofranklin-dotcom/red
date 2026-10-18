"""
logo_image.py
Lectura de logos para los PDF. Un logo puede venir como:
  - bytes  -> guardado en la base de datos (tabla header_logos)
  - str    -> ruta de un archivo subido solo para ese reporte
"""

import io
import logging
import os

from reportlab.lib.utils import ImageReader

logger = logging.getLogger(__name__)


def logo_reader(src):
    """Devuelve un ImageReader listo para dibujar, o None si no hay/ no se puede leer."""
    if not src:
        return None

    try:
        if isinstance(src, (bytes, bytearray)):
            return ImageReader(io.BytesIO(bytes(src)))

        if isinstance(src, str) and os.path.isfile(src):
            return ImageReader(src)

    except Exception as exc:
        logger.warning("No se pudo leer el logo: %s", exc)

    return None
