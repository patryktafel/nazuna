'use strict';
const fs = require('fs');
const path = require('path');
const { app, ipcMain, webContents } = require('electron');
const { ElectronBlocker, Request, fromElectronDetails } = require('@ghostery/adblocker-electron');
const { resourcesDir } = require('./constants');
const data = require('./data');

let blocker = null;
let ready = false;
let updating = false;
const managedSessions = new Set();     // sesje z naszym wlasnym filtrem sieciowym
const ghosterySessions = new Set();    // sesje oddane bibliotece (tryb agresywny)
const counters = new Map();
const docHosts = new Map();   // webContents.id -> host strony, zeby nie pytac o niego przy kazdym zapytaniu
let onCount = null;

const DAY = 24 * 60 * 60 * 1000;
const REFRESH_AFTER = 3 * DAY;

const COSMETIC_CHANNELS = [
  '@ghostery/adblocker/inject-cosmetic-filters',
  '@ghostery/adblocker/is-mutation-observer-enabled'
];

function cachePath() { return path.join(app.getPath('userData'), 'adblock-cache.bin'); }
function stampPath() { return path.join(app.getPath('userData'), 'adblock-cache.json'); }

function mode() {
  if (!data.settings.get('adblockEnabled', true)) return 'off';
  return data.settings.get('adblockMode', 'safe') === 'aggressive' ? 'aggressive' : 'safe';
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

function siteAllowed(hostname) {
  if (!hostname) return false;
  const list = data.siteStore.data.adblockOff || [];
  return list.includes(hostname) || list.includes(`www.${hostname}`) || list.includes(hostname.replace(/^www\./, ''));
}

/* ------------------------------------------------------------- wczytywanie */

function deserialise(buffer) {
  return ElectronBlocker.deserialize(new Uint8Array(buffer));
}

async function load() {
  for (const file of [cachePath(), path.join(resourcesDir(), 'adblock.bin')]) {
    try {
      if (!fs.existsSync(file)) continue;
      blocker = deserialise(fs.readFileSync(file));
      break;
    } catch (err) {
      console.warn('[adblock] nie mogę wczytać', file, err.message);
    }
  }
  if (!blocker) {
    try {
      blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      saveCache(blocker);
    } catch (err) {
      console.warn('[adblock] brak list filtrów (brak sieci?)', err.message);
      return false;
    }
  }
  applyAllowlist();
  ready = true;
  setTimeout(() => refresh(false).catch(() => {}), 8000);
  setInterval(() => refresh(false).catch(() => {}), 6 * 60 * 60 * 1000);
  return true;
}

function saveCache(engine) {
  try {
    fs.writeFileSync(cachePath(), Buffer.from(engine.serialize()));
    fs.writeFileSync(stampPath(), JSON.stringify({ updatedAt: Date.now() }));
  } catch (err) {
    console.warn('[adblock] nie mogę zapisać list', err.message);
  }
}

function updatedAt() {
  try { return JSON.parse(fs.readFileSync(stampPath(), 'utf8')).updatedAt || 0; } catch (_) { return 0; }
}

/** Listy filtrów odświeżają się same, bez aktualizowania samej przeglądarki. */
async function refresh(force) {
  if (updating) return { ok: false, reason: 'trwa aktualizacja' };
  if (!force && Date.now() - updatedAt() < REFRESH_AFTER) return { ok: false, reason: 'listy są aktualne' };
  updating = true;
  try {
    const fresh = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    saveCache(fresh);
    blocker = fresh;
    applyAllowlist();
    ready = true;
    if (ghosterySessions.size) {
      const sessions = [...ghosterySessions];
      for (const ses of sessions) disableFor(ses);
      for (const ses of sessions) enableFor(ses);
    }
    return { ok: true, updatedAt: updatedAt() };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    updating = false;
  }
}

function applyAllowlist() {
  if (!blocker) return;
  const hosts = data.siteStore.data.adblockOff || [];
  if (!hosts.length) return;
  try {
    blocker.updateFromDiff({ added: hosts.map((h) => `@@||${h}^$document`), removed: [] });
  } catch (err) {
    console.warn('[adblock] allowlist', err.message);
  }
}

/* ------------------------------------------------------- blokowanie sieci */

function bump(id) {
  if (id === undefined || id === null) return;
  const n = (counters.get(id) || 0) + 1;
  counters.set(id, n);
  if (onCount) onCount(id, n);
}

function documentHost(details) {
  const id = details.webContentsId;
  if (id === undefined || id === null) return '';
  const cached = docHosts.get(id);
  if (cached !== undefined) return cached;
  try {
    const wc = webContents.fromId(id);
    if (wc && !wc.isDestroyed()) {
      const host = hostOf(wc.getURL());
      // Pusty host (okienko popup jeszcze na about:blank) nie trafia do
      // pamieci - inaczej zostawal tam na stale i wyjatek "bloker wylaczony
      // na tej stronie" nigdy juz w tym okienku nie zadzialal.
      if (host) docHosts.set(id, host);
      return host;
    }
  } catch (_) {}
  return '';
}

function setDocumentHost(id, url) { docHosts.set(id, hostOf(url)); }
function forget(id) { docHosts.delete(id); counters.delete(id); }

function attachNetworkFilter(session) {
  session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (!blocker || mode() === 'off') return callback({});
    try {
      // Sprawdzanie wyjatkow ma sens tylko wtedy, gdy w ogole jakies sa.
      const exceptions = data.siteStore.data.adblockOff;
      if (exceptions && exceptions.length && siteAllowed(documentHost(details))) return callback({});
      const request = fromElectronDetails(details);
      if (!request.isSupported) return callback({});
      const { match, redirect } = blocker.match(request);
      if (redirect && redirect.dataUrl) return callback({ redirectURL: redirect.dataUrl });
      if (match) {
        if (process.env.NAZUNA_DEBUG) console.log('[zablokowano]', details.url.slice(0, 80));
        bump(details.webContentsId);
        return callback({ cancel: true });
      }
    } catch (_) { /* nigdy nie blokujemy z powodu błędu w nas samych */ }
    callback({});
  });
}

function detachNetworkFilter(session) {
  try { session.webRequest.onBeforeRequest(null); } catch (_) {}
}

/** Ukrywanie pozostałych po reklamach dziur, bez wstrzykiwania skryptów na stronę. */
async function applyCosmetics(wc, url) {
  if (!blocker || mode() === 'off' || !/^https?:/i.test(url || '')) return;
  const host = hostOf(url);
  if (siteAllowed(host)) return;
  if (mode() === 'aggressive') return;   // w tym trybie robi to biblioteka
  try {
    const req = Request.fromRawDetails({ url, type: 'main_frame', sourceUrl: url });
    const { styles } = blocker.getCosmeticsFilters({
      url,
      hostname: req.hostname,
      domain: req.domain,
      getBaseRules: true,
      getInjectionRules: false,     // <- zero scriptletów, to one psuły YouTube
      getExtendedRules: false,
      getRulesFromDOM: false,
      getRulesFromHostname: true
    });
    if (styles && styles.length) await wc.insertCSS(styles, { cssOrigin: 'user' });
  } catch (_) { /* strona ma działać nawet gdy kosmetyka zawiedzie */ }
}

/* ----------------------------------------------------------------- sesje */

function enableFor(session) {
  if (!blocker) return;
  const current = mode();
  if (current === 'off') return disableFor(session);

  if (current === 'aggressive') {
    if (ghosterySessions.has(session)) return;
    detachNetworkFilter(session);
    managedSessions.delete(session);
    try {
      if (ghosterySessions.size) for (const channel of COSMETIC_CHANNELS) ipcMain.removeHandler(channel);
      blocker.enableBlockingInSession(session);
      ghosterySessions.add(session);
    } catch (err) {
      console.warn('[adblock] tryb agresywny', err.message);
      attachNetworkFilter(session);
      managedSessions.add(session);
    }
    return;
  }

  if (managedSessions.has(session)) return;
  if (ghosterySessions.has(session)) {
    try { blocker.disableBlockingInSession(session); } catch (_) {}
    ghosterySessions.delete(session);
  }
  attachNetworkFilter(session);
  managedSessions.add(session);
}

function disableFor(session) {
  if (ghosterySessions.has(session)) {
    try { blocker.disableBlockingInSession(session); } catch (_) {}
    ghosterySessions.delete(session);
  }
  if (managedSessions.has(session)) {
    detachNetworkFilter(session);
    managedSessions.delete(session);
  }
}

function reapply(sessions) {
  for (const ses of sessions) {
    disableFor(ses);
    enableFor(ses);
  }
}

function setGlobal(enabled, sessions) {
  data.settings.set('adblockEnabled', !!enabled);
  reapply(sessions);
}

function setMode(value, sessions) {
  data.settings.set('adblockMode', value === 'aggressive' ? 'aggressive' : 'safe');
  reapply(sessions);
}

function setSiteEnabled(hostname, enabled) {
  data.setAdblockForSite(hostname, enabled);
  if (!blocker) return;
  const filter = `@@||${hostname}^$document`;
  try {
    blocker.updateFromDiff(enabled ? { added: [], removed: [filter] } : { added: [filter], removed: [] });
  } catch (err) {
    console.warn('[adblock] zmiana dla strony', err.message);
  }
}

function resetCount(id) { counters.set(id, 0); if (onCount) onCount(id, 0); }
function getCount(id) { return counters.get(id) || 0; }
function onCountChanged(fn) { onCount = fn; }
function status() {
  return { ready, mode: mode(), updatedAt: updatedAt(), updating };
}

module.exports = {
  load, enableFor, disableFor, setGlobal, setMode, setSiteEnabled, applyCosmetics,
  refresh, status, resetCount, getCount, onCountChanged, setDocumentHost, forget,
  get ready() { return ready; }
};
