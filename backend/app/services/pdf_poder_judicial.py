"""
pdf_poder_judicial.py

Informe de diseño «LAN Gestionada SOLAMED – Poder Judicial» (A4), con el mismo
diseño del modelo de Claro:

  1. Portada      : logo, recuadro redondeado con sombra, textos y versión.
  2. Control de cambios + nombre de la sede.
  3. Índice       : con los números de página reales.
  4. Informe de diseño: tablas con borde (ubicación del data center y bloques
     de fotos en dos columnas: texto arriba, foto(s) abajo).
  5. Conclusiones : lista con numeración romana.
"""

import logging
import os
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

from app.services.logo_image import logo_reader
from app.services.pdf_photo_report import prepare_photo

logger = logging.getLogger(__name__)

PAGE_W, PAGE_H = A4

# ------------------------------------------------------------
# Medidas tomadas del modelo (A4)
# ------------------------------------------------------------
TOP = 72
BOTTOM = 60
BODY_L = 85.0
BODY_W = PAGE_W - 2 * BODY_L          # ~425 pt  (tablas de fotos)
META_L = 85.5
META_W = 453.0                         # tablas de "Control de cambios"

HEADER_PAD = 6                         # relleno de las filas de título
PHOTO_ROW_H = 270                      # alto de la fila de fotos
LOCATION_PHOTO_H = 245                 # alto de la foto de ubicación

CONCLUSION_TEXT_INDENT = 37.4          # sangría del texto de cada conclusión
CONCLUSION_NUM_RIGHT = 20.6            # donde termina el número romano

# ------------------------------------------------------------
# Fuentes: Calibri del modelo -> Carlito (misma métrica, incluida en el repo)
# ------------------------------------------------------------
FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
COVER_FONT = "Helvetica"
COVER_BOLD = "Helvetica-Bold"


def _register_fonts() -> None:
    global COVER_FONT, COVER_BOLD
    try:
        pdfmetrics.registerFont(TTFont("Carlito", str(FONT_DIR / "Carlito-Regular.ttf")))
        pdfmetrics.registerFont(TTFont("Carlito-Bold", str(FONT_DIR / "Carlito-Bold.ttf")))
        registerFontFamily("Carlito", normal="Carlito", bold="Carlito-Bold")
        COVER_FONT, COVER_BOLD = "Carlito", "Carlito-Bold"
    except Exception as exc:  # sin la fuente se usa Helvetica y el informe sigue saliendo
        logger.warning("No se pudo cargar Carlito (%s); se usa Helvetica.", exc)


_register_fonts()


# ============================================================
# TEXTO
# ============================================================

def _text(value) -> str:
    """Texto del usuario -> marcado seguro para Paragraph (con saltos de línea)."""
    return escape(str(value or "")).replace("\r\n", "\n").replace("\n", "<br/>")


def roman(n: int) -> str:
    out = ""
    for value, sym in (
        (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
        (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
    ):
        while n >= value:
            out += sym
            n -= value
    return out


def _styles() -> dict:
    base = dict(fontName="Times-Roman", fontSize=11.5, leading=14, textColor=colors.black)

    def st(name, **kw):
        return ParagraphStyle(name, **{**base, **kw})

    return {
        "cell_head": st("cell_head", fontName="Times-Bold", fontSize=12, leading=14, alignment=TA_CENTER),
        "caption": st("caption", alignment=TA_LEFT),
        "meta_title": st("meta_title", fontName="Times-Bold", alignment=TA_CENTER, spaceAfter=12),
        "meta_cell": st("meta_cell", fontSize=10.5, leading=12, alignment=TA_CENTER),
        "meta_sede_label": st("meta_sede_label", fontSize=14, leading=16, alignment=TA_LEFT),
        "meta_sede_value": st("meta_sede_value", fontSize=10.5, leading=12, alignment=TA_LEFT),
        "toc_title": st("toc_title", fontName="Times-Bold", alignment=TA_CENTER, spaceAfter=22),
        "toc1": st("toc1", fontName="Times-Bold", fontSize=11, leading=22),
        "h1": st("H1", fontName="Times-Bold", fontSize=12, leading=15, leftIndent=20, spaceAfter=12),
        "h1_conc": st("H1", fontName="Times-Bold", fontSize=12, leading=15, leftIndent=35, spaceAfter=10),
        "intro": st("intro", alignment=TA_JUSTIFY, leading=16, leftIndent=17.6, spaceAfter=10),
    }


# ============================================================
# FOTOS DENTRO DE UNA CELDA
# ============================================================

class ImageStack(Flowable):
    """
    Una o varias fotos apiladas (de arriba hacia abajo) dentro de una celda,
    cada una ajustada al espacio y con un marco fino, como en el modelo.
    items: lista de ImageReader o None (foto que no se encontró).
    """

    def __init__(self, items, width, height, pad=10, gap=6):
        super().__init__()
        self.items = items
        self.width = width
        self.height = height
        self.pad = pad
        self.gap = gap

    def wrap(self, avail_w, avail_h):
        return self.width, self.height

    def _placeholder(self, x, y, w, h, text, color):
        c = self.canv
        c.setFillColorRGB(*color)
        c.setFont("Helvetica-Oblique", 9)
        c.drawCentredString(x + w / 2, y + h / 2, text)
        c.setFillColorRGB(0, 0, 0)

    def draw(self):
        c = self.canv
        n = len(self.items)
        avail_w = self.width - 2 * self.pad
        inner_h = self.height - 2 * self.pad
        slot_h = (inner_h - self.gap * (n - 1)) / max(n, 1)

        if n == 0:
            self._placeholder(0, 0, self.width, self.height, "SIN FOTO", (0.6, 0.6, 0.6))
            return

        y_top = self.height - self.pad
        for item in self.items:
            slot_y = y_top - slot_h
            if item is None:
                self._placeholder(self.pad, slot_y, avail_w, slot_h,
                                  "IMAGEN NO DISPONIBLE", (0.75, 0.1, 0.1))
            else:
                iw, ih = item.getSize()
                scale = min(avail_w / iw, slot_h / ih)
                w, h = iw * scale, ih * scale
                x = (self.width - w) / 2
                y = slot_y + (slot_h - h) / 2
                c.drawImage(item, x, y, width=w, height=h)
                c.setStrokeColor(colors.black)
                c.setLineWidth(0.75)
                c.rect(x, y, w, h)
            y_top = slot_y - self.gap


def _images(paths, warnings):
    """Rutas -> ImageReader (None si el archivo no se puede abrir)."""
    items = []
    for path in paths or []:
        if not path:
            continue
        reader = prepare_photo(path)
        if reader is None:
            warnings.append(f"No se pudo abrir una de las fotos ({os.path.basename(path)}).")
        items.append(reader)
    return items


# ============================================================
# TABLAS
# ============================================================

GRID = ("GRID", (0, 0), (-1, -1), 0.75, colors.black)


def _location_table(data, S, warnings):
    ubic = _images([data.get("foto_ubicacion")], warnings)

    direccion = (
        f'Dirección: <font size="9">{_text(data.get("direccion"))}</font><br/>'
        f'Coordenadas: {_text(data.get("coordenadas"))}'
    )

    rows = [
        [Paragraph(f"<b>{_text(data.get('ubicacion_titulo'))}</b>", S["cell_head"]), ""],
        [Paragraph(direccion, S["caption"]), ""],
        [ImageStack(ubic, BODY_W, LOCATION_PHOTO_H), ""],
    ]

    t = Table(rows, colWidths=[BODY_W / 2, BODY_W / 2], rowHeights=[None, None, LOCATION_PHOTO_H])
    t.setStyle(TableStyle([
        GRID,
        ("SPAN", (0, 0), (1, 0)),
        ("SPAN", (0, 1), (1, 1)),
        ("SPAN", (0, 2), (1, 2)),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, 0), HEADER_PAD),
        ("BOTTOMPADDING", (0, 0), (-1, 0), HEADER_PAD),
        ("LEFTPADDING", (0, 1), (-1, 1), 5),
        ("TOPPADDING", (0, 1), (-1, 1), 4),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 6),
        ("LEFTPADDING", (0, 2), (-1, 2), 0),
        ("RIGHTPADDING", (0, 2), (-1, 2), 0),
        ("TOPPADDING", (0, 2), (-1, 2), 0),
        ("BOTTOMPADDING", (0, 2), (-1, 2), 0),
    ]))
    t.spaceBefore = 0
    t.spaceAfter = 0
    return t


def _section_table(section, S, warnings):
    """Encabezado centrado + celdas en 2 columnas (texto arriba, fotos abajo)."""
    col_w = BODY_W / 2
    cells = list(section.get("cells") or [])

    rows = [[Paragraph(f"<b>{_text(section.get('title'))}</b>", S["cell_head"]), ""]]
    row_heights = [None]
    style = [
        GRID,
        ("SPAN", (0, 0), (1, 0)),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, 0), HEADER_PAD),
        ("BOTTOMPADDING", (0, 0), (-1, 0), HEADER_PAD),
    ]

    for i in range(0, len(cells), 2):
        pair = cells[i:i + 2]
        caption_row, photo_row = [], []

        for cell in pair:
            caption_row.append(Paragraph(_text(cell.get("caption")), S["caption"]))
            photo_row.append(ImageStack(_images(cell.get("images"), warnings), col_w, PHOTO_ROW_H))

        while len(caption_row) < 2:          # celda vacía si la cantidad es impar
            caption_row.append("")
            photo_row.append("")

        r = len(rows)
        rows.append(caption_row)
        rows.append(photo_row)
        row_heights += [None, PHOTO_ROW_H]

        style += [
            ("LEFTPADDING", (0, r), (-1, r), 5),
            ("RIGHTPADDING", (0, r), (-1, r), 5),
            ("TOPPADDING", (0, r), (-1, r), 4),
            ("BOTTOMPADDING", (0, r), (-1, r), 8),
            ("LEFTPADDING", (0, r + 1), (-1, r + 1), 0),
            ("RIGHTPADDING", (0, r + 1), (-1, r + 1), 0),
            ("TOPPADDING", (0, r + 1), (-1, r + 1), 0),
            ("BOTTOMPADDING", (0, r + 1), (-1, r + 1), 0),
            # el texto y su foto nunca se separan en páginas distintas
            ("NOSPLIT", (0, r), (-1, r + 1)),
        ]

    t = Table(rows, colWidths=[col_w, col_w], rowHeights=row_heights, repeatRows=1)
    t.setStyle(TableStyle(style))
    t.spaceBefore = 0
    t.spaceAfter = 0
    return t


# ============================================================
# PORTADA (se dibuja directamente en el canvas)
# ============================================================

def _fit_size(text, font, size, max_w, min_size=10):
    while size > min_size and pdfmetrics.stringWidth(text, font, size) > max_w:
        size -= 0.5
    return size


def _shadow_text(c, x, y, text, font, size, offset=0.9):
    """Texto centrado con la sombra suave del modelo."""
    c.setFont(font, size)
    c.setFillColorRGB(0.55, 0.55, 0.55)
    c.drawCentredString(x + offset, y - offset, text)
    c.setFillColorRGB(0, 0, 0)
    c.drawCentredString(x, y, text)


def _draw_cover(c, data):
    c.saveState()

    # Logo (arriba a la izquierda)
    logo = logo_reader(data.get("logo"))
    if logo is not None:
        try:
            iw, ih = logo.getSize()
            scale = min(63 / ih, 170 / iw)
            w, h = iw * scale, ih * scale
            c.drawImage(logo, 85.5, PAGE_H - 69 - h, width=w, height=h, mask="auto")
        except Exception as exc:
            logger.warning("No se pudo dibujar el logo de la portada: %s", exc)

    # Recuadro redondeado con sombra
    box_x, box_w = 108, 412
    box_top, box_h = PAGE_H - 180, 196
    box_y = box_top - box_h
    radius = 34

    c.setFillColorRGB(0, 0, 0)
    c.roundRect(box_x + 3.5, box_y - 3.5, box_w, box_h, radius, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(1.2)
    c.roundRect(box_x, box_y, box_w, box_h, radius, stroke=1, fill=1)

    # Líneas del título (una línea vacía deja un espacio, como en el modelo)
    lines = list(data.get("portada_lineas") or [])
    cx = box_x + box_w / 2
    y = box_top - 42
    for line in lines:
        if str(line).strip():
            size = _fit_size(line, COVER_FONT, 22, box_w - 36)
            _shadow_text(c, cx, y, str(line), COVER_FONT, size)
        y -= 29

    # Dirección / gerencia
    y = PAGE_H - 444
    for line in data.get("subtitulo_lineas") or []:
        if str(line).strip():
            size = _fit_size(line, COVER_FONT, 14.5, PAGE_W - 2 * 85)
            c.setFont(COVER_FONT, size)
            c.setFillColorRGB(0, 0, 0)
            c.drawCentredString(PAGE_W / 2, y, str(line))
        y -= 19

    # Versión y fecha
    y = PAGE_H - 626
    for line in (f"Versión {data.get('version', '')}".strip(), str(data.get("periodo", "")).upper()):
        if line:
            _shadow_text(c, PAGE_W / 2, y, line, COVER_BOLD, 11, offset=0.6)
        y -= 17

    c.restoreState()


# ============================================================
# DOCUMENTO
# ============================================================

class _Doc(BaseDocTemplate):
    """Registra los títulos de capítulo para armar el índice con páginas reales."""

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == "H1":
            # La clave debe ser igual en cada pasada, o el índice nunca converge.
            key = "cap%d" % (abs(hash(flowable.getPlainText())) % 10**8)
            text = flowable.getPlainText().replace("\xa0", " ")
            self.canv.bookmarkPage(key)
            self.notify("TOCEntry", (0, text, self.page, key))


def _frame(x, width, fid):
    return Frame(x, BOTTOM, width, PAGE_H - TOP - BOTTOM, id=fid,
                 leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)


def _control_cambios(data, S):
    rows = [[Paragraph(h, S["meta_cell"]) for h in ("Versión", "Fecha", "Modificación")]]
    for ch in data.get("cambios") or []:
        rows.append([Paragraph(_text(ch.get(k)), S["meta_cell"]) for k in ("version", "fecha", "modificacion")])

    third = META_W / 3
    t1 = Table(rows, colWidths=[third] * 3)
    t1.setStyle(TableStyle([GRID, ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    t1.hAlign = "LEFT"

    t2 = Table(
        [[Paragraph("NOMBRE DE SEDE", S["meta_sede_label"]), Paragraph(_text(data.get("sede")), S["meta_sede_value"])]],
        colWidths=[162, META_W - 162],
    )
    t2.setStyle(TableStyle([GRID, ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 4),
                            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    t2.hAlign = "LEFT"

    return [Paragraph("Control de cambios", S["meta_title"]), t1, Spacer(1, 36), t2]


def _conclusiones(data, S):
    out = [
        Paragraph("2.\xa0\xa0\xa0Conclusiones:", S["h1_conc"]),
    ]
    intro = (data.get("conclusiones_intro") or "").strip()
    if intro:
        out.append(Paragraph(_text(intro), S["intro"]))

    for i, item in enumerate(data.get("conclusiones") or [], start=1):
        item = str(item or "").strip()
        if not item:
            continue
        num = f"{roman(i)}."
        num_w = pdfmetrics.stringWidth(num, "Times-Roman", 11.5)
        style = ParagraphStyle(
            f"conc{i}", parent=S["intro"],
            leftIndent=CONCLUSION_TEXT_INDENT, bulletIndent=CONCLUSION_NUM_RIGHT - num_w,
            bulletFontName="Times-Roman", bulletFontSize=11.5, spaceAfter=9,
        )
        out.append(Paragraph(_text(item), style, bulletText=num))
    return out


def build_pj_report_pdf(data: dict, out_path: str):
    """
    Genera el informe y devuelve (ruta, total_de_páginas, avisos).
    `data` trae textos y rutas de fotos (ver schemas.PJReportRequest).
    """
    S = _styles()
    warnings: list = []

    doc = _Doc(
        out_path, pagesize=A4,
        title=f"Informe de diseño {data.get('sede', '')}".strip(),
        author="NetOps Suite",
    )
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[_frame(BODY_L, BODY_W, "cover")],
                     onPage=lambda c, d: _draw_cover(c, data)),
        PageTemplate(id="meta", frames=[_frame(META_L, META_W, "meta")]),
        PageTemplate(id="body", frames=[_frame(BODY_L, BODY_W, "body")]),
    ])

    toc = TableOfContents()
    toc.levelStyles = [S["toc1"]]
    toc.dotsMinLevel = 0
    toc.rightColumnWidth = 24

    story = [Spacer(1, 1), NextPageTemplate("meta"), PageBreak()]
    story += _control_cambios(data, S)

    story += [
        NextPageTemplate("body"), PageBreak(),
        Spacer(1, 66), Paragraph("ÍNDICE", S["toc_title"]), toc,
        PageBreak(),
        Paragraph("1.\xa0\xa0\xa0Informe de Diseño", S["h1"]),
        _location_table(data, S, warnings),
    ]
    for section in data.get("sections") or []:
        story.append(_section_table(section, S, warnings))

    story += [PageBreak()] + _conclusiones(data, S)

    doc.multiBuild(story)

    return out_path, doc.page, warnings
