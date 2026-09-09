'use strict';
const path = require('path');
const fs = require('fs');
const { protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const { UI_DIR, ASSETS_DIR } = require('./constants');

const PAGES = new Set(['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'extensions', 'about', 'error', 'warning', 'pdf', 'textview']);

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

        if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          return new Response('Nie znaleziono strony', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        }
        return harden(await net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true }));
      } catch (err) {
        return new Response(`Błąd: ${err.message}`, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    });
  }
}

module.exports = { registerSchemes, handleFor, PAGES };
