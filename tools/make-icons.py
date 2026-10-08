# Genera los íconos PNG de la PWA (ficha de poker sobre fieltro). Uso: python3 tools/make-icons.py
from PIL import Image, ImageDraw
import math

def chip_icon(size, maskable=False):
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = S * (0.0 if maskable else 0.22)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=(10, 28, 24, 255))
    cx = cy = S / 2
    R = S * (0.30 if maskable else 0.36)
    # cuerpo de la ficha
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(201, 58, 46, 255))
    # muescas del borde
    for i in range(8):
        a = math.radians(i * 45 - 11.25)
        b = math.radians(i * 45 + 11.25)
        d.pieslice([cx - R, cy - R, cx + R, cy + R], math.degrees(a), math.degrees(b), fill=(238, 243, 233, 255))
    R2 = R * 0.78
    d.ellipse([cx - R2, cy - R2, cx + R2, cy + R2], fill=(201, 58, 46, 255))
    R3 = R * 0.62
    d.ellipse([cx - R3, cy - R3, cx + R3, cy + R3], outline=(238, 243, 233, 200), width=max(2, int(S * 0.008)))
    R4 = R * 0.30
    d.ellipse([cx - R4, cy - R4, cx + R4, cy + R4], fill=(228, 179, 75, 255))
    return img.resize((size, size), Image.LANCZOS)

for name, size, mk in [("icon-192.png", 192, False), ("icon-512.png", 512, False),
                       ("icon-maskable-512.png", 512, True), ("apple-touch-icon.png", 180, False)]:
    chip_icon(size, mk).save("public/" + name)
    print("ok", name)
