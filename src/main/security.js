'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/* --------------------------------------------------------------------
   Wspolny punkt bezpieczenstwa nawigacji. Kazda proba wejscia na strone -
   z paska adresu, z klikniecia linku, z nowej karty i z przekierowania -
   przechodzi przez sprawdz(), zanim cokolwiek sie zaladuje (patrz
   window.js, metoda Tab.otworz). Dzieki jednemu wspolnemu miejscu zadna
   z tych sciezek nie moze przypadkiem ominac sprawdzenia.

     etap 1 - mechanizm i strona ostrzegawcza (nazuna://warning) - gotowe
     etap 2 - lista znanych zlosliwych domen (phishing, malware) - ponizej
     etap 3 - ostrzezenie o polaczeniu bez szyfrowania (http) - jeszcze nie */

/* ---------------------------------------------------- lista zlosliwych hostow
   Zrodlo: URLhaus (abuse.ch), darmowa i publiczna lista hostow uzywanych do
   rozsylania zlosliwego oprogramowania, bez klucza API. Format to zwykly
   plik "hosts" (0.0.0.0 <host>) - dokladnie taki sam pomysl jak w blokerze
   reklam (adblock.js), tylko inne zrodlo i inny cel: tam ukrywanie reklam,
   tu ostrzezenie przed wejsciem. */
const ZRODLO_HOSTOW = 'https://urlhaus.abuse.ch/downloads/hostfile/';
const ODSWIEZAJ_CO = 6 * 60 * 60 * 1000; // tyle samo co listy filtrow blokera

let zleHosty = new Set();
let gotowe = false;

function cachePath() { return path.join(app.getPath('userData'), 'zlosliwe-hosty.json'); }

function parsujHostfile(tekst) {
  const set = new Set();
  for (const linia of tekst.split('\n')) {
    const l = linia.trim();
    if (!l || l.startsWith('#')) continue;
    const czesci = l.split(/\s+/);
    // Format: "0.0.0.0 zla-domena.pl" - interesuje nas druga kolumna.
    if (czesci.length >= 2 && czesci[1]) set.add(czesci[1].toLowerCase());
  }
  return set;
}

function wczytajCache() {
  try {
    const surowe = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    if (Array.isArray(surowe.hosty) && surowe.hosty.length) {
      zleHosty = new Set(surowe.hosty);
      gotowe = true;
      return surowe.updatedAt || 0;
    }
  } catch (_) { /* pierwszy start - jeszcze nie ma cache */ }
  return 0;
}

function zapiszCache() {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify({ updatedAt: Date.now(), hosty: [...zleHosty] }));
  } catch (err) {
    console.warn('[security] nie moge zapisac cache listy zlosliwych domen:', err.message);
  }
}

async function odswiez() {
  try {
    const odp = await fetch(ZRODLO_HOSTOW);
    if (!odp.ok) return false;
    const tekst = await odp.text();
    const nowa = parsujHostfile(tekst);
    if (!nowa.size) return false; // pusta odpowiedz - lepiej zostac przy starej liscie niz wyzerowac ochrone
    zleHosty = nowa;
    gotowe = true;
    zapiszCache();
    return true;
  } catch (err) {
    console.warn('[security] nie udalo sie pobrac listy zlosliwych domen (brak sieci?):', err.message);
    return false;
  }
}

/* Wolane raz przy starcie programu (patrz index.js). Cache z dysku wczytuje
   sie od razu, wiec ochrona dziala juz od pierwszej otwartej karty - swiezej
   listy z sieci program i tak nie zdazylby pobrac przed pokazaniem okna. */
function init() {
  const updatedAt = wczytajCache();
  if (!gotowe || Date.now() - updatedAt > ODSWIEZAJ_CO) odswiez().catch(() => {});
  setInterval(() => { odswiez().catch(() => {}); }, ODSWIEZAJ_CO);
}

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase();
  } catch (_) { return null; }
}

function naLiscie(host) {
  if (!host) return false;
  const bezWww = host.replace(/^www\./, '');
  return zleHosty.has(host) || zleHosty.has(`www.${bezWww}`) || zleHosty.has(bezWww);
}

/* ------------------------------------------------------------------ sprawdz */

function sprawdz(url) {
  const host = hostOf(url);
  if (naLiscie(host)) return { typ: 'malicious' };
  return null; // null = bezpieczne
}

function adresOstrzezenia(typ, target) {
  const params = new URLSearchParams({ typ, url: target });
  return `nazuna://warning/?${params.toString()}`;
}

module.exports = { init, sprawdz, adresOstrzezenia };
