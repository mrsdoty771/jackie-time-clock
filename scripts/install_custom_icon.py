"""Install a custom source icon into all PWA icon sizes."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / 'public' / 'icons'
SRC = ICONS / 'source-custom.png'


def to_square(im: Image.Image) -> Image.Image:
    im = im.convert('RGB')
    w, h = im.size
    if w == h:
        return im
    side = max(w, h)
    # Pad with edge colors sampled from corners average
    px = im.load()
    samples = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    avg = tuple(sum(c[i] for c in samples) // 4 for i in range(3))
    canvas = Image.new('RGB', (side, side), avg)
    canvas.paste(im, ((side - w) // 2, (side - h) // 2))
    return canvas


def save_size(square: Image.Image, name: str, size: int):
    out = square.resize((size, size), Image.Resampling.LANCZOS)
    path = ICONS / name
    out.save(path, 'PNG')
    print(f'Wrote {path.name} ({size}x{size})')


def main():
    if not SRC.exists():
        raise SystemExit(f'Missing {SRC}')
    square = to_square(Image.open(SRC))
    save_size(square, 'icon-512.png', 512)
    save_size(square, 'icon-192.png', 192)
    save_size(square, 'apple-touch-icon.png', 180)
    save_size(square, 'icon-512-maskable.png', 512)
    # Keep a clean 1024 source in icons for future edits
    save_size(square, 'icon-source-1024.png', 1024)


if __name__ == '__main__':
    main()
