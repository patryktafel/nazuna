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
   Zrodla: projekt malware-filter (darmowe, publiczne listy w formacie "hosts",
   0.0.0.0 <host>, odswiezane co kilka godzin):
   - urlhaus-filter: hosty rozsylajace zlosliwe oprogramowanie (dane URLhaus,
     abuse.ch). Wczesniej brane wprost z urlhaus.abuse.ch/downloads/hostfile/,
     ale abuse.ch wylaczyl ten adres (410 Gone, listopad 2026).
   - phishing-filter: strony wyludzajace hasla i dane (OpenPhish, PhishTank).
   Kazda lista ma kilka lustrzanych adresow - gdy pierwszy nie odpowiada,
   bierzemy nastepny. Ten sam pomysl co w blokerze reklam (adblock.js), tylko
   inny cel: tam ukrywanie reklam, tu ostrzezenie przed wejsciem. */
const ZRODLA_HOSTOW = [
  [
    'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts.txt',
    'https://curbengh.github.io/malware-filter/urlhaus-filter-hosts.txt',
    'https://malware-filter.pages.dev/urlhaus-filter-hosts.txt'
  ],
  [
    'https://malware-filter.gitlab.io/malware-filter/phishing-filter-hosts.txt',
    'https://curbengh.github.io/malware-filter/phishing-filter-hosts.txt',
    'https://malware-filter.pages.dev/phishing-filter-hosts.txt'
  ]
];
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

/* Jedna lista: kolejne lustra, az ktores odda niepusta liste. null = zadne. */
async function pobierzListe(adresy) {
  for (const adres of adresy) {
    try {
      const odp = await fetch(adres, { signal: AbortSignal.timeout(30000) });
      if (!odp.ok) { console.warn('[security]', adres, 'odpowiedzial', odp.status); continue; }
      const lista = parsujHostfile(await odp.text());
      if (lista.size) return lista;
    } catch (err) {
      console.warn('[security] nie udalo sie pobrac', adres, err.message);
    }
  }
  return null;
}

async function pobierz() {
  try {
    const nowa = new Set();
    for (const adresy of ZRODLA_HOSTOW) {
      const lista = await pobierzListe(adresy);
      // Gdy ktorejs listy nie da sie pobrac, zostajemy przy starej calosci -
      // lepiej lekko nieswieza lista niz nagle pol ochrony.
      if (!lista) return false;
      for (const h of lista) nowa.add(h);
    }
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
    return ok ? { ok: true } : { ok: false, reason: 'nie udało się pobrać listy (serwer nie odpowiada albo brak internetu)' };
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

/* Ruch do wlasnego komputera nigdy nie wychodzi do sieci, wiec brak
   szyfrowania niczego tu nie odslania - Chrome tez traktuje localhost jako
   bezpieczny. Bez tego kazdy lokalny serwer (np. podglad strony w trakcie
   pisania) zaczynal sie od ostrzezenia. */
function lokalny(host) {
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function sprawdz(url) {
  if (!data.settings.get('securityWarningsEnabled', true)) return null;
  const r = rozbierz(url);
  if (!r) return null;
  if (naLiscie(r.host)) return { typ: 'malicious' };
  if (r.http && !lokalny(r.host) && !data.httpZaakceptowany(r.host)) return { typ: 'insecure' };
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
function zapamietajWyjatek(typ, url, prywatnie = false) {
  if (typ !== 'insecure') return;
  const r = rozbierz(url);
  if (r) data.zaakceptujHttp(r.host, prywatnie);
}

function adresOstrzezenia(typ, target) {
  const params = new URLSearchParams({ typ, url: target });
  return `nazuna://warning/?${params.toString()}`;
}

module.exports = { init, sprawdz, jestZlosliwy, zapamietajWyjatek, adresOstrzezenia, status, refresh, lokalny };
