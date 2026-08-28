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
  tabStrip: 40,
  toolbar: 46,
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

const SEARCH_ENGINES = {
  google: { name: 'Google', search: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=chrome&q=%s' },
  duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?q=%s&type=list' },
  bing: { name: 'Bing', search: 'https://www.bing.com/search?q=%s', suggest: 'https://www.bing.com/osjson.aspx?query=%s' },
  brave: { name: 'Brave Search', search: 'https://search.brave.com/search?q=%s', suggest: null },
  startpage: { name: 'Startpage', search: 'https://www.startpage.com/sp/search?query=%s', suggest: null }
};

/* Ustawienie moze brzmiec "jak w systemie", a interfejs potrzebuje konkretu.
   Tu zamieniamy je na jedna z dwoch realnych odpowiedzi. */
function rozstrzygnijMotyw(ustawienie) {
  if (ustawienie === 'light') return 'jasny';
  if (ustawienie === 'dark') return 'ciemny';
  try { return nativeTheme.shouldUseDarkColors ? 'ciemny' : 'jasny'; } catch (_) { return 'ciemny'; }
}

// Tla malowane po stronie okna, zanim strona zdazy sie wyrysowac. Bez tego
// przy kazdym otwarciu karty mrugaloby przeciwnym kolorem.
const TLA = {
  ciemny: { okno: '#0e0f13', wewnetrzne: '#0e0f13' },
  jasny:  { okno: '#f5f6fa', wewnetrzne: '#f5f6fa' }
};

function resourcesDir() {
  return app.isPackaged ? process.resourcesPath : path.join(ROOT, 'resources');
}

module.exports = { ROOT, UI_DIR, PRELOAD_DIR, ASSETS_DIR, APP_NAME, LAYOUT, chromeUserAgent, acceptLanguages, rozstrzygnijMotyw, TLA, SEARCH_ENGINES, resourcesDir };
