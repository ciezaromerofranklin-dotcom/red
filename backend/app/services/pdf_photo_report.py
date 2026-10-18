"""
pdf_photo_report.py

Genera el PDF del reporte fotográfico agrupando las fotografías
según el lado seleccionado para cada imagen:

SITE, PDI, POP, CLIENTE

Cada foto lleva su leyenda "ITEM N: descripción" debajo. La numeración
reinicia en 1 dentro de cada lado (cada lado es una sección con su título).
"""

import io
import logging
import os

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib.colors import HexColor
from PIL import Image, ImageOps

from app.services.logo_image import logo_reader

logger = logging.getLogger(__name__)

PAGE_W, PAGE_H = letter

MARGIN = 1.3 * cm
LOGO_H = 1.3 * cm
LOGO_MAX_W = 5.2 * cm  # evita que un logo muy ancho pise el título central
HEADER_H = MARGIN + LOGO_H + 0.4 * cm
INFO_TABLE_H = 2.0 * cm

GRID_COLS = 2
GRID_ROWS = 2
ITEMS_PER_PAGE = GRID_COLS * GRID_ROWS

ACCENT = HexColor("#2F5496")

# Las fotos de celular pesan varios MB: se reducen para que el PDF
# se genere rápido y no salga gigante (1600 px sobra para una celda de ~9 cm).
MAX_PHOTO_PX = 1600
JPEG_QUALITY = 85

CAPTION_FONT = "Helvetica-Oblique"
CAPTION_LABEL_FONT = "Helvetica-Bold"
CAPTION_SIZE = 8.5
CAPTION_LEADING = 10
CAPTION_MAX_LINES = 3


# ============================================================
# IMÁGENES
# ============================================================

def fix_img(path):
    """Abre la imagen aplicando la orientación EXIF. None si no se puede."""
    try:
        if not path or not os.path.isfile(path):
            return None

        with Image.open(path) as im:
            img = ImageOps.exif_transpose(im)
            img.load()
            return img

    except Exception as exc:
        logger.warning("No se pudo abrir la imagen %s: %s", path, exc)
        return None


def _prepare_photo(path):
    """
    Devuelve un ImageReader (JPEG reducido) listo para dibujar, o None.
    """
    img = fix_img(path)
    if img is None:
        return None

    try:
        if img.mode in ("RGBA", "LA") or (
            img.mode == "P" and "transparency" in img.info
        ):
            rgba = img.convert("RGBA")
            background = Image.new("RGB", rgba.size, (255, 255, 255))
            background.paste(rgba, mask=rgba.split()[-1])
            img = background
        else:
            img = img.convert("RGB")

        img.thumbnail((MAX_PHOTO_PX, MAX_PHOTO_PX), Image.Resampling.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True)
        buf.seek(0)
        return ImageReader(buf)

    except Exception as exc:
        logger.warning("No se pudo preparar la imagen %s: %s", path, exc)
        return None


# ============================================================
# CONFIGURACIÓN DE LADOS
# ============================================================

LADO_LABELS = {
    "site": "SITE",
    "pdi": "PDI",
    "pop": "POP",
    "cliente": "CLIENTE",
}

LADO_ORDER = ["site", "pdi", "pop", "cliente"]


def _normalize_lado(lado):
    lado = str(lado or "").strip().lower()
    if lado in LADO_LABELS:
        return lado
    return "site"


def _build_lado_title(lado):
    label = LADO_LABELS.get(_normalize_lado(lado), "SITE")
    return f"REPORTE FOTOGRAFICO INSTALACION EN {label}"


def _group_items_by_lado(items):
    groups = {
        "site": [],
        "pdi": [],
        "pop": [],
        "cliente": [],
    }

    for item in items:
        lado = _normalize_lado(item.get("lado"))
        groups[lado].append(item)

    return [
        (lado, groups[lado])
        for lado in LADO_ORDER
        if groups[lado]
    ]


# ============================================================
# TEXTO
# ============================================================

def _truncate_to_width(c, text, font, size, max_width):
    if c.stringWidth(text, font, size) <= max_width:
        return text

    ell = "..."
    while text and c.stringWidth(text + ell, font, size) > max_width:
        text = text[:-1]

    return text + ell if text else ell


def _split_long_word(c, word, font, size, width):
    """Parte por caracteres una palabra que no cabe en una línea."""
    chunks, cur = [], ""

    for ch in word:
        if not cur or c.stringWidth(cur + ch, font, size) <= width:
            cur += ch
        else:
            chunks.append(cur)
            cur = ch

    if cur:
        chunks.append(cur)

    return chunks


def _wrap_text(c, text, font, size, first_w, other_w, max_lines):
    """
    Ajusta el texto en varias líneas. La primera línea es más corta
    (comparte espacio con la etiqueta "ITEM N:"). Si no entra en
    max_lines, la última línea termina en "...".
    """
    words = str(text or "").split()
    lines, cur, limit = [], "", first_w

    for word in words:
        candidate = f"{cur} {word}".strip()

        if c.stringWidth(candidate, font, size) <= limit:
            cur = candidate
            continue

        if cur:
            lines.append(cur)
            cur = ""
            limit = other_w

        if c.stringWidth(word, font, size) <= limit:
            cur = word
        else:
            chunks = _split_long_word(c, word, font, size, limit)
            for chunk in chunks[:-1]:
                lines.append(chunk)
                limit = other_w
            cur = chunks[-1]

    if cur:
        lines.append(cur)

    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1].rstrip()
        width = first_w if max_lines == 1 else other_w
        while last and c.stringWidth(last + "...", font, size) > width:
            last = last[:-1]
        lines[-1] = last + "..."

    return lines


# ============================================================
# HEADER
# ============================================================

def _draw_logo(c, src, side, top, max_w=LOGO_MAX_W):
    reader = logo_reader(src)
    if reader is None:
        return

    try:
        iw, ih = reader.getSize()
        scale = min(LOGO_H / ih, max_w / iw)
        w, h = iw * scale, ih * scale

        x = MARGIN if side == "left" else PAGE_W - MARGIN - w
        y = top - MARGIN - LOGO_H + (LOGO_H - h) / 2

        c.drawImage(
            reader,
            x,
            y,
            width=w,
            height=h,
            preserveAspectRatio=True,
            mask="auto",
        )

    except Exception as exc:
        logger.warning("No se pudo dibujar el logo (%s): %s", side, exc)


TITLE_FONT = "Helvetica-BoldOblique"
TITLE_SIZE = 13


def _draw_header(c, meta):
    top = PAGE_H
    titulo = meta.get("titulo", "REPORTE FOTOGRAFICO")

    # Cada logo puede ocupar, como máximo, el espacio que deja libre el
    # título centrado (para que nunca se encimen).
    title_w = c.stringWidth(titulo, TITLE_FONT, TITLE_SIZE)
    free_w = PAGE_W / 2 - title_w / 2 - MARGIN - 0.3 * cm
    logo_max_w = max(2 * cm, min(LOGO_MAX_W, free_w))

    _draw_logo(c, meta.get("logo_izq"), "left", top, logo_max_w)
    _draw_logo(c, meta.get("logo_der"), "right", top, logo_max_w)

    c.setFillColorRGB(0, 0, 0)
    c.setFont(TITLE_FONT, TITLE_SIZE)
    c.drawCentredString(
        PAGE_W / 2,
        top - MARGIN - LOGO_H / 2,
        titulo,
    )


# ============================================================
# INFO TABLE
# ============================================================

def _draw_info_table(c, meta, y_top):

    rows = [
        ("PROY:", meta.get("proy", ""), "CLIENTE:", meta.get("cliente", "")),
        ("SOT:", meta.get("sot", ""), "FECHA:", meta.get("fecha", "")),
        ("CID:", meta.get("cid", ""), "CONTRATA:", meta.get("contrata", "")),
    ]

    table_w = PAGE_W - 2 * MARGIN
    row_h = INFO_TABLE_H / 3

    col1_w = table_w * 0.12
    col2_w = table_w * 0.38
    col3_w = table_w * 0.14
    col4_w = table_w * 0.36

    x0 = MARGIN
    y = y_top

    c.setStrokeColorRGB(0, 0, 0)
    c.setFillColorRGB(0, 0, 0)
    c.rect(x0, y - INFO_TABLE_H, table_w, INFO_TABLE_H)

    for i in range(1, 3):
        c.line(x0, y - i * row_h, x0 + table_w, y - i * row_h)

    c.line(x0 + col1_w, y - INFO_TABLE_H, x0 + col1_w, y)
    c.line(x0 + col1_w + col2_w, y - INFO_TABLE_H, x0 + col1_w + col2_w, y)
    c.line(x0 + col1_w + col2_w + col3_w, y - INFO_TABLE_H, x0 + col1_w + col2_w + col3_w, y)

    for r, (l1, v1, l2, v2) in enumerate(rows):

        row_center_y = y - r * row_h - row_h / 2

        c.setFont("Helvetica-Bold", 8.5)
        c.drawCentredString(x0 + col1_w / 2, row_center_y, l1)

        c.setFont("Helvetica", 8)
        v1 = _truncate_to_width(c, str(v1), "Helvetica", 8, col2_w)
        c.drawCentredString(x0 + col1_w + col2_w / 2, row_center_y, v1)

        c.setFont("Helvetica-Bold", 8.5)
        c.drawCentredString(x0 + col1_w + col2_w + col3_w / 2, row_center_y, l2)

        c.setFont("Helvetica", 8)
        v2 = _truncate_to_width(c, str(v2), "Helvetica", 8, col4_w)
        c.drawCentredString(
            x0 + col1_w + col2_w + col3_w + col4_w / 2,
            row_center_y,
            v2,
        )

    return y - INFO_TABLE_H


# ============================================================
# FOOTER
# ============================================================

def _draw_footer(c, page_num, total_pages):
    c.setFont("Helvetica", 8)
    c.setFillColorRGB(0.4, 0.4, 0.4)

    c.drawRightString(
        PAGE_W - MARGIN,
        0.7 * cm,
        f"Página {page_num} de {total_pages}",
    )


# ============================================================
# CELDA (FOTO + LEYENDA)
# ============================================================

def _draw_placeholder(c, x, y_top, cell_w, photo_h, text, color=(0.55, 0.55, 0.55)):
    c.setFillColorRGB(*color)
    c.setFont("Helvetica-Oblique", 9)
    c.drawCentredString(x + cell_w / 2, y_top - photo_h / 2, text)
    c.setFillColorRGB(0, 0, 0)


def _draw_photo(c, item, x, y_top, cell_w, photo_h):
    img_path = item.get("imagen")

    if not img_path:
        _draw_placeholder(c, x, y_top, cell_w, photo_h, "SIN FOTO")
        return

    reader = _prepare_photo(img_path)
    if reader is None:
        _draw_placeholder(
            c, x, y_top, cell_w, photo_h,
            "IMAGEN NO DISPONIBLE",
            color=(0.75, 0.1, 0.1),
        )
        return

    iw, ih = reader.getSize()

    scale = min(
        (cell_w - 10) / iw,
        (photo_h - 10) / ih,
    )

    w = iw * scale
    h = ih * scale

    c.drawImage(
        reader,
        x + (cell_w - w) / 2,
        y_top - photo_h + (photo_h - h) / 2,
        width=w,
        height=h,
        mask="auto",
    )


def _draw_caption(c, numero, descripcion, x, y_top, cell_w, photo_h):
    """Línea separadora + 'ITEM N: descripción' (hasta 3 líneas)."""
    sep_y = y_top - photo_h - 0.1 * cm

    c.setStrokeColorRGB(0, 0, 0)
    c.line(x, sep_y, x + cell_w, sep_y)

    c.setFillColorRGB(0, 0, 0)

    label = f"ITEM {numero}: "
    c.setFont(CAPTION_LABEL_FONT, CAPTION_SIZE)
    label_w = c.stringWidth(label, CAPTION_LABEL_FONT, CAPTION_SIZE)

    y = sep_y - CAPTION_SIZE - 1.5
    c.drawString(x + 4, y, label)

    lines = _wrap_text(
        c,
        descripcion,
        CAPTION_FONT,
        CAPTION_SIZE,
        first_w=cell_w - 8 - label_w,
        other_w=cell_w - 8,
        max_lines=CAPTION_MAX_LINES,
    )

    c.setFont(CAPTION_FONT, CAPTION_SIZE)

    for i, line in enumerate(lines):
        line_x = x + 4 + label_w if i == 0 else x + 4
        c.drawString(line_x, y - i * CAPTION_LEADING, line)


# ============================================================
# MAIN
# ============================================================

def build_photo_report_pdf(meta, items, out_path, progress_cb=None):

    def log(msg):
        if progress_cb:
            progress_cb(msg)

    groups = _group_items_by_lado(items)

    total_pages = 0
    for lado, group_items in groups:
        total_pages += max(1, (len(group_items) + ITEMS_PER_PAGE - 1) // ITEMS_PER_PAGE)

    if not groups:
        total_pages = 1

    c = canvas.Canvas(out_path, pagesize=letter)

    GRID_TOP = PAGE_H - HEADER_H - INFO_TABLE_H - 0.3 * cm
    GRID_BOTTOM = 1.0 * cm

    grid_h = GRID_TOP - GRID_BOTTOM
    grid_w = PAGE_W - 2 * MARGIN

    cell_w = grid_w / GRID_COLS
    cell_h = grid_h / GRID_ROWS

    caption_h = 1.3 * cm
    photo_h = cell_h - caption_h - 0.15 * cm

    current_page = 0

    if not groups:
        # Sin ítems: una página con la cabecera y la tabla de datos.
        _draw_header(c, {**meta, "titulo": meta.get("titulo", "REPORTE FOTOGRAFICO")})
        _draw_info_table(c, meta, PAGE_H - HEADER_H)
        _draw_footer(c, 1, 1)
        c.showPage()

    for lado, group_items in groups:

        group_title = _build_lado_title(lado)

        group_meta = {
            **meta,
            "titulo": group_title,
        }

        group_pages = max(1, (len(group_items) + ITEMS_PER_PAGE - 1) // ITEMS_PER_PAGE)

        for page_idx in range(group_pages):

            current_page += 1
            log(f"Página {current_page} de {total_pages}...")

            start = page_idx * ITEMS_PER_PAGE
            end = start + ITEMS_PER_PAGE
            page_items = group_items[start:end]

            c.setFillColorRGB(0, 0, 0)
            _draw_header(c, group_meta)
            _draw_info_table(c, group_meta, PAGE_H - HEADER_H)

            for idx in range(ITEMS_PER_PAGE):

                row = idx // GRID_COLS
                col = idx % GRID_COLS

                x = MARGIN + col * cell_w
                y_top = GRID_TOP - row * cell_h

                c.setStrokeColorRGB(0, 0, 0)
                c.rect(x, y_top - cell_h, cell_w, cell_h)

                if idx < len(page_items):

                    item = page_items[idx]
                    numero = start + idx + 1

                    _draw_photo(c, item, x, y_top, cell_w, photo_h)
                    _draw_caption(
                        c,
                        numero,
                        item.get("descripcion", ""),
                        x,
                        y_top,
                        cell_w,
                        photo_h,
                    )

            _draw_footer(c, current_page, total_pages)
            c.showPage()

    c.save()

    log(f"Listo: {out_path}")
    return out_path, total_pages
