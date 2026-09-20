r"""生成 icon.ico：绿色圆角方块 + Activity 心电折线（与官网 favicon、应用内 logo 同款）。

用法: python scripts/make_icon.py  → 仓库根目录 icon.ico（16/24/32/48/64/128/256）
"""
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).parent.parent
OUT = ROOT / "icon.ico"

SIZE = 1024  # 大尺寸绘制再缩小，保证平滑
GREEN_BG = (5, 150, 105, 255)     # #059669 官网 favicon 底色
STROKE = (52, 211, 153, 255)      # #34d399 折线色


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 圆角方块（rx = 1/4 边长，同 favicon）
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 4, fill=GREEN_BG)
    # Activity 折线：M6 16 h4 l3 -7 l4 14 l3 -7 h6（viewBox 32 缩放）
    s = size / 32
    pts = [(6, 16), (10, 16), (13, 9), (17, 23), (20, 16), (26, 16)]
    d.line([(x * s, y * s) for x, y in pts], fill=STROKE, width=int(size * 2.5 / 32), joint="curve")
    for p in pts:  # 圆线帽
        r = size * 1.25 / 32
        d.ellipse([x - r for x in p] and (p[0] * s - r, p[1] * s - r, p[0] * s + r, p[1] * s + r), fill=STROKE)
    return img


def main() -> None:
    img = draw_icon(SIZE)
    sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    img.resize((256, 256), Image.LANCZOS).save(OUT, format="ICO", sizes=sizes)
    print(f"saved {OUT}")


if __name__ == "__main__":
    main()
