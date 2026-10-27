from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import struct

root = Path(__file__).parent
iconset = root / 'dist' / 'ZetamacLocal.iconset'
iconset.mkdir(parents=True, exist_ok=True)
size = 1024
image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
mask = Image.new('L', (size, size), 0)
ImageDraw.Draw(mask).rounded_rectangle((42, 42, 982, 982), radius=215, fill=255)
gradient = Image.new('RGBA', (size, size))
pixels = gradient.load()
for y in range(size):
    blend = y / (size - 1)
    top, bottom = (75, 117, 246), (26, 88, 202)
    color = tuple(round(a * (1 - blend) + b * blend) for a, b in zip(top, bottom))
    for x in range(size):
        pixels[x, y] = (*color, 255)
image.paste(gradient, (0, 0), mask)
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 645)
draw.text((size / 2, size / 2 - 22), '∑', anchor='mm', font=font, fill='white', stroke_width=2)

for base in (16, 32, 128, 256, 512):
    image.resize((base, base), Image.Resampling.LANCZOS).save(iconset / f'icon_{base}x{base}.png')
    image.resize((base * 2, base * 2), Image.Resampling.LANCZOS).save(iconset / f'icon_{base}x{base}@2x.png')

parts = []
for kind, filename in [
    (b'icp4', 'icon_16x16.png'), (b'icp5', 'icon_32x32.png'),
    (b'icp6', 'icon_32x32@2x.png'), (b'ic07', 'icon_128x128.png'),
    (b'ic08', 'icon_256x256.png'), (b'ic09', 'icon_512x512.png'),
    (b'ic10', 'icon_512x512@2x.png'),
]:
    data = (iconset / filename).read_bytes()
    parts.append(kind + struct.pack('>I', len(data) + 8) + data)
payload = b''.join(parts)
(root / 'Resources' / 'Icon.icns').write_bytes(b'icns' + struct.pack('>I', len(payload) + 8) + payload)
