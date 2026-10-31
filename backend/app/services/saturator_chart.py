"""
saturator_chart.py
Imagen de evidencia de una prueba de saturación (gráfica Mbps vs tiempo + resumen),
lista para pegar en el checklist (ítem manual "CAP DEL SUP") o en el reporte.
"""

from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

BG, FG, GRID, MUTED = (255, 255, 255), (30, 41, 59), (226, 232, 240), (100, 116, 139)
C_UP, C_DOWN, C_TARGET = (22, 163, 74), (37, 99, 235), (220, 38, 38)


def _font(size, bold=False):
    try:
        return ImageFont.truetype(str(FONT_DIR / ("Carlito-Bold.ttf" if bold else "Carlito-Regular.ttf")), size)
    except OSError:
        return ImageFont.load_default()


def _nice_max(v):
    for step in (10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000):
        if v <= step:
            return step
    return v


def render_saturation_png(result: dict, out_path: str, titulo: str = ""):
    W, H = 1280, 780
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    f_title, f_b, f_s = _font(30, True), _font(20, True), _font(18)

    mode = "UDP con agente" if result.get("mode") == "udp" else "Eco ICMP"
    d.text((40, 24), titulo or "Prueba de saturación", fill=FG, font=f_title)
    kind = {"cabecera": "IP de cabecera", "dg": "DG", "siguiente_salto": "Siguiente salto"}.get(result.get("target_kind"), "Destino")
    sub = (f"{mode}  |  {kind}: {result.get('target')}  |  origen {result.get('source_ip') or '-'}  |  "
           f"paquete {result.get('size')}B x {result.get('streams')} flujo(s)  |  {result.get('duration')}s  |  "
           f"{datetime.now().strftime('%d/%m/%Y %H:%M')}")
    d.text((40, 66), sub, fill=MUTED, font=f_s)

    # --- gráfica ---
    gx0, gy0, gx1, gy1 = 110, 120, W - 40, 470
    series = result.get("series", {})
    t = series.get("t", [])
    up_rx, dn_rx, up_tx = series.get("up_rx", []), series.get("down_rx", []), series.get("up_tx", [])
    up, dn = result.get("up"), result.get("down")
    targets = [x["target_mbps"] for x in (up, dn) if x]
    peak = max([max(up_rx or [0]), max(dn_rx or [0]), max(up_tx or [0])] + targets + [1])
    ymax = _nice_max(peak * 1.1)

    for i in range(6):
        y = gy1 - (gy1 - gy0) * i / 5
        d.line([(gx0, y), (gx1, y)], fill=GRID, width=1)
        label = f"{ymax * i / 5:g}"
        d.text((gx0 - 10 - d.textlength(label, font=f_s), y - 10), label, fill=MUTED, font=f_s)
    d.text((24, gy0 - 8), "Mbps", fill=MUTED, font=f_s)
    n = max(len(t), 2)

    def px(i, v):
        return (gx0 + (gx1 - gx0) * i / (n - 1), gy1 - (gy1 - gy0) * min(v, ymax) / ymax)

    for i in range(0, n, max(1, n // 10)):
        x = px(i, 0)[0]
        d.text((x - 8, gy1 + 6), str(t[i] if i < len(t) else i + 1), fill=MUTED, font=f_s)
    d.text((gx1 - 90, gy1 + 28), "segundos", fill=MUTED, font=f_s)

    for tgt in sorted(set(targets)):  # línea del caudal pedido
        y = px(0, tgt)[1]
        for x in range(gx0, gx1, 14):
            d.line([(x, y), (x + 7, y)], fill=C_TARGET, width=2)

    def line(vals, color):
        pts = [px(i, v) for i, v in enumerate(vals)]
        if len(pts) > 1:
            d.line(pts, fill=color, width=4)

    if result.get("mode") == "icmp":
        line(dn_rx, C_DOWN)
    else:
        if up:
            line(up_rx, C_UP)
        if dn:
            line(dn_rx, C_DOWN)
    d.rectangle([gx0, gy0, gx1, gy1], outline=GRID)

    ly = gy1 + 58
    items = []
    if result.get("mode") == "icmp":
        items.append((C_DOWN, "Eco recibido (ida+vuelta)"))
    else:
        if up:
            items.append((C_UP, "Subida (lo que llegó al agente)"))
        if dn:
            items.append((C_DOWN, "Bajada (lo que recibió este PC)"))
    items.append((C_TARGET, "Caudal pedido"))
    x = gx0
    for color, text in items:
        d.rectangle([x, ly + 4, x + 26, ly + 14], fill=color)
        d.text((x + 34, ly - 2), text, fill=FG, font=f_s)
        x += 60 + d.textlength(text, font=f_s)

    # --- resumen ---
    y = 560
    cols = []
    if up:
        cols.append(("SUBIDA" if result.get("mode") == "udp" else "IDA", up))
    if dn and result.get("mode") == "udp":
        cols.append(("BAJADA", dn))
    if result.get("mode") == "icmp" and up:
        cols = [("IDA + VUELTA", up)]
    cw = (W - 80) // max(1, len(cols) + (1 if result.get("rtt") else 0))
    cx = 40
    for name, s in cols:
        d.rounded_rectangle([cx, y, cx + cw - 16, y + 150], radius=12, outline=GRID, width=2)
        d.text((cx + 18, y + 10), name, fill=MUTED, font=f_b)
        d.text((cx + 18, y + 38), f"{s['rx_avg']:g} Mbps", fill=FG, font=_font(44, True))
        loss = "n/d" if s.get("loss_pct") is None else f"{s['loss_pct']:g}%"
        d.text((cx + 18, y + 98),
               f"de {s['target_mbps']:g} pedidos ({s['pct_target']:g}%)  |  pérdida {loss}  |  mín {s['rx_min']:g} / máx {s['rx_max']:g}",
               fill=FG, font=f_s)
        cx += cw
    rtt = result.get("rtt")
    if rtt:
        d.rounded_rectangle([cx, y, cx + cw - 16, y + 150], radius=12, outline=GRID, width=2)
        d.text((cx + 18, y + 10), "LATENCIA (ms)", fill=MUTED, font=f_b)
        d.text((cx + 18, y + 38), f"{rtt['avg']:g} ms", fill=FG, font=_font(44, True))
        d.text((cx + 18, y + 98), f"mín {rtt['min']:g} / máx {rtt['max']:g}  |  jitter {rtt['jitter']:g}", fill=FG, font=f_s)

    ny = 730
    for note in result.get("notes", [])[:2]:
        d.text((40, ny), "• " + (note[:150] + "…" if len(note) > 150 else note), fill=C_TARGET, font=f_s)
        ny += 22
        if ny > H - 22:
            break
    img.save(out_path, "PNG")
    return out_path
