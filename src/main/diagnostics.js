'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/* Diagnostyka zawieszonego ladowania kart - dziennik zdarzen do wylapania
   przerywanego buga "strona laduje sie w nieskonczonosc" (rzadki, znika
   sam, zbyt krotki, zeby zlapac go recznie na zywo, patrz rozmowa z
   uzytkownikiem). Zamiast zgadywac, ten modul siedzi cicho w tle podczas
   ZWYKLEGO korzystania z przegladarki i sam zapisuje pelny zrzut stanu w
   chwili, gdy cos faktycznie wyglada na zawieszone - zeby bylo co
   przeanalizowac PO fakcie.

   Dwa poziomy:
   - pierscien (ring buffer) w pamieci: ostatnie zdarzenia (start/koniec
     ladowania, nawigacje, przelaczenia kart, usypianie/budzenie, bledy) -
     nic sam z siebie nie zapisuje na dysk, wiec kosztuje praktycznie zero
     przez cale dnie zwyklego uzywania.
   - zrzut na dysk: odpala sie tylko wtedy, gdy watchdog ponizej wykryje
     realny problem - karta "laduje sie" dluzej niz PROG_ZAWIESZENIA_MS,
     jej proces przestal odpowiadac (unresponsive) albo sam sie wywrocil
     (render-process-gone). Zrzut to caly pierscien (kontekst PRZED
     zdarzeniem) plus pelny stan wszystkich okien/kart w tej chwili plus
     zuzycie pamieci.

   Pliki ladują sie w folderze danych Nazuny (nazuna://about -> "Ta
   instalacja" -> "Otworz"), w podfolderze diagnostyka/. Trzymane jest tylko
   ostatnie ZACHOWAJ_DUMPOW zrzutow, starsze kasuja sie same - to ma zyc
   miesiacami na czyims dysku bez pilnowania, wiec nie moze rosnac bez
   konca. */

const PROG_ZAWIESZENIA_MS = 20000;
const SPRAWDZAJ_CO_MS = 5000;
const PIERSCIEN_LIMIT = 400;
const ZACHOWAJ_DUMPOW = 30;

const pierscien = [];
let dumpDir = null;
let watchdogTimer = null;
// Karty, dla ktorych juz zrzucilismy stan przy TYM konkretnym (wciaz
// trwajacym) ladowaniu - zeby nie zrzucac tego samego zawieszenia co
// SPRAWDZAJ_CO_MS w kolko, dopoki sie nie skonczy.
const zrzuconeDlaLadowania = new Set();

function folder() {
  if (!dumpDir) dumpDir = path.join(app.getPath('userData'), 'diagnostyka');
  try { fs.mkdirSync(dumpDir, { recursive: true }); } catch (_) {}
  return dumpDir;
}

function zdarzenie(typ, dane = {}) {
  try {
    pierscien.push({ t: Date.now(), iso: new Date().toISOString(), typ, ...dane });
    if (pierscien.length > PIERSCIEN_LIMIT) pierscien.shift();
  } catch (_) {}
}

function posprzatajStareZrzuty() {
  try {
    const dir = folder();
    const pliki = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    while (pliki.length > ZACHOWAJ_DUMPOW) {
      const stary = pliki.shift();
      try { fs.unlinkSync(path.join(dir, stary)); } catch (_) {}
    }
  } catch (_) {}
}

function pamiec() {
  try {
    return {
      proces: process.memoryUsage(),
      procesySystemowe: app.getAppMetrics().map((m) => ({ pid: m.pid, typ: m.type, pamiec: m.memory })),
      wolnaPamiecSystemu: process.getSystemMemoryInfo ? process.getSystemMemoryInfo() : null
    };
  } catch (_) { return null; }
}

function bezpiecznyBounds(view) {
  try { return view.getBounds(); } catch (_) { return null; }
}

function stanWszystkichOkien(windows) {
  const wynik = [];
  for (const w of windows) {
    try {
      wynik.push({
        windowId: w.id,
        isPrivate: !!w.isPrivate,
        activeTabId: w.activeTabId,
        expanded: !!w.expanded,
        tabs: w.tabs.map((t) => ({
          id: t.id,
          url: t.url,
          displayUrl: t.displayUrl,
          title: t.title,
          loading: !!t.loading,
          ladujeSieOdMs: t._ladowanieOd ? Date.now() - t._ladowanieOd : null,
          sleeping: !!t.sleeping,
          audible: !!t.audible,
          hadAudio: !!t.hadAudio,
          muted: !!t.muted,
          lastActiveAt: t.lastActiveAt,
          bounds: (t.view && !t.sleeping) ? bezpiecznyBounds(t.view) : null,
          aktywna: t.id === w.activeTabId
        }))
      });
    } catch (_) {}
  }
  return wynik;
}

function zrzuc(powod, windows) {
  try {
    const dir = folder();
    const nazwa = `zawieszenie-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const dane = {
      powod,
      czas: new Date().toISOString(),
      wersjaNazuny: app.getVersion(),
      platforma: process.platform,
      pamiec: pamiec(),
      okna: stanWszystkichOkien(windows),
      // Historia zdarzen prowadzacych DO tego momentu - to jest najcenniejsza
      // czesc zrzutu, bo pokazuje co dzialo sie chwile PRZED zawieszeniem,
      // a nie tylko sam moment jego wykrycia.
      historia: pierscien.slice()
    };
    fs.writeFileSync(path.join(dir, nazwa), JSON.stringify(dane, null, 2));
    posprzatajStareZrzuty();
  } catch (_) { /* dziennik diagnostyczny nigdy nie moze wywrocic aplikacji */ }
}

/* Podpina sledzenie zdarzen jednej karty - wywolywane raz z Tab.wire()
   (patrz window.js), zarowno przy pierwszym tworzeniu karty jak i przy
   kazdym jej ponownym zbudowaniu po wake(). */
function sledzKarte(tab) {
  const wc = tab.wc;
  if (!wc) return;
  const znacznik = (typ, dodatkowe = {}) => zdarzenie(typ, { tabId: tab.id, url: tab.url, ...dodatkowe });

  wc.on('did-start-loading', () => { tab._ladowanieOd = Date.now(); znacznik('start-ladowania'); });
  wc.on('did-stop-loading', () => {
    if (tab._ladowanieOd) znacznik('koniec-ladowania', { trwaloMs: Date.now() - tab._ladowanieOd });
    tab._ladowanieOd = null;
    zrzuconeDlaLadowania.delete(tab.id);
  });
  wc.on('did-navigate', (_e, url) => znacznik('nawigacja', { url }));
  wc.on('did-navigate-in-page', (_e, url) => znacznik('nawigacja-w-stronie', { url }));
  wc.on('did-fail-load', (_e, code, description) => znacznik('blad-ladowania', { code, description }));
  // unresponsive/responsive to najbardziej bezposredni sygnal, jaki Chromium
  // w ogole daje o zawieszonym procesie renderujacym (glowny watek strony
  // przestal odpowiadac na wewnetrzne pingi) - jesli zglaszany przez
  // uzytkownika bug jest naprawde zawieszeniem strony, a nie tylko wolnym
  // ladowaniem, to najpewniej wlasnie to zdarzenie zlapie go najdokladniej.
  wc.on('unresponsive', () => { znacznik('proces-nie-odpowiada'); zrzuc('unresponsive', [tab.owner]); });
  wc.on('responsive', () => znacznik('proces-znowu-odpowiada'));
  wc.on('render-process-gone', (_e, details) => {
    znacznik('proces-padl', { powod: details && details.reason });
    zrzuc('render-process-gone', [tab.owner]);
  });
}

function przelaczenieKarty(win, tabId) {
  zdarzenie('przelaczenie-karty', { windowId: win.id, tabId });
}

function usypianie(tabId) { zdarzenie('usypianie-karty', { tabId }); }
function budzenie(tabId) { zdarzenie('budzenie-karty', { tabId }); }

/* Watchdog - co SPRAWDZAJ_CO_MS przeglada wszystkie karty ze wszystkich
   okien i szuka takiej, ktora "laduje sie" dluzej niz PROG_ZAWIESZENIA_MS.
   Dostaje zywa liste okien z zewnatrz jako funkcje (a nie przez import), bo
   window.js i tak importuje ten modul - zwykly import w druga strone
   zrobilby z tego zaleznosc cykliczna. */
function start(pobierzOkna) {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    let windows;
    try { windows = pobierzOkna(); } catch (_) { return; }
    for (const w of windows) {
      for (const t of w.tabs) {
        if (!t._ladowanieOd || t.sleeping) continue;
        const trwa = Date.now() - t._ladowanieOd;
        if (trwa > PROG_ZAWIESZENIA_MS && !zrzuconeDlaLadowania.has(t.id)) {
          zrzuconeDlaLadowania.add(t.id);
          zdarzenie('podejrzenie-zawieszenia', { tabId: t.id, url: t.url, trwaMs: trwa });
          zrzuc('stuck-loading', windows);
        }
      }
    }
  }, SPRAWDZAJ_CO_MS);
  // Watchdog nie moze sam trzymac aplikacji przy zyciu (np. przy probie
  // zamkniecia w tle) - to zwykly interwal porzadkowy, nie funkcja programu.
  if (watchdogTimer.unref) watchdogTimer.unref();
}

module.exports = { zdarzenie, sledzKarte, przelaczenieKarty, usypianie, budzenie, start, zrzuc, folder };
