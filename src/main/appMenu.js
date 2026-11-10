'use strict';
const { app, Menu, webContents } = require('electron');

/* Menu programu na gornym pasku macOS. Na Windows i Linuksie menu nie ma
   (wlasny pasek i przycisk menu Nazuny).

   Skroty z tego menu dzialaja takze wtedy, gdy fokus jest w polu tekstowym
   strony. Gdy fokus jest w karcie albo w pasku, ten sam skrot obsluguje
   najpierw handleShortcut w window.js (before-input-event z preventDefault
   blokuje wtedy skrot menu), wiec akcja nie wykonuje sie dwa razy.

   Edycja (Cmd+C, Cmd+V...) idzie wprost do webContents z fokusem: okno to
   BaseWindow z kilkoma WebContentsView, a role menu nie zawsze trafialy we
   wlasciwy widok. */
function install(W) {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  const withWindow = (fn) => () => { const w = W.focusedWindow(); if (w) fn(w); };
  const page = (url) => () => { const w = W.focusedWindow(); if (w) w.newTab({ url }); else W.createWindow({ urls: [url] }); };
  const edit = (label, accelerator, method) => ({
    label, accelerator,
    click: () => { const wc = webContents.getFocusedWebContents(); if (wc && !wc.isDestroyed()) wc[method](); }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Nazuna', submenu: [
      { label: 'O Nazunie', click: page('nazuna://about') },
      { label: 'Ustawienia...', accelerator: 'Command+,', click: page('nazuna://settings') },
      { type: 'separator' }, { role: 'services', label: 'Usługi' }, { type: 'separator' },
      { role: 'hide', label: 'Ukryj Nazunę' }, { role: 'hideOthers', label: 'Ukryj pozostałe' },
      { role: 'unhide', label: 'Pokaż wszystkie' }, { type: 'separator' },
      { role: 'quit', accelerator: 'Command+Q', label: 'Zakończ Nazunę' }
    ] },
    { label: 'Plik', submenu: [
      { label: 'Nowa karta', accelerator: 'Command+T', click: page(W.NEW_TAB) },
      { label: 'Nowe okno', accelerator: 'Command+N', click: () => W.createWindow({}) },
      { label: 'Nowe okno prywatne', accelerator: 'Command+Shift+N', click: () => W.createWindow({ isPrivate: true }) },
      { label: 'Przywróć zamkniętą kartę', accelerator: 'Command+Shift+T', click: withWindow((w) => w.reopenClosedTab()) },
      { type: 'separator' },
      { label: 'Zamknij kartę', accelerator: 'Command+W', click: withWindow((w) => w.closeTab(w.activeTabId)) },
      { label: 'Zamknij okno', accelerator: 'Command+Shift+W', click: withWindow((w) => w.win.close()) },
      { label: 'Drukuj...', accelerator: 'Command+P', click: withWindow((w) => { const t = w.activeTab(); if (t && t.wc) t.wc.print({}, () => {}); }) }
    ] },
    { label: 'Edycja', submenu: [
      edit('Cofnij', 'Command+Z', 'undo'), edit('Ponów', 'Command+Shift+Z', 'redo'),
      { type: 'separator' },
      edit('Wytnij', 'Command+X', 'cut'), edit('Kopiuj', 'Command+C', 'copy'),
      edit('Wklej', 'Command+V', 'paste'), edit('Wklej bez formatowania', 'Command+Shift+V', 'pasteAndMatchStyle'),
      edit('Zaznacz wszystko', 'Command+A', 'selectAll'),
      { label: 'Znajdź na stronie', accelerator: 'Command+F', click: withWindow((w) => w.openFind()) }
    ] },
    { label: 'Widok', submenu: [
      { label: 'Odśwież', accelerator: 'Command+R', click: withWindow((w) => w.reload(false)) },
      { label: 'Powiększ', accelerator: 'Command+Plus', click: withWindow((w) => w.stepZoom(1)) },
      { label: 'Pomniejsz', accelerator: 'Command+-', click: withWindow((w) => w.stepZoom(-1)) },
      { label: 'Rozmiar rzeczywisty', accelerator: 'Command+0', click: withWindow((w) => w.setZoom(1)) },
      { label: 'Pełny ekran', accelerator: 'Control+Command+F', click: withWindow((w) => w.toggleFullScreen()) }
    ] },
    { label: 'Historia', submenu: [
      { label: 'Wstecz', accelerator: 'Command+[', click: withWindow((w) => w.goBack()) },
      { label: 'Dalej', accelerator: 'Command+]', click: withWindow((w) => w.goForward()) },
      { label: 'Pokaż historię', accelerator: 'Command+Y', click: page('nazuna://history') }
    ] },
    { label: 'Zakładki', submenu: [
      { label: 'Dodaj do zakładek', accelerator: 'Command+D', click: withWindow((w) => w.toggleBookmark()) },
      { label: 'Pokaż zakładki', accelerator: 'Command+Shift+O', click: page('nazuna://bookmarks') }
    ] },
    { role: 'windowMenu', label: 'Okno', submenu: [
      { role: 'minimize', label: 'Minimalizuj' }, { role: 'zoom', label: 'Powiększ okno' },
      { type: 'separator' }, { role: 'front', label: 'Wszystkie na wierzch' }
    ] }
  ]));
  app.setAboutPanelOptions({ applicationName: 'Nazuna' });
}

module.exports = { install };
