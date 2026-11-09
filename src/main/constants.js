'use strict';
const path = require('path');
const { app, nativeTheme } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
const UI_DIR = path.join(__dirname, '..', 'ui');
const PRELOAD_DIR = path.join(__dirname, '..', 'preload');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const APP_NAME = 'Nazuna';

// Wymiary interfejsu przegladarki, w pikselach CSS.
const LAYOUT = {
  tabStrip: 44,
  toolbar: 48,
  bookmarksBar: 34,
  findBar: 44
};

// Czysty User-Agent Chrome'a. Domyslny Electrona zdradza "Electron/x.y" i
// "Nazuna/0.1.5", przez co Google (i kilka innych stron) odmawia logowania.
// Ustawiamy go tez jako app.userAgentFallback, zeby zaden kanal w programie nie
// wysylal wersji z nazwa Electrona. Do wersji 0.1.5 wyciekala ona przy ikonach
// stron pobieranych przez pasek zakladek.
function chromeUserAgent() {
  const major = (process.versions.chrome || '120.0.0.0').split('.')[0];
  // Wizytowka musi zgadzac sie z systemem, na ktorym naprawde stoimy. Gdyby
  // przegladarka na Macu twierdzila, ze siedzi na Windowsie, powstalaby ta sama
  // niespojnosc, przez ktora Google odmawial logowania do 0.1.6.
  // Chrome na Macach z procesorem Apple podaje "Intel Mac OS X 10_15_7" i nie
  // zmienia tego od lat, wiec robimy tak samo.
  let system = 'Windows NT 10.0; Win64; x64';
  if (process.platform === 'darwin') system = 'Macintosh; Intel Mac OS X 10_15_7';
  else if (process.platform !== 'win32') system = 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

// Lista jezykow w kolejnosci preferencji, zbudowana z ustawien systemu.
// Chromium sam dopisze wagi q, wiec podajemy same kody. Bez tego przegladarka
// prosila wszedzie o en-US, niezaleznie od tego, po jakiemu mowi uzytkownik.
function acceptLanguages() {
  let locale = '';
  try { locale = String(app.getLocale() || ''); } catch (_) {}
  if (!locale) locale = 'en-US';
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  push(locale);
  const base = locale.split('-')[0];
  push(base);
  push('en-US');
  push('en');
  return out.join(',');
}

/* Dostawcy DNS-over-HTTPS do wyboru w Ustawieniach > Prywatnosc sieciowa.
   "template" to adres, pod ktory Chromium wysyla zapytania DNS szyfrowane
   przez HTTPS zamiast zwyklym, jawnym tekstem UDP - dzieki temu dostawca
   internetu (i kazdy po drodze) widzi tylko, ze laczysz sie z serwerem DNS,
   a nie jakich domen pytasz. */
const DOH_PROVIDERS = {
  cloudflare: { name: 'Cloudflare', template: 'https://cloudflare-dns.com/dns-query' },
  google: { name: 'Google', template: 'https://dns.google/dns-query' },
  quad9: { name: 'Quad9', template: 'https://dns.quad9.net/dns-query' }
};

const SEARCH_ENGINES = {
  google: { name: 'Google', search: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=chrome&q=%s' },
  duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?q=%s&type=list' },
  bing: { name: 'Bing', search: 'https://www.bing.com/search?q=%s', suggest: 'https://www.bing.com/osjson.aspx?query=%s' },
  brave: { name: 'Brave Search', search: 'https://search.brave.com/search?q=%s', suggest: null },
  startpage: { name: 'Startpage', search: 'https://www.startpage.com/sp/search?query=%s', suggest: null }
};

/* Ustawienie moze brzmiec "jak w systemie", a interfejs potrzebuje konkretu.
   Tu zamieniamy je na jedna z dwoch realnych odpowiedzi. */
/* Motyw, ktory faktycznie widac. Lawendowa mgla ma jedna, ciemna palete,
   wiec ustawienie jasny/ciemny/system dotyczy tylko wygladu Klasyczny.
   Washi zwraca 'mgla' (ten sam uklad), papierowe kolory daje data-washi. */
function rozstrzygnijMotyw(ustawienie, wyglad = 'mgla') {
  if (wyglad !== 'klasyczny') return 'mgla';
  if (ustawienie === 'light') return 'jasny';
  if (ustawienie === 'dark') return 'ciemny';
  try { return nativeTheme.shouldUseDarkColors ? 'ciemny' : 'jasny'; } catch (_) { return 'ciemny'; }
}

/* Co mowimy stronom w prefers-color-scheme (nativeTheme.themeSource). Strony
   z wlasnym ciemnym trybem (Google, YouTube, Reddit...) przelaczaja sie wtedy
   same. Domyslnie jak w Windowsie, przy kazdym wygladzie Nazuny; uzytkownik
   przelacza jasne/ciemne przyciskiem slonca/ksiezyca na pasku. */
function zrodloMotywuStron(motywStron) {
  return motywStron === 'light' || motywStron === 'dark' ? motywStron : 'system';
}

// Tla malowane po stronie okna, zanim strona zdazy sie wyrysowac. Bez tego
// przy kazdym otwarciu karty mrugaloby przeciwnym kolorem.
const TLA = {
  ciemny: { okno: '#0e0f13', wewnetrzne: '#0e0f13' },
  jasny:  { okno: '#f5f6fa', wewnetrzne: '#f5f6fa' },
  mgla:   { okno: '#1b1830', wewnetrzne: '#1b1830' },
  washi:  { okno: '#f6f1e7', wewnetrzne: '#f6f1e7' },
  washiNoc: { okno: '#08070a', wewnetrzne: '#08070a' }
};

function resourcesDir() {
  return app.isPackaged ? process.resourcesPath : path.join(ROOT, 'resources');
}

module.exports = { ROOT, UI_DIR, PRELOAD_DIR, ASSETS_DIR, APP_NAME, LAYOUT, chromeUserAgent, acceptLanguages, rozstrzygnijMotyw, zrodloMotywuStron, TLA, SEARCH_ENGINES, DOH_PROVIDERS, resourcesDir };
