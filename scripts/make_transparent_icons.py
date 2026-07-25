"""Build full-bleed opaque icons for Windows/Chrome PWA shortcuts.

Chrome fills transparent PNG pixels with manifest background_color (white),
which caused the white box around the logo. These icons fill the whole square
with the logo colors — including the former rounded-corner white triangles.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / 'public' / 'icons'


def is_bg(rgb, threshold=248):
    r, g, b = rgb[:3]
    return r >= threshold and g >= threshold and b >= threshold


def content_bbox(im):
    px = im.load()
    w, h = im.size
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if not is_bg(px[x, y]):
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    if maxx < 0:
        return (0, 0, w - 1, h - 1)
    return (minx, miny, maxx, maxy)


def fill_white_from_interior(im):
    """Replace near-white pixels (rounded-corner leftovers) with nearby logo colors."""
    px = im.load()
    w, h = im.size
    cx, cy = w // 2, h // 2
    for y in range(h):
        for x in range(w):
            if not is_bg(px[x, y]):
                continue
            dx = cx - x
            dy = cy - y
            steps = max(abs(dx), abs(dy), 1)
            found = None
            for i in range(1, steps + 1):
                nx = x + (dx * i) // steps
                ny = y + (dy * i) // steps
                if 0 <= nx < w and 0 <= ny < h and not is_bg(px[nx, ny]):
                    found = px[nx, ny]
                    break
            if found is None:
                found = (90, 100, 210)
            r, g, b = found[:3]
            px[x, y] = (r, g, b) if im.mode == 'RGB' else (r, g, b, 255)


def make_full_bleed(src_path, dest_path, size):
    im = Image.open(src_path).convert('RGBA')
    minx, miny, maxx, maxy = content_bbox(im)
    logo = im.crop((minx, miny, maxx + 1, maxy + 1)).convert('RGB')
    fill_white_from_interior(logo)
    logo = logo.resize((size, size), Image.Resampling.LANCZOS)
    # Second pass after resize in case of AA white fringes
    fill_white_from_interior(logo)
    logo.save(dest_path, 'PNG')
    print(f'Wrote full-bleed {dest_path.name} ({size}x{size})')


def main():
    source = ICONS / 'icon-512.original.png'
    if not source.exists():
        raise SystemExit('Missing icon-512.original.png backup')
    make_full_bleed(source, ICONS / 'icon-512.png', 512)
    make_full_bleed(source, ICONS / 'icon-192.png', 192)
    make_full_bleed(source, ICONS / 'apple-touch-icon.png', 180)
    make_full_bleed(source, ICONS / 'icon-512-maskable.png', 512)


if __name__ == '__main__':
    main()
