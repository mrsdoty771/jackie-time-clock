"""Make white padding around rounded app icons transparent."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / 'public' / 'icons'
CORNER_RATIO = 0.22


def is_bg(rgb, threshold=245):
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


def make_transparent(src_path, dest_path, out_size):
    im = Image.open(src_path).convert('RGBA')
    minx, miny, maxx, maxy = content_bbox(im)
    pad = max(2, int(im.size[0] * 0.004))
    logo = im.crop((
        max(0, minx - pad),
        max(0, miny - pad),
        min(im.size[0], maxx + pad + 1),
        min(im.size[1], maxy + pad + 1),
    ))

    # Small inset so soft edges aren't clipped by desktop icon masks
    inset = max(2, int(out_size * 0.02))
    target = out_size - inset * 2
    logo = logo.resize((target, target), Image.Resampling.LANCZOS)

    radius = int(target * CORNER_RATIO)
    rmask = Image.new('L', (target, target), 0)
    ImageDraw.Draw(rmask).rounded_rectangle(
        (0, 0, target - 1, target - 1),
        radius=radius,
        fill=255,
    )

    rounded = Image.new('RGBA', (target, target), (0, 0, 0, 0))
    rounded.paste(logo, (0, 0), rmask)

    # Force outside rounded rect fully transparent
    px = rounded.load()
    mp = rmask.load()
    for y in range(target):
        for x in range(target):
            if mp[x, y] == 0:
                px[x, y] = (0, 0, 0, 0)

    canvas = Image.new('RGBA', (out_size, out_size), (0, 0, 0, 0))
    canvas.paste(rounded, (inset, inset), rounded)
    canvas.save(dest_path, 'PNG')
    print(f'Wrote {dest_path.name} ({out_size}x{out_size})')


def make_maskable(src_path, dest_path, size=512):
    """Full-bleed opaque icon for Android maskable purpose."""
    im = Image.open(src_path).convert('RGBA')
    minx, miny, maxx, maxy = content_bbox(im)
    logo = im.crop((minx, miny, maxx + 1, maxy + 1)).resize(
        (size, size), Image.Resampling.LANCZOS
    )
    canvas = Image.new('RGB', (size, size), (255, 255, 255))
    canvas.paste(logo, (0, 0), logo)
    canvas.save(dest_path, 'PNG')
    print(f'Wrote {dest_path.name} (maskable {size}x{size})')


def main():
    src = ICONS / 'icon-512.png'
    bak = ICONS / 'icon-512.original.png'
    if not bak.exists():
        Image.open(src).save(bak)
        print(f'Backed up original to {bak.name}')

    source = bak if bak.exists() else src
    make_transparent(source, ICONS / 'icon-512.png', 512)
    make_transparent(source, ICONS / 'icon-192.png', 192)
    make_transparent(source, ICONS / 'apple-touch-icon.png', 180)
    make_maskable(source, ICONS / 'icon-512-maskable.png', 512)


if __name__ == '__main__':
    main()
