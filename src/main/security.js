'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const data = require('./data');

/* --------------------------------------------------------------------
   Wspolny punkt bezpieczenstwa nawigacji. Kazda proba wejscia na strone -
   z paska adresu, z klikniecia linku, z nowej karty i z przekierowania -
   przechodzi przez sprawdz(), zanim cokolwiek sie zaladuje (patrz
   window.js, metoda Tab.otworz). Dzieki jednemu wspolnemu miejscu zadna
   z tych sciezek nie moze przypadkiem ominac sprawdzenia.

     etap 1 - mechanizm i strona ostrzegawcza (nazuna://warning) - gotowe
     etap 2 - lista znanych zlosliwych domen (phishing, malware) - gotowe
     etap 3 - ostrzezenie o polaczeniu bez szyfrowania (http) - ponizej */

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
let updatedAt = 0;
let updating = false;

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
      updatedAt = surowe.updatedAt || 0;
    }
  } catch (_) { /* pierwszy start - jeszcze nie ma cache */ }
}

function zapiszCache() {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify({ updatedAt, hosty: [...zleHosty] }));
  } catch (err) {
    console.warn('[security] nie moge zapisac cache listy zlosliwych domen:', err.message);
  }
}

async function pobierz() {
  try {
    const odp = await fetch(ZRODLO_HOSTOW);
    if (!odp.ok) return false;
    const tekst = await odp.text();
    const nowa = parsujHostfile(tekst);
    if (!nowa.size) return false; // pusta odpowiedz - lepiej zostac przy starej liscie niz wyzerowac ochrone
    zleHosty = nowa;
    gotowe = true;
    updatedAt = Date.now();
    zapiszCache();
    return true;
  } catch (err) {
    console.warn('[security] nie udalo sie pobrac listy zlosliwych domen (brak sieci?):', err.message);
    return false;
  }
}

/* Ta sama logika co adblock.refresh() - jedno miejsce chroni przed dwoma
   pobieraniami naraz, force=true (przycisk "Zaktualizuj teraz" w Ustawieniach)
   pomija sprawdzanie "czy lista jest jeszcze swieza". */
async function refresh(force) {
  if (updating) return { ok: false, reason: 'trwa aktualizacja' };
  if (!force && gotowe && Date.now() - updatedAt < ODSWIEZAJ_CO) return { ok: false, reason: 'lista jest aktualna' };
  updating = true;
  try {
    const ok = await pobierz();
    return ok ? { ok: true } : { ok: false, reason: 'nie udało się pobrać (brak sieci?)' };
  } finally {
    updating = false;
  }
}

function status() {
  return { ready: gotowe, updatedAt, count: zleHosty.size, updating };
}

/* Wolane raz przy starcie programu (patrz index.js). Cache z dysku wczytuje
   sie od razu, wiec ochrona dziala juz od pierwszej otwartej karty - swiezej
   listy z sieci program i tak nie zdazylby pobrac przed pokazaniem okna. */
function init() {
  wczytajCache();
  if (!gotowe || Date.now() - updatedAt > ODSWIEZAJ_CO) refresh(false).catch(() => {});
  setInterval(() => { refresh(false).catch(() => {}); }, ODSWIEZAJ_CO);
}

function rozbierz(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { http: u.protocol === 'http:', host: u.hostname.toLowerCase() };
  } catch (_) { return null; }
}

function naLiscie(host) {
  if (!host) return false;
  const bezWww = host.replace(/^www\./, '');
  return zleHosty.has(host) || zleHosty.has(`www.${bezWww}`) || zleHosty.has(bezWww);
}

/* ---------------------------------------------------------- ostrzezenie http
   Zwykle http, bez szyfrowania. Tu, w odroznieniu od zlosliwych domen,
   pytamy tylko raz na domene - po kliknieciu "przejdz mimo to" strona laduje
   sie normalnie przy kolejnych wizytach (patrz zapamietajWyjatek nizej).
   Osobna etykieta "Niezabezpieczona" w pasku adresu (shell.js) dziala
   niezaleznie od tego wyjatku i pokazuje sie zawsze na http. */

/* ------------------------------------------------------------------ sprawdz */

function sprawdz(url) {
  if (!data.settings.get('securityWarningsEnabled', true)) return null;
  const r = rozbierz(url);
  if (!r) return null;
  if (naLiscie(r.host)) return { typ: 'malicious' };
  if (r.http && !data.httpZaakceptowany(r.host)) return { typ: 'insecure' };
  return null; // null = bezpieczne
}

/* Wolane przez downloads.js dla kazdego pobierania, osobno od sprawdz() -
   pobrany plik sprawdzamy tylko wobec listy zlosliwych domen, nie wobec
   http (zwykle pobieranie plikow po http to nic niezwyklego i nie ma tu co
   ostrzegac tak jak przy calej stronie). */
function jestZlosliwy(url) {
  if (!data.settings.get('securityWarningsEnabled', true)) return false;
  const r = rozbierz(url);
  return !!(r && naLiscie(r.host));
}

/* Wolane, gdy uzytkownik kliknie "przejdz mimo to" na nazuna://warning
   (patrz ipc.js, 'security.proceed'). Zlosliwych domen to nie dotyczy -
   tam ostrzezenie ma wracac za kazdym razem. */
function zapamietajWyjatek(typ, url) {
  if (typ !== 'insecure') return;
  const r = rozbierz(url);
  if (r) data.zaakceptujHttp(r.host);
}

function adresOstrzezenia(typ, target) {
  const params = new URLSearchParams({ typ, url: target });
  return `nazuna://warning/?${params.toString()}`;
}

module.exports = { init, sprawdz, jestZlosliwy, zapamietajWyjatek, adresOstrzezenia, status, refresh };
