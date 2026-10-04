'use strict';
const { screen } = require('electron');

/* Wszystko, co dotyczy kilku monitorow naraz (Windows 11, rozne skale).

   Wspolrzedne: Electron podaje wszystko w punktach (DIP), w jednym ukladzie
   dla wszystkich ekranow - pozycje okien, obszary ekranow i polozenie
   kursora. Monitory nad albo na lewo od glownego maja ujemne wspolrzedne,
   to normalne. Polozenie kursora bierzemy zawsze tutaj, z procesu glownego
   (screen.getCursorScreenPoint), a nie ze strony paska: przy roznych skalach
   wspolrzedne ekranu liczone w stronie potrafia nie zgadzac sie z tymi, w
   ktorych Electron ustawia okna.

   Znany blad Electrona na Windows, zmierzony u nas (laptop 150% + dwa
   monitory Full HD 100%): okno tworzone albo przesuwane przez setBounds na
   ekran o innej skali niz glowny dostaje rozmiar przeliczony jeszcze wedlug
   starej skali - zamiast 1200x800 wychodzilo 793x531. Drugie ustawienie, gdy
   okno juz stoi na docelowym ekranie, daje wlasciwy rozmiar (ustawGranice). */

const MARGINES_PASKA = 40;   // wysokosc gornego paska, za ktory da sie chwycic okno

function ekrany() {
  try { return screen.getAllDisplays(); } catch (_) { return []; }
}

function glowny() {
  try { return screen.getPrimaryDisplay(); } catch (_) { return null; }
}

function poleWspolne(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? { w, h } : null;
}

/* Czy okno da sie zobaczyc i chwycic: kawalek jego gornego paska musi lezec
   na ktoryms ekranie. Okno zapamietane na monitorze, ktorego juz nie ma
   (odlaczony, inny uklad), otwieralo sie inaczej poza ekranem. */
function widoczne(b) {
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return false;
  const pasek = { x: b.x, y: b.y, width: b.width, height: MARGINES_PASKA };
  const potrzeba = Math.min(160, Math.max(40, b.width / 3));
  return ekrany().some((d) => {
    const p = poleWspolne(pasek, d.workArea);
    return p && p.w >= potrzeba && p.h >= 16;
  });
}

function ekranPunktu(p) {
  try { return screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }); } catch (_) { return glowny(); }
}

function ekranOkna(b) {
  try { return screen.getDisplayMatching(b); } catch (_) { return glowny(); }
}

/* Okno w calosci na danym ekranie: nie wieksze niz jego obszar roboczy
   (bez paska zadan) i przesuniete do srodka, jesli wystaje. */
function dopasuj(b, ekran) {
  const d = ekran || ekranOkna(b) || glowny();
  if (!d) return b;
  const a = d.workArea;
  const width = Math.max(200, Math.min(Math.round(b.width), a.width));
  const height = Math.max(200, Math.min(Math.round(b.height), a.height));
  const x = Math.min(Math.max(Math.round(b.x), a.x), a.x + a.width - width);
  const y = Math.min(Math.max(Math.round(b.y), a.y), a.y + a.height - height);
  return { x, y, width, height };
}

/* Okno o danym rozmiarze na srodku czegos (innego okna albo ekranu),
   w calosci na tym samym ekranie. */
function naSrodku(nad, width, height) {
  const d = ekranOkna(nad);
  return dopasuj({
    x: nad.x + Math.round((nad.width - width) / 2),
    y: nad.y + Math.round((nad.height - height) / 2),
    width,
    height
  }, d);
}

/* Domyslne miejsce, gdy nie ma nic zapamietanego: srodek glownego ekranu. */
function domyslne(width = 1280, height = 820) {
  const d = glowny();
  if (!d) return { x: 80, y: 60, width, height };
  return naSrodku(d.workArea, Math.min(width, d.workArea.width), Math.min(height, d.workArea.height));
}

/* setBounds z poprawka na rozne skale ekranow (patrz komentarz na gorze). */
function ustawGranice(win, b) {
  if (!win || !b) return;
  try {
    win.setBounds(b);
    const po = win.getBounds();
    if (Math.abs(po.width - b.width) > 2 || Math.abs(po.height - b.height) > 2 || Math.abs(po.x - b.x) > 2 || Math.abs(po.y - b.y) > 2) {
      win.setBounds(b);
    }
  } catch (_) {}
}

/* Rozmiar i pozycja okna "w normalnym stanie" - u zmaksymalizowanego to
   miejsce, do ktorego wroci po przywroceniu, a nie caly ekran. */
function normalne(win) {
  try { return win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds(); } catch (_) { return null; }
}

module.exports = { widoczne, dopasuj, naSrodku, domyslne, ustawGranice, normalne, ekranPunktu, ekranOkna, glowny, ekrany };
