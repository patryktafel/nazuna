'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, net } = require('electron');
const AdmZip = require('adm-zip');
const crx = require('./crx');
const data = require('./data');

const ID_RE = /^[a-p]{32}$/;

function extensionsDir() {
  return path.join(app.getPath('userData'), 'Extensions');
}

function parseIdOrUrl(input) {
  const value = String(input || '').trim();
  if (ID_RE.test(value)) return value;
  const m = value.match(/([a-p]{32})/);
  return m ? m[1] : null;
}

function downloadUrl(id) {
  const version = process.versions.chrome || '120.0.0.0';
  const params = new URLSearchParams({
    response: 'redirect',
    os: 'win',
    arch: 'x86-64',
    os_arch: 'x86_64',
    nacl_arch: 'x86-64',
    prod: 'chromiumcrx',
    prodchannel: 'unknown',
    prodversion: version,
    acceptformat: 'crx2,crx3',
    x: `id=${id}&uc`
  });
  return `https://clients2.google.com/service/update2/crx?${params.toString()}`;
}

async function fetchBuffer(url) {
  const res = await net.fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`serwer odpowiedział ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function rmrf(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) {}
}

/** Niektore paczki ze sklepu maja smieci, ktorych Chromium nie wczyta rozpakowanych. */
function tidyUnpacked(dir) {
  rmrf(path.join(dir, '_metadata'));
  const manifestPath = path.join(dir, 'manifest.json');
  let raw = fs.readFileSync(manifestPath, 'utf8');
  raw = raw.replace(/^﻿/, '');
  const manifest = JSON.parse(raw);
  return { manifest, manifestPath };
}

async function install(input) {
  const id = parseIdOrUrl(input);
  if (!id) throw new Error('Nie rozpoznaje tego adresu. Wklej link ze sklepu Chrome albo 32-znakowy identyfikator rozszerzenia.');

  const buffer = await fetchBuffer(downloadUrl(id));
  const parsed = crx.parse(buffer);
  if (!parsed.verified) {
    throw new Error(`Podpis pobranego rozszerzenia jest niepoprawny (${parsed.reason || 'brak podpisu'}). Instalacja przerwana.`);
  }
  if (parsed.id && parsed.id !== id) {
    throw new Error('Pobrany plik należy do innego rozszerzenia niż wskazany identyfikator. Instalacja przerwana.');
  }
  const target = path.join(extensionsDir(), id);
  rmrf(target);
  fs.mkdirSync(target, { recursive: true });

  const zip = new AdmZip(Buffer.from(parsed.zip));
  zip.extractAllTo(target, true);

  const { manifest, manifestPath } = tidyUnpacked(target);
  if (parsed.publicKey) {
    manifest.key = Buffer.from(parsed.publicKey).toString('base64');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  const record = {
    id,
    dirId: id,
    name: manifest.name && manifest.name.startsWith('__MSG_') ? localisedName(target, manifest) : manifest.name,
    version: manifest.version,
    description: manifest.description && manifest.description.startsWith('__MSG_')
      ? localisedValue(target, manifest, manifest.description) : (manifest.description || ''),
    manifestVersion: manifest.manifest_version || 2,
    enabled: true,
    installedAt: Date.now(),
    path: target
  };

  const list = data.extensionsStore.data.installed;
  const idx = list.findIndex((e) => e.id === id);
  if (idx >= 0) list[idx] = Object.assign(list[idx], record);
  else list.push(record);
  data.extensionsStore.flush();
  return record;
}

function messageBundle(dir, manifest) {
  const locales = [app.getLocale().replace('-', '_'), manifest.default_locale, 'en', 'en_US'].filter(Boolean);
  for (const loc of locales) {
    const file = path.join(dir, '_locales', loc, 'messages.json');
    if (fs.existsSync(file)) {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    }
  }
  return null;
}

function localisedValue(dir, manifest, raw) {
  const key = raw.slice(6, -2);
  const bundle = messageBundle(dir, manifest);
  if (bundle && bundle[key] && bundle[key].message) return bundle[key].message;
  return key;
}

function localisedName(dir, manifest) {
  return localisedValue(dir, manifest, manifest.name);
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
  } catch (_) { return null; }
}

function iconDataUrl(dir, manifest) {
  if (!manifest) return null;
  const action = manifest.action || manifest.browser_action || manifest.page_action || {};
  const sources = [];
  const push = (icons) => {
    if (!icons) return;
    if (typeof icons === 'string') { sources.push([32, icons]); return; }
    for (const [size, file] of Object.entries(icons)) sources.push([parseInt(size, 10) || 0, file]);
  };
  push(action.default_icon);
  push(manifest.icons);
  if (!sources.length) return null;
  sources.sort((a, b) => {
    const score = (s) => (s >= 32 ? s : 1000 - s);
    return score(a[0]) - score(b[0]);
  });
  for (const [, rel] of sources) {
    const file = path.join(dir, rel.replace(/^\/+/, ''));
    if (!fs.existsSync(file)) continue;
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    try {
      return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    } catch (_) {}
  }
  return null;
}

/* describe() czyta manifest.json i ikone z dysku - dla tego samego
   zainstalowanego rozszerzenia wynik sie nie zmienia, a state() (i przez to
   describe()) potrafi wywolywac sie dziesiatki razy na minute przy zwyklym
   przegladaniu (kazda zmiana tytulu/favicony karty, itp). Cache trzyma wiec
   policzony wynik dopoki rozszerzenie nie zostanie zainstalowane/zaktualizowane
   ponownie (klucz cache zmienia sie razem ze sciezka i wersja) - jedyne, co
   naprawde zmienia sie z sesji na sesje (enabled), doklejamy na zywo z rekordu. */
const describeCache = new Map();

function describe(record) {
  const cacheKey = `${record.path}|${record.version || ''}|${record.installedAt || ''}`;
  const cached = describeCache.get(record.id);
  if (cached && cached.key === cacheKey) {
    return { ...cached.data, enabled: record.enabled !== false };
  }
  const manifest = readManifest(record.path);
  const action = manifest ? (manifest.action || manifest.browser_action || manifest.page_action || null) : null;
  const stale = {
    id: record.id,
    runtimeId: record.runtimeId || record.id,
    name: record.name || record.id,
    version: record.version,
    description: record.description,
    manifestVersion: record.manifestVersion,
    icon: iconDataUrl(record.path, manifest),
    hasPopup: !!(action && action.default_popup),
    popup: action && action.default_popup ? action.default_popup : null,
    title: (action && (action.default_title || record.name)) || record.name,
    optionsPage: manifest ? (manifest.options_page || (manifest.options_ui && manifest.options_ui.page) || null) : null,
    storeUrl: `https://chromewebstore.google.com/detail/${record.id}`
  };
  describeCache.set(record.id, { key: cacheKey, data: stale });
  return { ...stale, enabled: record.enabled !== false };
}

function list() {
  return data.extensionsStore.data.installed
    .filter((e) => fs.existsSync(e.path))
    .map(describe);
}

function records() { return data.extensionsStore.data.installed.filter((e) => fs.existsSync(e.path)); }

function setEnabled(id, enabled) {
  const rec = data.extensionsStore.data.installed.find((e) => e.id === id);
  if (rec) { rec.enabled = !!enabled; data.extensionsStore.flush(); }
  return rec;
}

function remove(id) {
  const rec = data.extensionsStore.data.installed.find((e) => e.id === id);
  if (rec) rmrf(rec.path);
  data.extensionsStore.data.installed = data.extensionsStore.data.installed.filter((e) => e.id !== id);
  describeCache.delete(id);
  data.extensionsStore.flush();
}

/* Chromium wymaga identyfikatora zlozonego z 32 liter a-p. Dla rozpakowanych
   rozszerzen sami musimy taki wymyslic - i musi byc taki sam przy kazdym
   ponownym wczytaniu tego samego folderu. Wczesniej brano tu nazwe folderu i
   zamieniano kazda spoza a-p na "a", co dawalo bardzo krotki, latwy do
   zderzenia alfabet: "moj-plugin-1" i "moj-plugin-2" wychodzily identycznie.
   Zderzenie identyfikatorow jest powazne - usuniecie jednego rozszerzenia
   kasowalo wtedy oba, bo dzielily to samo id. Haszujemy wiec cala sciezke i
   przekladamy szesnastkowe cyfry 1:1 na litery a-p, co realnie eliminuje
   zderzenia. */
function idFromPath(dir) {
  const hex = crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 32);
  return hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

async function installFromFolder(dir) {
  const manifest = readManifest(dir);
  if (!manifest) throw new Error('W tym folderze nie ma pliku manifest.json');
  const id = idFromPath(dir);
  const record = {
    id,
    name: manifest.name && manifest.name.startsWith('__MSG_') ? localisedName(dir, manifest) : manifest.name,
    version: manifest.version,
    description: manifest.description || '',
    manifestVersion: manifest.manifest_version || 2,
    enabled: true,
    installedAt: Date.now(),
    path: dir,
    unpacked: true
  };
  const list = data.extensionsStore.data.installed;
  const idx = list.findIndex((e) => e.path === dir);
  if (idx >= 0) list[idx] = Object.assign(list[idx], record); else list.push(record);
  data.extensionsStore.flush();
  return record;
}

module.exports = {
  install, installFromFolder, list, records, describe, setEnabled, remove,
  extensionsDir, parseIdOrUrl, readManifest, iconDataUrl
};
