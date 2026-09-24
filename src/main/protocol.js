'use strict';
const path = require('path');
const fs = require('fs');
const { protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const { UI_DIR, ASSETS_DIR } = require('./constants');
const starttrace = require('./starttrace');

const PAGES = new Set(['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'extensions', 'about', 'error', 'warning', 'pdf', 'textview']);

// Prog, od ktorego pojedyncze zadanie nazuna:// trafia do start.log (patrz
// starttrace.js) - normalny odczyt lokalnego pliku to ulamek milisekundy,
// wiec cokolwiek powyzej tego progu to juz nie 'wolny dysk', tylko cos po
// drodze (najpewniej antywirus skanujacy dostep do plikow swiezo odpalonej
// aplikacji - to samo podejrzenie, co przy najwolniejszym etapie calego
// startu, tylko tu widac to per-plik, a nie jako jeden zbiorczy czas).
const PROG_WOLNE_MS = 150;

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'nazuna',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: false
      }
    }
  ]);
}

function safeJoin(base, rel) {
  const root = path.resolve(base);
  const target = path.resolve(root, rel);
  // Porownanie z separatorem, zeby katalog obok o podobnej nazwie nie przeszedl.
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/* Strony wewnetrzne nie moga byc osadzane przez zadna strone internetowa.
   frame-ancestors dziala tylko w naglowku, znacznik meta go ignoruje. */
const SECURITY_HEADERS = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
};

function harden(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function handleFor(session) {
  if (!session.protocol.isProtocolHandled('nazuna')) {
    session.protocol.handle('nazuna', async (request) => {
      const poczatek = Date.now();
      try {
        const url = new URL(request.url);
        const host = url.hostname;
        const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');

        let file = null;
        if (host === 'assets') {
          file = safeJoin(ASSETS_DIR, rel);
        } else if (host === 'ui') {
          file = safeJoin(UI_DIR, rel);
        } else if (PAGES.has(host)) {
          file = rel ? safeJoin(path.join(UI_DIR, 'pages'), rel) : path.join(UI_DIR, 'pages', `${host}.html`);
        }

        // Asynchroniczny odpowiednik dawnego fs.existsSync + fs.statSync - te
        // dwie synchroniczne funkcje potrafily zablokowac caly glowny proces
        // (nie tylko to jedno okno) na czas trwania wolnego dostepu do dysku,
        // co od strony Windows wyglada dokladnie jak 'program przestal
        // odpowiadac' (szare, zamrozone okno-placeholder zamiast prawdziwej
        // tresci). fs.promises.stat czeka tak samo dlugo, ale w miedzyczasie
        // oddaje sterowanie petli zdarzen, wiec reszta programu (inne okna,
        // IPC) dziala dalej.
        let stat = null;
        if (file) {
          try { stat = await fs.promises.stat(file); } catch (_) { stat = null; }
        }

        if (!stat || stat.isDirectory()) {
          return new Response('Nie znaleziono strony', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        }
        return harden(await net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true }));
      } catch (err) {
        return new Response(`Błąd: ${err.message}`, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      } finally {
        const trwalo = Date.now() - poczatek;
        if (trwalo >= PROG_WOLNE_MS) starttrace.znacznik(`nazuna:// wolne (${trwalo}ms): ${request.url}`);
      }
    });
  }
}

module.exports = { registerSchemes, handleFor, PAGES };
