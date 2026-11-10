/* Przenoszenie zakladek z innych przegladarek (kreator powitalny i Ustawienia).

   Czytamy tylko pliki zakladek na tym komputerze, nic nie idzie do sieci:
   - Chrome, Edge, Brave, Vivaldi, Opera (silnik Chromium): plik JSON "Bookmarks"
     w folderze profilu - czytelny takze przy wlaczonej przegladarce.
   - Firefox: baza places.sqlite. Firefox trzyma ja otwarta, wiec kopiujemy ja
     (z plikiem -wal) do folderu tymczasowego i czytamy kopie (node:sqlite).
   Pasek zakladek trafia na pasek Nazuny (gdy pusty - wprost, inaczej do
   folderu "Z <przegladarki>"), reszta do menu zakladek, w folderze
   "Z <przegladarki>". Foldery zostaja, adresy juz obecne w tym miejscu sa
   pomijane, zakladki inne niz http(s) (np. javascript:) tez - z bezpieczenstwa.
   Renderer podaje tylko id z listy wykryj(); sciezek z zewnatrz nie
   przyjmujemy. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const data = require('./data');

const MAC = process.platform === 'darwin';
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
/* macOS: wszystkie przegladarki trzymaja profile w ~/Library/Application Support,
   foldery profili (Default, Profile N) i pliki maja te same nazwy co w Windows. */
const MAC_AS = path.join(os.homedir(), 'Library', 'Application Support');

const CHROMIUMY = MAC ? [
  { klucz: 'chrome', nazwa: 'Chrome', dir: path.join(MAC_AS, 'Google', 'Chrome') },
  { klucz: 'edge', nazwa: 'Edge', dir: path.join(MAC_AS, 'Microsoft Edge') },
  { klucz: 'brave', nazwa: 'Brave', dir: path.join(MAC_AS, 'BraveSoftware', 'Brave-Browser') },
  { klucz: 'vivaldi', nazwa: 'Vivaldi', dir: path.join(MAC_AS, 'Vivaldi') }
] : [
  { klucz: 'chrome', nazwa: 'Chrome', dir: path.join(LOCAL, 'Google', 'Chrome', 'User Data') },
  { klucz: 'edge', nazwa: 'Edge', dir: path.join(LOCAL, 'Microsoft', 'Edge', 'User Data') },
  { klucz: 'brave', nazwa: 'Brave', dir: path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data') },
  { klucz: 'vivaldi', nazwa: 'Vivaldi', dir: path.join(LOCAL, 'Vivaldi', 'User Data') }
];
const OPERY = MAC ? [
  { klucz: 'opera', nazwa: 'Opera', dir: path.join(MAC_AS, 'com.operasoftware.Opera') },
  { klucz: 'operagx', nazwa: 'Opera GX', dir: path.join(MAC_AS, 'com.operasoftware.OperaGX') }
] : [
  { klucz: 'opera', nazwa: 'Opera', dir: path.join(ROAMING, 'Opera Software', 'Opera Stable') },
  { klucz: 'operagx', nazwa: 'Opera GX', dir: path.join(ROAMING, 'Opera Software', 'Opera GX Stable') }
];
const FIREFOX_PROFILE = MAC
  ? path.join(MAC_AS, 'Firefox', 'Profiles')
  : path.join(ROAMING, 'Mozilla', 'Firefox', 'Profiles');

function dozwolonyAdres(url) {
  try { const u = new URL(String(url || '')); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (_) { return false; }
}
function policz(wezly) {
  let n = 0;
  for (const w of wezly || []) n += w.typ === 'link' ? 1 : policz(w.dzieci);
  return n;
}

/* ------------------------------------------------------------ Chromium */
function drzewoChromium(wezel) {
  const wynik = [];
  for (const w of (wezel && wezel.children) || []) {
    if (w.type === 'url' && dozwolonyAdres(w.url)) wynik.push({ typ: 'link', tytul: String(w.name || ''), url: String(w.url) });
    else if (w.type === 'folder') {
      const dzieci = drzewoChromium(w);
      if (dzieci.length) wynik.push({ typ: 'folder', tytul: String(w.name || 'Folder'), dzieci });
    }
  }
  return wynik;
}
function czytajChromium(plik) {
  const json = JSON.parse(fs.readFileSync(plik, 'utf8'));
  const r = json.roots || {};
  return {
    pasek: drzewoChromium(r.bookmark_bar),
    menu: [...drzewoChromium(r.other), ...drzewoChromium(r.synced)]
  };
}
function nazwyProfiliChromium(userData) {
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(userData, 'Local State'), 'utf8'));
    return (ls.profile && ls.profile.info_cache) || {};
  } catch (_) { return {}; }
}
function wykryjChromium(lista) {
  for (const p of CHROMIUMY) {
    let foldery = [];
    try { foldery = fs.readdirSync(p.dir).filter((f) => f === 'Default' || /^Profile \d+$/.test(f)); } catch (_) { continue; }
    const nazwy = nazwyProfiliChromium(p.dir);
    for (const f of foldery) {
      const plik = path.join(p.dir, f, 'Bookmarks');
      if (!fs.existsSync(plik)) continue;
      lista.push({ id: `${p.klucz}:${f}`, przegladarka: p.nazwa, profil: (nazwy[f] && nazwy[f].name) || '', czytaj: () => czytajChromium(plik) });
    }
  }
  for (const p of OPERY) {
    const plik = path.join(p.dir, 'Bookmarks');
    if (fs.existsSync(plik)) lista.push({ id: p.klucz, przegladarka: p.nazwa, profil: '', czytaj: () => czytajChromium(plik) });
  }
}

/* ------------------------------------------------------------- Firefox */
function czytajFirefox(folderProfilu) {
  const { DatabaseSync } = require('node:sqlite');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nazuna-import-'));
  try {
    for (const f of ['places.sqlite', 'places.sqlite-wal']) {
      const z = path.join(folderProfilu, f);
      if (fs.existsSync(z)) fs.copyFileSync(z, path.join(tmp, f));
    }
    const db = new DatabaseSync(path.join(tmp, 'places.sqlite'));
    let wiersze;
    try {
      wiersze = db.prepare(`SELECT b.id, b.type, b.parent, b.position, b.title, b.guid, p.url
        FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position`).all();
    } finally { db.close(); }
    const dzieci = new Map();
    for (const w of wiersze) {
      if (!dzieci.has(w.parent)) dzieci.set(w.parent, []);
      dzieci.get(w.parent).push(w);
    }
    const zbuduj = (id) => {
      const wynik = [];
      for (const w of dzieci.get(id) || []) {
        if (w.type === 1 && dozwolonyAdres(w.url)) wynik.push({ typ: 'link', tytul: String(w.title || w.url), url: String(w.url) });
        else if (w.type === 2) {
          const d = zbuduj(w.id);
          if (d.length) wynik.push({ typ: 'folder', tytul: String(w.title || 'Folder'), dzieci: d });
        }
      }
      return wynik;
    };
    const korzen = (guid) => { const w = wiersze.find((x) => x.guid === guid); return w ? zbuduj(w.id) : []; };
    return {
      pasek: korzen('toolbar_____'),
      menu: [...korzen('menu________'), ...korzen('unfiled_____'), ...korzen('mobile______')]
    };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}
function wykryjFirefox(lista) {
  let foldery = [];
  try { foldery = fs.readdirSync(FIREFOX_PROFILE); } catch (_) { return; }
  for (const f of foldery) {
    const folder = path.join(FIREFOX_PROFILE, f);
    if (!fs.existsSync(path.join(folder, 'places.sqlite'))) continue;
    // "abcd1234.default-release" -> "default-release"
    lista.push({ id: `firefox:${f}`, przegladarka: 'Firefox', profil: f.replace(/^[^.]*\./, ''), czytaj: () => czytajFirefox(folder) });
  }
}

/* --------------------------------------------------------------- publiczne */
function znajdz() {
  const lista = [];
  wykryjChromium(lista);
  wykryjFirefox(lista);
  return lista;
}

/* Lista do pokazania: tylko zrodla, w ktorych naprawde sa jakies zakladki. */
function wykryj() {
  const wynik = [];
  for (const z of znajdz()) {
    try {
      const d = z.czytaj();
      const liczba = policz(d.pasek) + policz(d.menu);
      if (liczba) wynik.push({ id: z.id, przegladarka: z.przegladarka, profil: z.profil, liczba });
    } catch (err) {
      console.warn('[import] nie moge odczytac', z.id, err.message);
    }
  }
  return wynik;
}

function wstaw(wezly, parent, zbior, licznik) {
  for (const w of wezly) {
    if (w.typ === 'link') {
      if (zbior.has(w.url)) { licznik.pominiete++; continue; }
      zbior.add(w.url);
      data.addBookmark({ title: w.tytul || w.url, url: w.url, parent });
      licznik.dodane++;
    } else {
      const f = data.addFolder(w.tytul, parent);
      const przed = licznik.dodane;
      wstaw(w.dzieci, f.id, zbior, licznik);
      // Same powtorki (np. drugi import) - nie zostawiamy pustego folderu.
      if (licznik.dodane === przed) data.removeBookmark(f.id);
    }
  }
}

function importuj(id) {
  const z = znajdz().find((x) => x.id === id);
  if (!z) return { ok: false, powod: 'Nie znaleziono tej przeglądarki' };
  let d;
  try { d = z.czytaj(); } catch (err) { return { ok: false, powod: 'Nie udało się odczytać zakładek' }; }
  const licznik = { dodane: 0, pominiete: 0 };
  const nazwaFolderu = `Z ${z.przegladarka}${z.profil && z.profil !== 'default-release' ? ` (${z.profil})` : ''}`;
  const juzWMiejscu = (gdzie) => new Set(data.bookmarkList()
    .filter((b) => b.type === 'link' && data.miejsceZakladki(b.parent) === gdzie).map((b) => b.url));
  if (d.pasek.length) {
    const naPasku = juzWMiejscu('bar');
    const pustyPasek = !data.bookmarkList().some((b) => b.parent === 'bar');
    const cel = pustyPasek ? 'bar' : data.addFolder(nazwaFolderu, 'bar').id;
    const przed = licznik.dodane;
    wstaw(d.pasek, cel, naPasku, licznik);
    if (cel !== 'bar' && licznik.dodane === przed) data.removeBookmark(cel);
  }
  if (d.menu.length) {
    const wMenu = juzWMiejscu('menu');
    const folder = data.addFolder(nazwaFolderu, 'menu');
    const przed = licznik.dodane;
    wstaw(d.menu, folder.id, wMenu, licznik);
    if (licznik.dodane === przed) data.removeBookmark(folder.id);
  }
  return { ok: true, ...licznik };
}

module.exports = { wykryj, importuj };
