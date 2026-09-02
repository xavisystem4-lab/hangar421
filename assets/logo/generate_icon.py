"""
Genera el ícono cuadrado de marca (para favicon, taskbar de Windows y el .ico
del instalador): fondo navy redondeado + la tuerca hexagonal ámbar de la "H"
del logotipo, como monograma. Exporta PNG en varios tamaños + un .ico multi-size.
"""
from PIL import Image, ImageDraw
import math

NAVY = (11, 30, 51, 255)
AMBER = (232, 163, 61, 255)
WHITE = (255, 255, 255, 255)

SIZE = 1024


def hexagon(cx, cy, r, rot=0):
    return [
        (cx + r * math.cos(math.radians(a + rot)), cy + r * math.sin(math.radians(a + rot)))
        for a in range(0, 360, 60)
    ]


def rounded_square(size, radius, color):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=color)
    return img


def build_icon():
    img = rounded_square(SIZE, int(SIZE * 0.22), NAVY)
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE / 2, SIZE / 2
    r = SIZE * 0.30
    draw.polygon(hexagon(cx, cy, r), fill=AMBER)
    hole_r = r * 0.34
    draw.ellipse([cx - hole_r, cy - hole_r, cx + hole_r, cy + hole_r], fill=NAVY)

    # barras verticales de la "H", saliendo del hexágono, para que se lea
    # como el mismo monograma que el wordmark completo
    bar_w = SIZE * 0.075
    bar_h = SIZE * 0.62
    gap = r * 1.05
    top = cy - bar_h / 2
    bottom = cy + bar_h / 2
    for side in (-1, 1):
        bx = cx + side * gap
        draw.rectangle([bx - bar_w / 2, top, bx + bar_w / 2, bottom], fill=WHITE)

    return img


if __name__ == "__main__":
    icon = build_icon()
    icon.save("icon-1024.png")

    sizes = [16, 24, 32, 48, 64, 128, 256, 512]
    for s in sizes:
        icon.resize((s, s), Image.LANCZOS).save(f"icon-{s}.png")

    # .ico multi-resolución para electron-builder / favicon de Windows
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    icon.save("icon.ico", sizes=ico_sizes)
    print("listo: icon-1024.png, icon-{16..512}.png, icon.ico")
