"""
Genera el logotipo HANGAR 421 en PNG (dos variantes: oscura para fondos claros,
clara para fondos oscuros) a partir de la referencia fotográfica del letrero
(letra "H" con la barra central reemplazada por un hexágono tipo tuerca/perno,
y "421" como superíndice junto a la "R"). No depende de herramientas externas
de vectorizado: se dibuja programáticamente con Pillow para tener un asset
limpio y escalable, en vez de recortar la foto del letrero (que tiene brillos,
sombras y el muro de fondo).

Uso: python3 generate_logo.py
"""
from PIL import Image, ImageDraw, ImageFont
import math

FONT_PATH = "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"
NAVY = (11, 30, 51, 255)      # #0B1E33
WHITE = (255, 255, 255, 255)
AMBER = (232, 163, 61, 255)   # #E8A33D

W, H = 2000, 700
PAD_X = 60
FONT_SIZE = 480
SUFFIX_FONT_SIZE = 190


def hexagon(cx, cy, r):
    return [
        (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
        for a in range(0, 360, 60)
    ]


def build(word_color, hex_color, out_path):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    suffix_font = ImageFont.truetype(FONT_PATH, SUFFIX_FONT_SIZE)

    baseline_y = 120  # y donde empieza a dibujarse el texto (top-anchored)

    # bbox de una "H" sola con esta fuente/tamaño, para saber su ancho y su
    # "cap height" real (el bold de DIN Condensed no llega al full em-box).
    h_bbox = draw.textbbox((0, 0), "H", font=font)
    h_w = h_bbox[2] - h_bbox[0]
    cap_top = h_bbox[1]
    cap_bottom = h_bbox[3]
    cap_height = cap_bottom - cap_top

    # 1) dibuja la palabra completa "HANGAR"
    draw.text((PAD_X, baseline_y), "HANGAR", font=font, fill=word_color)

    # 2) borra la barra central de la "H" (franja horizontal dentro de su ancho)
    strip_h = cap_height * 0.20
    strip_top = baseline_y + cap_top + cap_height * 0.42
    draw.rectangle(
        [PAD_X + h_bbox[0] - 4, strip_top, PAD_X + h_bbox[0] + h_w + 4, strip_top + strip_h],
        fill=(0, 0, 0, 0),
    )

    # 3) dibuja el hexágono (tuerca) en el hueco que dejó la barra de la H
    hex_cx = PAD_X + h_bbox[0] + h_w / 2
    hex_cy = strip_top + strip_h / 2
    hex_r = cap_height * 0.30
    draw.polygon(hexagon(hex_cx, hex_cy, hex_r), fill=hex_color)
    # perforación central de la tuerca, para que se lea como tuerca/perno
    hole_r = hex_r * 0.32
    draw.ellipse(
        [hex_cx - hole_r, hex_cy - hole_r, hex_cx + hole_r, hex_cy + hole_r],
        fill=(0, 0, 0, 0) if hex_color != word_color else (0, 0, 0, 0),
    )

    # 4) "421" como superíndice, pegado después de la "R" final
    full_bbox = draw.textbbox((PAD_X, baseline_y), "HANGAR", font=font)
    suffix_x = full_bbox[2] - 40
    suffix_y = baseline_y + cap_top + cap_height * 0.52
    draw.text((suffix_x, suffix_y), "421", font=suffix_font, fill=hex_color)

    # recorta al contenido real + margen
    bbox = img.getbbox()
    margin = 40
    left, top, right, bottom = bbox
    img = img.crop((max(left - margin, 0), max(top - margin, 0), min(right + margin, W), min(bottom + margin, H)))
    img.save(out_path)
    print("guardado:", out_path, img.size)


if __name__ == "__main__":
    build(NAVY, AMBER, "hangar421-logo-dark.png")       # para fondos claros (web, favicon)
    build(WHITE, AMBER, "hangar421-logo-light.png")      # para fondos oscuros (barra superior navy)
