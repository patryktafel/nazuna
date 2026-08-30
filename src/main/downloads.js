'use strict';
const path = require('path');
const fs = require('fs');
const { app, shell, dialog } = require('electron');
const data = require('./data');
const security = require('./security');

const active = new Map();      // id -> DownloadItem
let nextId = 1;
let broadcast = () => {};

function setBroadcaster(fn) { broadcast = fn; }

function defaultDir() {
  const custom = data.settings.get('downloadDir', '');
  if (custom && fs.existsSync(custom)) return custom;
  return app.getPath('downloads');
}

/* Pliki, ktore po dwukliku uruchamiaja kod. Takich nie zapisujemy po cichu. */
const RISKY = new Set([
  '.exe', '.msi', '.msix', '.appx', '.bat', '.cmd', '.com', '.scr', '.pif', '.hta',
  '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.jar', '.reg',
  '.lnk', '.dll', '.cpl', '.msc', '.msp', '.gadget', '.apk', '.sh'
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
    risky: !!record.risky
  };
}

function attach(session) {
  session.on('will-download', (event, item, webContents) => {
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
    const dir = defaultDir();
    const filename = safeFilename(item.getFilename());
    const risky = isRisky(filename);

    // Plik wykonywalny zawsze przechodzi przez okno zapisu, zeby nie wladowal
    // sie do Pobranych bez twojej wiedzy.
    if (!risky && !data.settings.get('askWhereToSave', false)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      item.setSavePath(uniquePath(dir, filename));
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
      risky
    };

    active.set(id, item);
    item.__nazunaId = id;
    data.downloadsStore.data.items.unshift(record);
    if (data.downloadsStore.data.items.length > 500) data.downloadsStore.data.items.length = 500;
    data.downloadsStore.save();
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
      data.downloadsStore.save();
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
      data.downloadsStore.flush();
      broadcast('download-done', serialise(item, record));
    });
  });
}

function list() { return data.downloadsStore.data.items; }

function control(id, action) {
  const item = active.get(id);
  const record = data.downloadsStore.data.items.find((r) => r.id === id);
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
      data.downloadsStore.data.items = data.downloadsStore.data.items.filter((r) => r.id !== id);
      data.downloadsStore.flush();
      break;
    default: break;
  }
  return list();
}

function clearFinished() {
  data.downloadsStore.data.items = data.downloadsStore.data.items.filter((r) => r.state === 'progressing' || r.state === 'paused');
  data.downloadsStore.flush();
  return list();
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

module.exports = { attach, list, control, clearFinished, setBroadcaster, defaultDir, chooseDir };
