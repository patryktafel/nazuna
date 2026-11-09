'use strict';
const path = require('path');
const fs = require('fs');
const { app, shell, dialog } = require('electron');
const data = require('./data');
const security = require('./security');

const active = new Map();      // id -> DownloadItem
let nextId = 1;
/* Pobrania z okien prywatnych. Trzymane tylko w pamieci, nigdy w
   downloads.json - inaczej nazwa pliku i adres, z ktorego go sciagnieto,
   zostawaly na dysku na zawsze, mimo ze cale okno prywatne mialo nie
   zostawiac po sobie sladu. Znikaja razem z zamknieciem programu. */
let prywatne = [];
let broadcast = () => {};

function setBroadcaster(fn) { broadcast = fn; }

/* Okno Nazuny, z ktorego wyszlo pobieranie (ustawiane z index.js). Okno
   "Zapisz jako" dostaje je jako rodzica, dzieki czemu Windows pokazuje je
   nad Nazuna, na tym samym monitorze. Domyslne okno Electrona dla kart w
   WebContentsView nie mialo rodzica i potrafilo wyskoczyc na innym ekranie,
   a nawet schowac sie pod oknem przegladarki. */
let oknoDla = () => null;
function ustawOknoDla(fn) { oknoDla = fn; }
/* Karta otwarta tylko po to, zeby cos pobrac (link w nowej karcie, ktory
   okazal sie plikiem), zostawala pusta. Tak jak Chrome - zamykamy ja.
   index.js podaje funkcje, ktora zna karty. */
let zamknijPustaKarte = () => {};
function ustawZamykaniePustejKarty(fn) { zamknijPustaKarte = fn; }

function defaultDir() {
  const custom = data.settings.get('downloadDir', '');
  if (custom && fs.existsSync(custom)) return custom;
  return app.getPath('downloads');
}

/* Pliki, ktore po dwukliku uruchamiaja kod. Takich nie zapisujemy po cichu.
   Druga czesc to typy, ktore Chrome tez uznaje za niebezpieczne: skroty i
   pliki Eksploratora (.url, .library-ms, .searchconnector-ms, .scf) potrafia
   wyslac hash hasla do obcego serwera juz przez samo lezenie w Pobranych,
   a obrazy dyskow (.iso, .vhd) i pomoc .chm przemycaja w srodku skrypty.
   Wpisy malymi literami - isRisky porownuje rozszerzenie po toLowerCase. */
const RISKY = new Set([
  '.exe', '.msi', '.msix', '.appx', '.bat', '.cmd', '.com', '.scr', '.pif', '.hta',
  '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.jar', '.reg',
  '.lnk', '.dll', '.cpl', '.msc', '.msp', '.gadget', '.apk', '.sh',
  '.url', '.library-ms', '.searchconnector-ms', '.scf', '.settingcontent-ms',
  '.appref-ms', '.application', '.xbap', '.chm', '.hlp', '.iso', '.img', '.vhd',
  '.vhdx', '.xll', '.msh', '.ws', '.wsc', '.sct', '.inf', '.ps1xml', '.psc1', '.mst'
]);

/** Nazwa pliku pochodzi ze strony, wiec nie moze wskazywac na inny katalog. */
function safeFilename(raw) {
  let name = path.basename(String(raw || '')).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim();
  name = name.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!name) name = 'plik';
  return name.slice(0, 180);
}

function isRisky(filename) {
  return RISKY.has(path.extname(filename).toLowerCase());
}

/* Sciezki, ktore juz komus przydzielilismy w tym uruchomieniu, ale plik dla
   nich moze jeszcze nie istniec na dysku (Electron tworzy go dopiero, gdy
   zaczna splywac bajty). Bez tego dwa pobierania rozpoczete niemal naraz, o
   tej samej nazwie, moglyby obie przejsc test fs.existsSync i dostac tak
   samo brzmiaca "wolna" sciezke - jedno z nich pozniej nadpisywaloby drugie. */
const zarezerwowane = new Set();

function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let n = 1;
  while (fs.existsSync(candidate) || zarezerwowane.has(candidate)) candidate = path.join(dir, `${base} (${n++})${ext}`);
  zarezerwowane.add(candidate);
  return candidate;
}

function serialise(item, record) {
  return {
    id: record.id,
    filename: record.filename,
    savePath: record.savePath,
    url: record.url,
    state: record.state,
    received: record.received,
    total: record.total,
    speed: record.speed,
    paused: record.paused,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    mime: record.mime,
    risky: !!record.risky,
    prywatne: !!record.prywatne
  };
}

/* Wpisy, ktore w downloads.json zostaly jako "w toku" albo "wstrzymane", choc
   po starcie programu nie ma juz za nimi zadnego pobierania (program zamknieto
   w trakcie, a 'done' nie zdazylo sie zapisac). Bez tego wisialy wiecznie jako
   trwajace: bez dzialajacych przyciskow, nie do usuniecia "Wyczysc liste" i
   z licznikiem na przycisku pobierania. Robimy to raz, przy pierwszym attach
   (sesja domyslna przy starcie), zanim cokolwiek zacznie sie pobierac. */
let porzadekPoStarcie = false;
function oznaczPrzerwanePoRestarcie() {
  if (porzadekPoStarcie) return;
  porzadekPoStarcie = true;
  try {
    let zmiana = false;
    for (const r of data.downloadsStore.data.items) {
      if ((r.state === 'progressing' || r.state === 'paused' || r.state === 'interrupted') && !active.has(r.id)) {
        // 'failed' - interfejs pokazuje "Nie udalo sie pobrac" i kosz
        r.state = 'failed';
        r.paused = false;
        r.speed = 0;
        zmiana = true;
      }
    }
    if (zmiana) data.downloadsStore.save();
  } catch (_) {}
}

/* Seria okien "Zapisz plik". Okno zapisu jest synchroniczne i na czas jego
   otwarcia staje caly proces glowny (wszystkie karty, pasek). Strona mogla
   klikac z JS ukryty link <a download="x.exe"> w petli i po kazdym "Anuluj"
   od razu dostawala kolejne okno - przegladarki nie dalo sie nawet zamknac.
   Dlatego po anulowaniu kolejne okno z tej samej karty pokazujemy dopiero po
   prawdziwym kliknieciu albo klawiszu w niej (jak przy wyskakujacych oknach
   w window.js), a bez tego pobranie przepada po cichu. Asynchroniczne okno
   odpada: setSavePath dziala tylko wewnatrz will-download. */
const GEST_MS = 5000;
const poAnulowaniu = new WeakMap(); // webContents (albo sesja) -> czas "Anuluj"
const gesty = new WeakMap();        // webContents -> czas ostatniego prawdziwego wejscia
const sledzone = new WeakSet();
function sledzGesty(wc) {
  if (!wc || sledzone.has(wc)) return;
  sledzone.add(wc);
  try {
    wc.on('before-input-event', (_e, input) => {
      if (input && input.type === 'keyDown' && input.key !== 'Escape') gesty.set(wc, Date.now());
    });
    wc.on('before-mouse-event', (_e, mysz) => {
      if (mysz && (mysz.type === 'mouseDown' || mysz.type === 'mouseUp')) gesty.set(wc, Date.now());
    });
  } catch (_) {}
}
function oknoZapisuDozwolone(klucz, wc) {
  const anulowano = poAnulowaniu.get(klucz);
  if (!anulowano) return true;
  const gest = wc ? gesty.get(wc) : 0;
  if (gest && gest > anulowano && Date.now() - gest < GEST_MS) {
    poAnulowaniu.delete(klucz); // jedno klikniecie = jedno okno
    return true;
  }
  return false;
}

/* Pobranie zlecone z menu Nazuny ("Zapisz obraz/link/strone jako") to tez
   swiadomy wybor uzytkownika, choc klik trafil w pasek, a nie w karte. */
function oznaczGest(wc) { if (wc) gesty.set(wc, Date.now()); }

/* "Zapisz obraz/link/strone jako..." z menu kontekstowego: zawsze okno zapisu
   Windows (miejsce, nazwa, typ), niezaleznie od ustawienia "pytaj, gdzie
   zapisac" - tak jak w Chrome i Firefoksie. Znacznik dotyczy jednej karty i
   najblizszego pobrania z niej w ciagu kilkunastu sekund. */
const zapiszJakoZnacznik = new WeakMap();
const ZAPISZ_JAKO_MS = 15000;
function zapiszJako(wc) {
  if (!wc) return;
  gesty.set(wc, Date.now());
  zapiszJakoZnacznik.set(wc, Date.now());
}
function czyZapiszJako(wc) {
  if (!wc) return false;
  const t = zapiszJakoZnacznik.get(wc);
  if (!t) return false;
  zapiszJakoZnacznik.delete(wc);
  return Date.now() - t < ZAPISZ_JAKO_MS;
}

/* Obrazy z wyszukiwarek (np. Google Grafika) czesto maja adres bez
   rozszerzenia ("images?q=..."), wiec plik dostawal nazwe bez typu. Dokladamy
   rozszerzenie z typu MIME. */
const ROZSZERZENIA_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico', 'video/mp4': 'mp4', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'application/pdf': 'pdf', 'text/html': 'html'
};
function zRozszerzeniem(filename, mime) {
  if (path.extname(filename)) return filename;
  const ext = ROZSZERZENIA_MIME[String(mime || '').split(';')[0].trim().toLowerCase()];
  return ext ? `${filename}.${ext}` : filename;
}

/* Ile pobieran naprawde trwa (do pytania przy zamykaniu programu). */
function ileAktywnych() { return active.size; }

function attach(session) {
  oznaczPrzerwanePoRestarcie();
  session.on('will-download', (event, item, webContents) => {
    setImmediate(() => { try { zamknijPustaKarte(webContents); } catch (_) {} });
    // Ten sam mechanizm co ostrzezenia przy nawigacji (security.js), tylko
    // bez pytania - plik z listy zlosliwych domen po prostu sie nie sciaga,
    // z krotkim powiadomieniem w rogu okna zamiast pelnoekranowego ostrzezenia
    // (pobieranie nie ma wlasnej karty, ktora moglaby je pokazac).
    const zrodlo = item.getURL();
    if (security.jestZlosliwy(zrodlo)) {
      event.preventDefault();
      let host = '';
      try { host = new URL(zrodlo).hostname; } catch (_) {}
      broadcast('download-blocked', { filename: safeFilename(item.getFilename()), host });
      return;
    }

    const id = `d${Date.now().toString(36)}${nextId++}`;
    let prywatna = false;
    try { prywatna = !session.isPersistent(); } catch (_) {}
    const dir = defaultDir();
    const filename = safeFilename(zRozszerzeniem(item.getFilename(), item.getMimeType()));
    const risky = isRisky(filename);
    const jako = czyZapiszJako(webContents);

    // Plik wykonywalny zawsze przechodzi przez okno zapisu, zeby nie wladowal
    // sie do Pobranych bez twojej wiedzy. "Zapisz ... jako" z menu - tez.
    if (!risky && !jako && !data.settings.get('askWhereToSave', false)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      item.setSavePath(uniquePath(dir, filename));
    } else {
      let rodzic = null;
      try { rodzic = oknoDla(webContents); } catch (_) {}
      const klucz = webContents || session;
      sledzGesty(webContents);
      if (!oknoZapisuDozwolone(klucz, webContents)) { event.preventDefault(); return; }
      if (rodzic) {
        const ext = path.extname(filename).replace(/^\./, '');
        const wybor = dialog.showSaveDialogSync(rodzic, {
          title: jako ? 'Zapisz jako' : 'Zapisz plik',
          defaultPath: path.join(dir, filename),
          filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Wszystkie pliki', extensions: ['*'] }] : []
        });
        // Anulowane okno zapisu = brak pobierania, tak jak w Chrome.
        if (!wybor) { poAnulowaniu.set(klucz, Date.now()); event.preventDefault(); return; }
        poAnulowaniu.delete(klucz);
        item.setSavePath(wybor);
      }
      // Bez znanego okna zostaje domyslne okno zapisu Electrona.
    }

    const record = {
      id,
      filename,
      url: item.getURL(),
      mime: item.getMimeType(),
      savePath: item.getSavePath(),
      state: 'progressing',
      received: 0,
      total: item.getTotalBytes(),
      speed: 0,
      paused: false,
      startedAt: Date.now(),
      finishedAt: null,
      risky,
      prywatne: prywatna
    };

    active.set(id, item);
    item.__nazunaId = id;
    if (prywatna) {
      prywatne.unshift(record);
      if (prywatne.length > 200) prywatne.length = 200;
    } else {
      data.downloadsStore.data.items.unshift(record);
      if (data.downloadsStore.data.items.length > 500) data.downloadsStore.data.items.length = 500;
      data.downloadsStore.save();
    }
    const zapisz = (odRazu) => {
      if (prywatna) return;
      if (odRazu) data.downloadsStore.flush(); else data.downloadsStore.save();
    };
    broadcast('download-started', serialise(item, record));

    let lastBytes = 0;
    let lastTime = Date.now();

    item.on('updated', (_e, state) => {
      record.savePath = item.getSavePath();
      record.filename = path.basename(record.savePath || record.filename) || record.filename;
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      record.paused = item.isPaused();
      record.state = state === 'interrupted' ? 'interrupted' : (record.paused ? 'paused' : 'progressing');
      const now = Date.now();
      if (now - lastTime > 400) {
        record.speed = Math.max(0, (record.received - lastBytes) / ((now - lastTime) / 1000));
        lastBytes = record.received;
        lastTime = now;
      }
      zapisz(false);
      broadcast('download-updated', serialise(item, record));
    });

    item.once('done', (_e, state) => {
      record.state = state === 'completed' ? 'completed' : (state === 'cancelled' ? 'cancelled' : 'failed');
      record.savePath = item.getSavePath();
      record.filename = path.basename(record.savePath || record.filename) || record.filename;
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes() || record.received;
      record.finishedAt = Date.now();
      record.speed = 0;
      active.delete(id);
      // Jesli sie udalo, plik juz jest na dysku i fs.existsSync go zlapie sam.
      // Jesli nie, zwalniamy sciezke, zeby kolejne pobranie moglo jej uzyc.
      zarezerwowane.delete(record.savePath);
      zapisz(true);
      broadcast('download-done', serialise(item, record));
    });
  });
}

/* Okno prywatne widzi tez swoje pobrania, zwykle okno tylko zwykle. */
function list(zPrywatnymi = false) {
  const zwykle = data.downloadsStore.data.items;
  if (!zPrywatnymi || !prywatne.length) return zwykle;
  return [...prywatne, ...zwykle].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

function control(id, action, zPrywatnymi = false) {
  const item = active.get(id);
  const record = data.downloadsStore.data.items.find((r) => r.id === id) || prywatne.find((r) => r.id === id);
  switch (action) {
    case 'pause': if (item) item.pause(); break;
    case 'resume': if (item && item.canResume()) item.resume(); break;
    case 'cancel': if (item) item.cancel(); break;
    case 'open':
      if (record && record.savePath && fs.existsSync(record.savePath)) shell.openPath(record.savePath);
      break;
    case 'folder':
      if (record && record.savePath && fs.existsSync(record.savePath)) shell.showItemInFolder(record.savePath);
      break;
    case 'remove':
      // Trwajace pobranie znika z listy dopiero po anulowaniu - inaczej
      // dalej by sie sciagalo, tylko bez zadnej mozliwosci zatrzymania.
      if (item) item.cancel();
      data.downloadsStore.data.items = data.downloadsStore.data.items.filter((r) => r.id !== id);
      prywatne = prywatne.filter((r) => r.id !== id);
      data.downloadsStore.flush();
      break;
    default: break;
  }
  return list(zPrywatnymi);
}

function clearFinished(zPrywatnymi = false) {
  // Trwa tylko to, za czym stoi zywe pobieranie - sam stan z pliku moze byc
  // nieaktualny po zamknieciu programu w trakcie.
  const trwa = (r) => active.has(r.id);
  data.downloadsStore.data.items = data.downloadsStore.data.items.filter(trwa);
  prywatne = prywatne.filter(trwa);
  data.downloadsStore.flush();
  return list(zPrywatnymi);
}

async function chooseDir(parentWindow) {
  const res = await dialog.showOpenDialog(parentWindow, {
    title: 'Folder pobierania',
    defaultPath: defaultDir(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  data.settings.set('downloadDir', res.filePaths[0]);
  return res.filePaths[0];
}

module.exports = { ustawOknoDla, ustawZamykaniePustejKarty, attach, list, control, clearFinished, setBroadcaster, defaultDir, chooseDir, ileAktywnych, oznaczGest, zapiszJako };
