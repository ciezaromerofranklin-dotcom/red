"""
pdf_core.py
Arma el PDF final:
  1. Configuración actual (current-config / running-config) pegada como TEXTO.
  2. Luego, una página por cada prueba ejecutada automáticamente por SSH,
     renderizada con estilo "captura de terminal" (fondo oscuro, texto
     monoespaciado) para que reemplace al pantallazo manual.
  3. (Opcional) fotos físicas adicionales (gabinete, LEDs, etc.) al final.

Cabecera en cada página: logo de la empresa en la esquina izquierda, logo
de Claro en la esquina derecha, datos del equipo debajo del logo izquierdo.
Pie de página: fecha centrada, número de página a la derecha.
"""

import os
import glob
import textwrap
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from app.services.logo_image import logo_reader
from reportlab.lib.colors import HexColor

PAGE_W, PAGE_H = letter
MARGIN = 1.5 * cm
HEADER_H = 2.9 * cm
FOOTER_H = 1.0 * cm
LOGO_SIZE = 1.6 * cm

TERM_BG = HexColor("#1e1e1e")
TERM_TEXT = HexColor("#d4d4d4")
TERM_PROMPT = HexColor("#59d858")


def draw_header_footer(c, page_num, total_pages, meta):
    top = PAGE_H
    c.setFillColorRGB(0, 0, 0)

    # Los logos pueden ser una ruta de archivo o bytes (guardados en la BD).
    logo_izq = logo_reader(meta.get("logo_izq"))
    logo_der = logo_reader(meta.get("logo_der"))

    if logo_izq is not None:
        try:
            c.drawImage(logo_izq, MARGIN, top - MARGIN - LOGO_SIZE,
                        width=LOGO_SIZE, height=LOGO_SIZE, preserveAspectRatio=True, mask="auto")
        except Exception:
            logo_izq = None

    if logo_der is not None:
        try:
            c.drawImage(logo_der, PAGE_W - MARGIN - LOGO_SIZE, top - MARGIN - LOGO_SIZE,
                        width=LOGO_SIZE, height=LOGO_SIZE, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass

    text_x = MARGIN + (LOGO_SIZE + 0.3 * cm if logo_izq is not None else 0)
    text_y = top - MARGIN - 0.35 * cm
    c.setFont("Helvetica-Bold", 9)
    c.drawString(text_x, text_y, "PROTOCOLO DE PRUEBAS Y VALIDACIONES - LAN")
    c.setFont("Helvetica", 8)
    c.drawString(text_x, text_y - 11, f"Equipo: {meta.get('device_id','')}   IP: {meta.get('ip','')}   Marca: {meta.get('vendor_label','')}")
    c.drawString(text_x, text_y - 22, f"Sede: {meta.get('sede','')}   Fecha: {meta.get('fecha','')}")

    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.line(MARGIN, top - HEADER_H, PAGE_W - MARGIN, top - HEADER_H)

    c.setFont("Helvetica", 8)
    c.setFillColorRGB(0, 0, 0)
    c.drawCentredString(PAGE_W / 2, FOOTER_H / 2, meta.get("fecha", ""))
    c.drawRightString(PAGE_W - MARGIN, FOOTER_H / 2, f"Página {page_num} de {total_pages}")
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.line(MARGIN, FOOTER_H, PAGE_W - MARGIN, FOOTER_H)


def paginate_text(text, chars_per_line, lines_per_page):
    raw_lines = text.splitlines() or [""]
    wrapped = []
    for line in raw_lines:
        if line.strip() == "":
            wrapped.append("")
            continue
        wrapped.extend(textwrap.wrap(line, width=chars_per_line,
                                      break_long_words=True, replace_whitespace=False) or [""])
    pages = []
    for i in range(0, len(wrapped), lines_per_page):
        pages.append(wrapped[i:i + lines_per_page])
    return pages or [[]]


def _content_geometry():
    content_top = PAGE_H - HEADER_H - 0.5 * cm
    content_bottom = FOOTER_H + 0.4 * cm
    content_h = content_top - content_bottom
    content_w = PAGE_W - 2 * MARGIN
    return content_top, content_bottom, content_h, content_w


def _draw_plain_text_pages(c, title, text, meta, page_num, total_pages):
    content_top, content_bottom, content_h, content_w = _content_geometry()
    font_size = 7.2
    char_w = font_size * 0.6
    chars_per_line = max(40, int(content_w / char_w))
    line_h = font_size + 2
    lines_per_page = max(10, int(content_h / line_h))
    pages = paginate_text(text, chars_per_line, lines_per_page)

    for idx, page_lines in enumerate(pages):
        page_num += 1
        if idx == 0:
            c.setFont("Helvetica-Bold", 11)
            c.drawString(MARGIN, content_top, title)
            y = content_top - 16
        else:
            y = content_top
        c.setFont("Courier", 7.2)
        c.setFillColorRGB(0, 0, 0)
        for line in page_lines:
            c.drawString(MARGIN, y, line)
            y -= 9.2
        draw_header_footer(c, page_num, total_pages, meta)
        c.showPage()
    return page_num


def _draw_terminal_pages(c, label, cmd, output_text, meta, page_num, total_pages):
    """Dibuja el resultado de un comando como si fuera una captura de terminal
    (fondo oscuro, texto monoespaciado), paginando si el texto es largo."""
    content_top, content_bottom, content_h, content_w = _content_geometry()

    caption_h = 16
    box_top = content_top - caption_h
    box_bottom = content_bottom
    box_h = box_top - box_bottom
    box_w = content_w

    font_size = 8
    pad = 0.35 * cm
    usable_w = box_w - 2 * pad
    usable_h = box_h - 2 * pad
    char_w = font_size * 0.6
    chars_per_line = max(40, int(usable_w / char_w))
    line_h = font_size + 3
    lines_per_page = max(10, int(usable_h / line_h))

    full_text = f"{meta.get('device_id','equipo')}# {cmd}\n{output_text}"
    pages = paginate_text(full_text, chars_per_line, lines_per_page)

    for idx, page_lines in enumerate(pages):
        page_num += 1
        title = label if idx == 0 else f"{label} (continuación)"
        c.setFont("Helvetica-Bold", 10)
        c.setFillColorRGB(0, 0, 0)
        c.drawString(MARGIN, content_top, title[:110])

        c.setFillColor(TERM_BG)
        c.roundRect(MARGIN, box_bottom, box_w, box_h, 4, fill=1, stroke=0)

        y = box_top - pad - font_size
        c.setFont("Courier", font_size)
        for i, line in enumerate(page_lines):
            if i == 0 and idx == 0:
                c.setFillColor(TERM_PROMPT)
            else:
                c.setFillColor(TERM_TEXT)
            c.drawString(MARGIN + pad, y, line)
            y -= line_h

        draw_header_footer(c, page_num, total_pages, meta)
        c.showPage()
    return page_num


def _count_text_pages(text):
    content_top, content_bottom, content_h, content_w = _content_geometry()
    font_size = 7.2
    char_w = font_size * 0.6
    chars_per_line = max(40, int(content_w / char_w))
    line_h = font_size + 2
    lines_per_page = max(10, int(content_h / line_h))
    return len(paginate_text(text, chars_per_line, lines_per_page))


def _count_terminal_pages(cmd, output_text, meta):
    content_top, content_bottom, content_h, content_w = _content_geometry()
    caption_h = 16
    box_h = (content_top - caption_h) - content_bottom
    pad = 0.35 * cm
    usable_w = content_w - 2 * pad
    usable_h = box_h - 2 * pad
    font_size = 8
    char_w = font_size * 0.6
    chars_per_line = max(40, int(usable_w / char_w))
    line_h = font_size + 3
    lines_per_page = max(10, int(usable_h / line_h))
    full_text = f"{meta.get('device_id','equipo')}# {cmd}\n{output_text}"
    return len(paginate_text(full_text, chars_per_line, lines_per_page))


def build_pdf(meta, config_text, test_results, extra_photos_dir=None, out_path="Protocolo_Pruebas.pdf",
              progress_cb=None):
    """
    meta: dict con device_id, ip, vendor_label, sede, fecha, logo_izq, logo_der
    config_text: str -> salida del comando de configuración actual
    test_results: list[(key, label, cmd, output_text)]
    extra_photos_dir: carpeta opcional con fotos físicas (jpg/png) a agregar al final
    """
    def log(msg):
        if progress_cb:
            progress_cb(msg)

    # --- Calcular total de páginas primero (para "Página X de Y") ---
    total_pages = 0
    if config_text:
        total_pages += _count_text_pages(config_text)
    for key, label, cmd, output_text in test_results:
        total_pages += _count_terminal_pages(cmd, output_text, meta)

    extra_images = []
    if extra_photos_dir and os.path.isdir(extra_photos_dir):
        for ext in ("*.jpg", "*.jpeg", "*.png"):
            extra_images.extend(glob.glob(os.path.join(extra_photos_dir, ext)))
        extra_images.sort()
    total_pages += len(extra_images)

    if total_pages == 0:
        raise ValueError("No hay contenido para generar el PDF (sin configuración, pruebas ni fotos).")

    c = canvas.Canvas(out_path, pagesize=letter)
    page_num = 0

    if config_text:
        log("Agregando configuración actual al PDF...")
        page_num = _draw_plain_text_pages(
            c, "Configuración actual del equipo", config_text, meta, page_num, total_pages)

    for key, label, cmd, output_text in test_results:
        log(f"Agregando prueba al PDF: {label}...")
        page_num = _draw_terminal_pages(c, label, cmd, output_text, meta, page_num, total_pages)

    for img_path in extra_images:
        page_num += 1
        log(f"Agregando foto adicional: {os.path.basename(img_path)}...")
        content_top, content_bottom, content_h, content_w = _content_geometry()
        base = os.path.splitext(img_path)[0]
        caption_path = base + ".txt"
        if os.path.isfile(caption_path):
            with open(caption_path, "r", errors="ignore") as f:
                caption = f.read().strip()
        else:
            caption = os.path.basename(base)
        c.setFont("Helvetica-Bold", 10)
        c.setFillColorRGB(0, 0, 0)
        c.drawString(MARGIN, content_top, caption[:110])
        img_top = content_top - 16
        img_area_h = img_top - content_bottom
        try:
            img = ImageReader(img_path)
            iw, ih = img.getSize()
            scale = min(content_w / iw, img_area_h / ih)
            draw_w, draw_h = iw * scale, ih * scale
            x = MARGIN + (content_w - draw_w) / 2
            y = content_bottom + (img_area_h - draw_h) / 2
            c.drawImage(img, x, y, width=draw_w, height=draw_h, preserveAspectRatio=True, mask="auto")
        except Exception as e:
            c.setFont("Helvetica", 9)
            c.drawString(MARGIN, img_top - 20, f"[No se pudo insertar la imagen: {e}]")
        draw_header_footer(c, page_num, total_pages, meta)
        c.showPage()

    c.save()
    log(f"Listo: {out_path} ({total_pages} páginas)")
    return out_path, total_pages
