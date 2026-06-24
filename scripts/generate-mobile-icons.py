from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "mobile" / "assets"

INK = "#14110D"
PAPER = "#FAF6EE"
LILAC = "#C4A9D9"
CAMEL = "#C59E6A"


def rounded_rectangle(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_grid_icon(
    size=1024,
    background=LILAC,
    include_background=True,
    monochrome=False,
    scale=1.0,
):
    mode = "RGBA"
    if include_background:
        image = Image.new(mode, (size, size), background)
    else:
        image = Image.new(mode, (size, size), (0, 0, 0, 0))

    draw = ImageDraw.Draw(image)

    tile = int(size * 0.255 * scale)
    gap = int(size * 0.030 * scale)
    stroke = max(12, int(size * 0.027 * scale))
    radius = int(size * 0.052 * scale)
    grid = tile * 2 + gap
    start = (size - grid) // 2

    for row in range(2):
        for col in range(2):
            x0 = start + col * (tile + gap)
            y0 = start + row * (tile + gap)
            x1 = x0 + tile
            y1 = y0 + tile
            is_active = row == 1 and col == 1
            if monochrome:
                fill = INK
            else:
                fill = CAMEL if is_active else PAPER
            rounded_rectangle(
                draw,
                (x0, y0, x1, y1),
                radius,
                fill=fill,
                outline=INK,
                width=stroke,
            )

    return image


def resize_icon(image, size):
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    ASSET_DIR.mkdir(parents=True, exist_ok=True)

    full = draw_grid_icon(include_background=True)
    foreground = draw_grid_icon(include_background=False, scale=0.78)
    background = Image.new("RGBA", (1024, 1024), LILAC)
    monochrome = draw_grid_icon(include_background=False, monochrome=True, scale=0.78)

    full.save(ASSET_DIR / "icon.png")
    foreground.save(ASSET_DIR / "android-icon-foreground.png")
    background.save(ASSET_DIR / "android-icon-background.png")
    monochrome.save(ASSET_DIR / "android-icon-monochrome.png")
    resize_icon(full, 192).save(ASSET_DIR / "favicon.png")
    resize_icon(full, 512).save(ASSET_DIR / "splash-icon.png")

    print(f"wrote icons to {ASSET_DIR}")


if __name__ == "__main__":
    main()
