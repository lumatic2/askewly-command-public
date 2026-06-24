"""
Pixel-art icon for askewly-command.
Motif: dashboard grid — checklist rows with status dots.
Colors: dark bg, white/cyan rows, colored status dots.
"""
from PIL import Image, ImageDraw
import struct, io

def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 32

    def px(x, y, w, h, color):
        x0, y0 = round(x*s), round(y*s)
        x1, y1 = round((x+w)*s)-1, round((y+h)*s)-1
        if x1 < x0: x1 = x0
        if y1 < y0: y1 = y0
        d.rectangle([x0, y0, x1, y1], fill=color)

    # Dark rounded background
    d.rounded_rectangle([0, 0, size-1, size-1], radius=round(4*s), fill=(15, 17, 26, 255))

    # Title bar
    px(4, 4, 24, 3, "#1e2235")
    px(4, 4,  8, 3, "#4f6ef7")   # blue accent left
    px(13, 5, 10, 1, "#8899cc")  # title text hint

    # Row items (label bar + status dot)
    rows = [
        (9,  "#e2e8f0", "#4ade80"),   # done - green
        (14, "#e2e8f0", "#facc15"),   # doing - yellow
        (19, "#e2e8f0", "#f87171"),   # todo - red
        (24, "#64748b", "#334155"),   # muted backlog
    ]
    for ry, label_c, dot_c in rows:
        px(4,  ry, 20, 2, "#1e2235")   # row bg
        px(5,  ry+0, 14, 1, label_c)   # label line
        px(22, ry,    2, 2, dot_c)      # status dot

    return img

sizes = [16, 32, 48, 64, 128, 256]
frames = [make_icon(s) for s in sizes]

pngs = []
for img in frames:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    pngs.append(buf.getvalue())

n = len(sizes)
header = struct.pack("<HHH", 0, 1, n)
offset = 6 + n * 16
entries = b""
for s, png in zip(sizes, pngs):
    w = s if s < 256 else 0
    h = s if s < 256 else 0
    entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(png), offset)
    offset += len(png)

out_path = "C:/Users/1/Projects/askewly-command/assets/icon.ico"
with open(out_path, "wb") as f:
    f.write(header + entries + b"".join(pngs))

print(f"icon.ico created ({sum(len(p) for p in pngs)//1024} KB)")
