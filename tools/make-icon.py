# Ikona Nazuny w stylu "Lawendowa mgla" (wariant A wybrany przez uzytkownika 2026-11-08):
# ciemna lawenda z poswiata (lawenda, roz, blekit) + kwiat w odcieniach lawendy.
# Kwiat ma ten sam ksztalt co w aplikacji (viewBox 100: platki 14x21, srodek r=9).
# Tworzy: build/icon.png, build/icon.ico, src/assets/icon.png oraz obrazki instalatora
# build/installerSidebar.bmp, build/uninstallerSidebar.bmp, build/installerHeader.bmp.
# src/assets/mark.png (sam kwiat) zostaje bez zmian.
# Uruchamiac z katalogu repo: python tools/make-icon.py
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SS = 2  # nadprobkowanie dla gladkich krawedzi
FONT = 'src/ui/fonts/Nunito-latin.woff2'

TLO_GORA = (43, 35, 80)
TLO_DOL = (21, 19, 31)
PLAMY = [  # (x, y, promien) jako ulamek rozmiaru, kolor, alfa
    ((0.24, 0.25, 0.32), (91, 71, 201), 210),
    ((0.80, 0.76, 0.29), (217, 119, 182), 150),
    ((0.80, 0.18, 0.21), (111, 184, 255), 90),
]
PLATEK_PION = (226, 218, 255, 255)
PLATEK_POZIOM = (185, 168, 255, 255)
SRODEK = (255, 255, 255, 255)
POSWIATA = (169, 150, 255, 150)


def mgla(w, h, plamy=PLAMY):
    """Tlo: pionowy gradient + rozmyte plamy koloru."""
    maska = Image.linear_gradient('L').resize((w, h))
    tlo = Image.composite(Image.new('RGBA', (w, h), TLO_DOL + (255,)), Image.new('RGBA', (w, h), TLO_GORA + (255,)), maska)
    m = min(w, h)
    for (fx, fy, fr), kol, alfa in plamy:
        cx, cy, r = fx * w, fy * h, fr * m
        p = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(p).ellipse([cx - r, cy - r, cx + r, cy + r], fill=kol + (alfa,))
        tlo.alpha_composite(p.filter(ImageFilter.GaussianBlur(r * 0.55)))
    return tlo


def kwiat(size, skala, poswiata=True):
    """Kwiat na przezroczystym tle, rysowany z nadprobkowaniem."""
    W = size * SS
    k = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(k)
    u = W * skala / 100.0
    o = (W - 100 * u) / 2

    def el(cx, cy, rx, ry, c):
        d.ellipse([o + (cx - rx) * u, o + (cy - ry) * u, o + (cx + rx) * u, o + (cy + ry) * u], fill=c)

    el(73, 50, 21, 14, PLATEK_POZIOM); el(27, 50, 21, 14, PLATEK_POZIOM)
    el(50, 27, 14, 21, PLATEK_PION); el(50, 73, 14, 21, PLATEK_PION)
    el(50, 50, 9, 9, SRODEK)
    k = k.resize((size, size), Image.LANCZOS)
    if not poswiata:
        return k
    g = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    a = k.split()[3].filter(ImageFilter.GaussianBlur(size * 0.04))
    g.paste(Image.new('RGBA', (size, size), POSWIATA), (0, 0), a)
    g.alpha_composite(k)
    return g


def zaokraglona(size, promien):
    m = Image.new('L', (size * SS, size * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size * SS - 1, size * SS - 1], promien * SS, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def ikona(size, skala=0.80):
    t = mgla(size, size)
    t.alpha_composite(kwiat(size, skala, poswiata=size >= 48))
    t.putalpha(zaokraglona(size, round(size * 0.225)))
    return t


def czcionka(px, waga):
    f = ImageFont.truetype(FONT, px)
    try:
        f.set_variation_by_axes([waga])
    except Exception:
        pass
    return f


def napis_rozstrzelony(d, xy_srodek, tekst, f, odstep, kolor):
    szer = sum(d.textlength(ch, font=f) for ch in tekst) + odstep * (len(tekst) - 1)
    x = xy_srodek[0] - szer / 2
    for ch in tekst:
        d.text((x, xy_srodek[1]), ch, font=f, fill=kolor, anchor='ls')
        x += d.textlength(ch, font=f) + odstep


def sidebar():
    # 164x314 (NSIS), rysowane x4 i zmniejszane
    K = 4; w, h = 164 * K, 314 * K
    t = mgla(w, h, [((0.15, 0.22, 0.75), (91, 71, 201), 200), ((0.95, 0.80, 0.65), (217, 119, 182), 120), ((0.90, 0.10, 0.45), (111, 184, 255), 70)])
    ik = ikona(100 * K)
    # cien pod ikona, zeby nie zlewala sie z tlem z tej samej mgly
    cien = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    cien.paste(Image.new('RGBA', ik.size, (8, 6, 20, 190)), ((w - ik.width) // 2, 58 * K), ik.split()[3])
    t.alpha_composite(cien.filter(ImageFilter.GaussianBlur(9 * K)))
    t.alpha_composite(ik, ((w - ik.width) // 2, 52 * K))
    d = ImageDraw.Draw(t)
    napis_rozstrzelony(d, (w / 2, 196 * K), 'nazuna', czcionka(23 * K, 800), 4 * K, (201, 188, 255, 255))
    f2 = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 12 * K)
    for i, linia in enumerate(['przeglądarka', 'internetowa']):
        d.text((w / 2, (222 + i * 16) * K), linia, font=f2, fill=(214, 209, 242, 255), anchor='ms')
    d.rounded_rectangle([w / 2 - 18 * K, 290 * K, w / 2 + 18 * K, 292 * K], K, fill=(201, 188, 255, 255))
    return t.resize((164, 314), Image.LANCZOS).convert('RGB')


def naglowek():
    # 150x57 (NSIS)
    K = 4; w, h = 150 * K, 57 * K
    t = mgla(w, h, [((0.10, 0.30, 0.9), (91, 71, 201), 170), ((0.95, 0.90, 0.6), (217, 119, 182), 90)])
    ik = ikona(41 * K)
    t.alpha_composite(ik, (8 * K, 8 * K))
    d = ImageDraw.Draw(t)
    f = czcionka(17 * K, 800)
    x = 58 * K
    for ch in 'nazuna':
        d.text((x, 35 * K), ch, font=f, fill=(201, 188, 255, 255), anchor='ls')
        x += d.textlength(ch, font=f) + 2.5 * K
    return t.resize((150, 57), Image.LANCZOS).convert('RGB')


if __name__ == '__main__':
    duza = ikona(1024)
    duza.save('build/icon.png')
    ikona(512).save('src/assets/icon.png')
    # Kazdy rozmiar .ico rysowany osobno (male bez poswiaty, kwiat nieco wiekszy = czytelniej).
    rozmiary = [16, 24, 32, 48, 64, 128, 256]
    obrazy = [ikona(s, 0.86 if s <= 32 else 0.80) for s in rozmiary]
    obrazy[-1].save('build/icon.ico', sizes=[(s, s) for s in rozmiary], append_images=obrazy[:-1])
    sb = sidebar()
    sb.save('build/installerSidebar.bmp')
    sb.save('build/uninstallerSidebar.bmp')
    naglowek().save('build/installerHeader.bmp')
    print('ok')
