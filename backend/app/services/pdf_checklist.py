"""
pdf_checklist.py
Genera el PDF con el mismo estilo visual del documento de ejemplo
"CheckList de Claro": título + datos de servicio (SOT/CID) arriba a la
izquierda, logo arriba a la derecha, secciones con nombre en negrita
subrayada, cada item con su título (negrita subrayada) seguido de la
captura (estilo terminal si fue automática, o la imagen subida si fue
manual), pie de página con la fecha y el número de página.
"""

import os
import textwrap
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from app.services.logo_image import logo_reader
from reportlab.lib.colors import HexColor

PAGE_W, PAGE_H = letter
MARGIN = 1.5 * cm
HEADER_H = 3.1 * cm
FOOTER_H = 1.0 * cm
LOGO_SIZE = 1.7 * cm

TITLE_COLOR = HexColor("#2F5496")
TERM_BG = HexColor("#1e1e1e")
TERM_TEXT = HexColor("#d4d4d4")
TERM_PROMPT = HexColor("#59d858")


def _content_geometry():
    top = PAGE_H - HEADER_H - 0.5 * cm
    bottom = FOOTER_H + 0.4 * cm
    return top, bottom, top - bottom, PAGE_W - 2 * MARGIN


def _draw_header_footer(c, page_num, total_pages, meta):
    top = PAGE_H
    c.setFillColorRGB(0, 0, 0)

    # El logo puede ser una ruta de archivo o bytes (guardado en la BD).
    logo = logo_reader(meta.get("logo"))
    if logo is not None:
        try:
            c.drawImage(logo, PAGE_W - MARGIN - LOGO_SIZE, top - MARGIN - LOGO_SIZE,
                        width=LOGO_SIZE, height=LOGO_SIZE, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass

    x = MARGIN
    y = top - MARGIN - 0.35 * cm
    c.setFillColor(TITLE_COLOR)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(x, y, meta.get("titulo", "CheckList de Claro"))
    c.setFont("Helvetica", 9)
    # Subtítulo libre (ej. "Servicio Internet Corporativo 50Mbps- CPE Huawei AR611");
    # si no se escribió, se usa el formato anterior "Servicio: <perfil>".
    subtitulo = (meta.get("subtitulo") or "").strip() or f"Servicio: {meta.get('servicio_label','')}"
    c.drawString(x, y - 15, subtitulo[:110])
    c.drawString(x, y - 28, f"SOT: {meta.get('sot','')}    CID: {meta.get('cid','')}")

    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.line(MARGIN, top - HEADER_H, PAGE_W - MARGIN, top - HEADER_H)

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 10)
    # Pie de página: texto propio o, si va vacío, la fecha.
    c.drawCentredString(PAGE_W / 2, FOOTER_H / 2, (meta.get("pie") or meta.get("fecha", ""))[:90])
    c.setFillColor(TITLE_COLOR)
    c.roundRect(PAGE_W - MARGIN - 1.1 * cm, FOOTER_H / 2 - 8, 1.1 * cm, 18, 3, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(PAGE_W - MARGIN - 0.55 * cm, FOOTER_H / 2 - 3, str(page_num))
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.line(MARGIN, FOOTER_H, PAGE_W - MARGIN, FOOTER_H)


def _paginate_text(text, chars_per_line, lines_per_page):
    raw_lines = text.splitlines() or [""]
    wrapped = []
    for line in raw_lines:
        if line.strip() == "":
            wrapped.append("")
            continue
        wrapped.extend(textwrap.wrap(line, width=chars_per_line, break_long_words=True,
                                      replace_whitespace=False) or [""])
    pages = []
    for i in range(0, len(wrapped), lines_per_page):
        pages.append(wrapped[i:i + lines_per_page])
    return pages or [[]]


def _terminal_block_height_lines(box_h):
    pad = 0.3 * cm
    usable_h = box_h - 2 * pad
    font_size = 7.5
    line_h = font_size + 3
    return max(6, int(usable_h / line_h))


def _measure_item_pages(item, content_w, avail_h):
    """Cuenta cuántas 'unidades de página' ocupa un item, de forma aproximada,
    para decidir cuándo saltar de página (evita renderizar dos veces)."""
    return 1  # cada item auto-termina su bloque en la página actual o salta


def build_checklist_pdf(meta, sections, out_path, progress_cb=None):
    """
    meta: dict con titulo, servicio_label, sot, cid, fecha, logo
    sections: lista de (nombre_seccion, [items]) en orden; cada item:
        {"nombre": str, "modo": "auto"/"manual",
         "cmd": str (auto), "output": str (auto),
         "images": [path, ...] (manual)}
    """
    def log(msg):
        if progress_cb:
            progress_cb(msg)

    # Primero contamos páginas totales haciendo un "dry run" simplificado:
    # para simplicidad y precisión, generamos directo y llevamos la cuenta,
    # luego re-generamos con el total ya conocido (dos pasadas).
    def render(c, count_only, total_pages=1):
        page_num = 1
        content_top, content_bottom, content_h, content_w = _content_geometry()
        y = content_top

        def new_page():
            nonlocal page_num, y
            if not count_only:
                _draw_header_footer(c, page_num, total_pages, meta)
                c.showPage()
            page_num += 1
            y = content_top

        for sec_name, items in sections:
            if y < content_top:
                pass
            if y <= content_bottom + 1.5 * cm:
                new_page()
            if not count_only:
                c.setFont("Helvetica-Bold", 11)
                c.setFillColor(TITLE_COLOR)
                c.drawString(MARGIN, y, sec_name)
            y -= 18

            for item in items:
                if y <= content_bottom + 1.2 * cm:
                    new_page()
                if not count_only:
                    c.setFont("Helvetica-Bold", 9.5)
                    c.setFillColorRGB(0, 0, 0)
                    c.drawString(MARGIN, y, item["nombre"])
                y -= 14

                if item.get("modo") == "manual":
                    images = item.get("images") or []
                    if not images:
                        y -= 10
                        continue
                    for img_path in images:
                        try:
                            img = ImageReader(img_path)
                            iw, ih = img.getSize()
                        except Exception:
                            continue
                        max_w = content_w * 0.85
                        max_h = 6.5 * cm
                        scale = min(max_w / iw, max_h / ih)
                        draw_w, draw_h = iw * scale, ih * scale
                        if y - draw_h < content_bottom:
                            new_page()
                        if not count_only:
                            c.drawImage(img, MARGIN, y - draw_h, width=draw_w, height=draw_h,
                                        preserveAspectRatio=True, mask="auto")
                        y -= draw_h + 12
                else:
                    output_text = item.get("output", "")
                    cmd = item.get("cmd", "")
                    full_text = f"{meta.get('device_id','equipo')}# {cmd}\n{output_text}" if cmd else output_text
                    box_h = min(6.5 * cm, content_top - content_bottom)
                    lines_per_page = _terminal_block_height_lines(box_h)
                    font_size = 7.5
                    char_w = font_size * 0.6
                    chars_per_line = max(40, int((content_w * 0.9) / char_w))
                    pages = _paginate_text(full_text, chars_per_line, lines_per_page)
                    for page_lines in pages:
                        this_h = min(box_h, 0.3 * cm * 2 + len(page_lines) * (font_size + 3))
                        if y - this_h < content_bottom:
                            new_page()
                        if not count_only:
                            box_w = content_w * 0.9
                            c.setFillColor(TERM_BG)
                            c.roundRect(MARGIN, y - this_h, box_w, this_h, 3, fill=1, stroke=0)
                            ty = y - 0.3 * cm - font_size
                            c.setFont("Courier", font_size)
                            for i, line in enumerate(page_lines):
                                c.setFillColor(TERM_PROMPT if i == 0 else TERM_TEXT)
                                c.drawString(MARGIN + 0.25 * cm, ty, line)
                                ty -= font_size + 3
                        y -= this_h + 12
                y -= 6

        if not count_only:
            _draw_header_footer(c, page_num, total_pages, meta)
            c.showPage()
        return page_num

    # Pasada 1: contar páginas (sin dibujar)
    dummy = canvas.Canvas(out_path)
    total_pages = render(dummy, count_only=True)

    # Pasada 2: dibujar de verdad con el total correcto
    log(f"Generando CheckList ({total_pages} páginas)...")
    c = canvas.Canvas(out_path, pagesize=letter)
    render(c, count_only=False, total_pages=total_pages)
    c.save()
    log(f"Listo: {out_path} ({total_pages} páginas)")
    return out_path, total_pages
