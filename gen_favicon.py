import base64
import pathlib

from PIL import Image, ImageDraw


def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 32  # scale factor

    # Blue rounded background
    d.rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=round(6 * s), fill=(0, 102, 255, 255)
    )

    # Browser window outline
    d.rounded_rectangle(
        [round(4 * s), round(8 * s), round(27 * s), round(23 * s)],
        radius=round(2 * s),
        outline=(255, 255, 255, 255),
        width=max(1, round(2 * s)),
    )

    # Toolbar divider line
    d.line(
        [round(4 * s), round(13 * s), round(27 * s), round(13 * s)],
        fill=(255, 255, 255, 255),
        width=max(1, round(2 * s)),
    )

    # Two dots in the toolbar
    r = max(1, round(1.2 * s))
    for cx in [round(7 * s), round(11 * s)]:
        cy = round(10.5 * s)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))

    return img


icons = [make_icon(s) for s in (16, 32, 48)]
out = pathlib.Path("favicon.ico")
icons[0].save(
    out, format="ICO", append_images=icons[1:], sizes=[(16, 16), (32, 32), (48, 48)]
)

b64 = base64.b64encode(out.read_bytes()).decode()
print(f"Written {out} ({out.stat().st_size} bytes)")
print(f"\nBase64 ({len(b64)} chars):\n{b64}")
