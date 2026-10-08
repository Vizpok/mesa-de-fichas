"""Pone el ícono de Mesa de fichas en el proyecto de Android generado por Capacitor.
Uso: python3 tools/android-icons.py android-app/android"""
import sys, pathlib, re
from PIL import Image, ImageDraw

res = pathlib.Path(sys.argv[1]) / 'app/src/main/res'
pub = pathlib.Path(__file__).resolve().parent.parent / 'public'
full = Image.open(pub / 'icon-512.png').convert('RGBA')        # ícono normal
mask = Image.open(pub / 'icon-maskable-512.png').convert('RGBA')  # con margen de seguridad

legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
for d, px in legacy.items():
    out = res / ('mipmap-' + d)
    sq = full.resize((px, px), Image.LANCZOS)
    sq.save(out / 'ic_launcher.png')
    # versión redonda
    m = Image.new('L', (px * 4, px * 4), 0)
    ImageDraw.Draw(m).ellipse((0, 0, px * 4 - 1, px * 4 - 1), fill=255)
    m = m.resize((px, px), Image.LANCZOS)
    rd = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    rd.paste(sq, (0, 0), m)
    rd.save(out / 'ic_launcher_round.png')
    # primer plano del ícono adaptable (lienzo de 108dp)
    fg = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}[d]
    mask.resize((fg, fg), Image.LANCZOS).save(out / 'ic_launcher_foreground.png')

bg = res / 'values/ic_launcher_background.xml'
bg.write_text(re.sub(r'#[0-9A-Fa-f]{6}', '#0A1C18', bg.read_text()))
print('Íconos listos')
