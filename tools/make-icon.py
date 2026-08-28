from PIL import Image, ImageDraw, ImageFilter
import os

S = 1024
SS = 4

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))

def rounded_mask(size, radius):
    m = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size*SS-1, size*SS-1], radius=radius*SS, fill=255)
    return m.resize((size, size), Image.LANCZOS)

# background tile
top, bottom = (36, 38, 53), (13, 14, 19)
bg = Image.new("RGB", (S, S))
px = bg.load()
for y in range(S):
    for x in range(0, S, 8):
        c = lerp(top, bottom, min(1.0, x / S * 0.35 + y / S * 0.65))
        for k in range(8):
            if x + k < S: px[x+k, y] = c

sheen = Image.new("L", (S, S), 0)
ImageDraw.Draw(sheen).ellipse([-S*0.45, -S*0.6, S*0.75, S*0.5], fill=44)
sheen = sheen.filter(ImageFilter.GaussianBlur(S*0.09))
bg = Image.composite(Image.new("RGB", (S, S), (88, 94, 132)), bg, sheen)

# blossom
W = S * SS
cx = cy = W / 2
petal_len = W * 0.34
petal_wid = W * 0.24
centre_gap = W * 0.055          # how far the petal base sits from the middle
cols = [(238, 236, 255, 255), (220, 215, 253, 255), (231, 227, 255, 255), (209, 203, 250, 255)]

mark = Image.new("RGBA", (W, W), (0, 0, 0, 0))
for i, rot in enumerate((0, 90, 180, 270)):
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    bottom_y = cy - centre_gap
    top_y = bottom_y - petal_len
    d.ellipse([cx - petal_wid / 2, top_y, cx + petal_wid / 2, bottom_y], fill=cols[i])
    if rot:
        layer = layer.rotate(rot, resample=Image.BICUBIC, center=(cx, cy))
    mark.alpha_composite(layer)

d = ImageDraw.Draw(mark)
r = W * 0.093
d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
r2 = W * 0.05
d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=(118, 110, 228, 255))

mark = mark.resize((S, S), Image.LANCZOS)
glow = mark.split()[3].filter(ImageFilter.GaussianBlur(S * 0.05)).point(lambda v: int(v * 0.5))
bg = Image.composite(Image.new("RGB", (S, S), (126, 118, 234)), bg, glow)

tile = bg.convert("RGBA")
tile.alpha_composite(mark)
tile.putalpha(rounded_mask(S, int(S * 0.225)))

os.makedirs("build", exist_ok=True); os.makedirs("src/assets", exist_ok=True)
tile.save("build/icon.png")
tile.resize((512, 512), Image.LANCZOS).save("src/assets/icon.png")
tile.save("build/icon.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])

# transparent glyph for use inside the UI
glyph = Image.new("RGBA", (S, S), (0, 0, 0, 0))
glyph.alpha_composite(mark)
glyph.resize((256, 256), Image.LANCZOS).save("src/assets/mark.png")

prev = Image.new("RGB", (330, 160), (24, 24, 28))
prev.paste(tile.convert("RGB"), (16, 16), tile.resize((S, S)).split()[3]) if False else None
prev.paste(tile.resize((128,128), Image.LANCZOS).convert("RGB"), (16, 16))
prev.paste(tile.resize((64,64), Image.LANCZOS).convert("RGB"), (160, 48))
prev.paste(tile.resize((32,32), Image.LANCZOS).convert("RGB"), (240, 64))
prev.paste(tile.resize((16,16), Image.LANCZOS).convert("RGB"), (290, 72))
prev.save("/tmp/icon_prev.png")
print("ok")
