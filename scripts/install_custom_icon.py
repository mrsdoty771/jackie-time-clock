"""Install a custom source icon into all PWA icon sizes."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / 'public' / 'icons'
SRC = ICONS / 'source-custom.png'

# Zoom so the clock fills more of the tile (1.0 = no zoom).
ZOOM = 1.22
# Corner radius as a fraction of icon side (Windows-style ~18%).
CORNER_RADIUS = 0.18


def to_square(im: Image.Image) -> Image.Image:
    im = im.convert('RGB')
    w, h = im.size
    if w == h:
        return im
    side = max(w, h)
    px = im.load()
    samples = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    avg = tuple(sum(c[i] for c in samples) // 4 for i in range(3))
    canvas = Image.new('RGB', (side, side), avg)
    canvas.paste(im, ((side - w) // 2, (side - h) // 2))
    return canvas


def zoom_center(im: Image.Image, factor: float) -> Image.Image:
    if factor <= 1.0:
        return im
    w, h = im.size
    nw, nh = int(w / factor), int(h / factor)
    left = (w - nw) // 2
    top = (h - nh) // 2
    return im.crop((left, top, left + nw, top + nh))


def round_corners(im: Image.Image, radius_ratio: float) -> Image.Image:
    """Opaque art with transparent corners so OS can show a rounded tile."""
    im = im.convert('RGBA')
    w, h = im.size
    radius = max(1, int(min(w, h) * radius_ratio))
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.paste(im, (0, 0))
    out.putalpha(mask)
    return out


def save_size(im: Image.Image, name: str, size: int, rounded: bool):
    out = im.resize((size, size), Image.Resampling.LANCZOS)
    if rounded:
        out = round_corners(out, CORNER_RADIUS)
    else:
        out = out.convert('RGB')
    path = ICONS / name
    out.save(path, 'PNG')
    print(f'Wrote {path.name} ({size}x{size}{" rounded" if rounded else ""})')


def main():
    if not SRC.exists():
        raise SystemExit(f'Missing {SRC}')
    square = zoom_center(to_square(Image.open(SRC)), ZOOM)
    # any / apple: zoomed + rounded corners
    save_size(square, 'icon-512.png', 512, rounded=True)
    save_size(square, 'icon-192.png', 192, rounded=True)
    save_size(square, 'apple-touch-icon.png', 180, rounded=True)
    # maskable: full-bleed opaque (platform clips); same zoom for size consistency
    save_size(square, 'icon-512-maskable.png', 512, rounded=False)
    save_size(square, 'icon-source-1024.png', 1024, rounded=False)


if __name__ == '__main__':
    main()
