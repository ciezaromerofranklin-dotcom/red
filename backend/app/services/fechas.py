"""
fechas.py
Interpreta lo que el usuario escribe en el campo FECHA ("29 de Agosto de 2026", "29/08/2026",
"2026-08-29", "29-ago-26"...) y normaliza el SOT. Sirve para ordenar los clientes por la fecha
que el usuario puso, no por la de creación.
"""

import datetime as dt
import re
import unicodedata
from typing import Optional

_MESES = {
    "enero": 1, "ene": 1, "febrero": 2, "feb": 2, "marzo": 3, "mar": 3, "abril": 4, "abr": 4,
    "mayo": 5, "may": 5, "junio": 6, "jun": 6, "julio": 7, "jul": 7, "agosto": 8, "ago": 8,
    "septiembre": 9, "setiembre": 9, "sep": 9, "set": 9, "octubre": 10, "oct": 10,
    "noviembre": 11, "nov": 11, "diciembre": 12, "dic": 12,
}

MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
            "Septiembre", "Octubre", "Noviembre", "Diciembre"]


def _plain(text: str) -> str:
    t = unicodedata.normalize("NFD", text or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return t.lower().strip()


def _year(y: int) -> int:
    return 2000 + y if y < 100 else y


def _mk(y: int, m: int, d: int) -> Optional[dt.date]:
    try:
        return dt.date(_year(y), m, d)
    except ValueError:
        return None


def parse_fecha(text: str) -> Optional[dt.date]:
    """Devuelve la fecha interpretada o None si no se entiende. Lo numérico se lee día/mes/año."""
    t = _plain(text)
    if not t:
        return None

    # 2026-08-29 | 2026/08/29
    m = re.search(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", t)
    if m:
        return _mk(int(m[1]), int(m[2]), int(m[3]))

    # 29/08/2026 | 29-08-26 | 29.8.2026
    m = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b", t)
    if m:
        return _mk(int(m[3]), int(m[2]), int(m[1]))

    words = re.sub(r"[,.]", " ", t)
    words = re.sub(r"\b(de|del|el|dia)\b", " ", words)
    words = re.sub(r"-", " ", words)

    # 29 agosto 2026 | 29 ago 26
    m = re.search(r"\b(\d{1,2})\s+([a-z]{3,10})\s+(\d{2,4})\b", words)
    if m and m[2] in _MESES:
        return _mk(int(m[3]), _MESES[m[2]], int(m[1]))

    # agosto 29 2026
    m = re.search(r"\b([a-z]{3,10})\s+(\d{1,2})\s+(\d{2,4})\b", words)
    if m and m[1] in _MESES:
        return _mk(int(m[3]), _MESES[m[1]], int(m[2]))
    return None


_SOT_PREFIX = re.compile(r"^\s*SOT\s*[-_:.#]*\s*", re.I)


def normalize_sot(text: str) -> str:
    """'SOT-98765432' / 'sot 98765432' -> '98765432' (sin espacios ni símbolos raros)."""
    s = _SOT_PREFIX.sub("", str(text or ""))
    return re.sub(r"[^0-9A-Za-z-]", "", s).upper()
