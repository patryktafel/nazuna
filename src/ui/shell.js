'use strict';
const api = window.nazuna;
const $ = (sel) => document.querySelector(sel);

// macOS rysuje wlasne przyciski okna, wiec interfejs musi im ustapic miejsca.
if (api && api.platform === 'darwin') document.documentElement.classList.add('mac');

let state = null;
let popover = null;            // { name, el }
let addressDirty = false;
let omniItems = [];
let omniIndex = -1;
let omniQuery = '';
let suggestToken = 0;
let layerTouchedAt = 0;
let downloadsCache = [];
let prevBookmarked = null;
let prevBookmarkedTabId = null;
let prevLoading = null;
let loadbarHideTimer = null;

/* Cienki pasek ladowania pod toolbarem (patrz .loadbar w shell.css). Prawdziwego
   procentu Chromium nie udostepnia wprost, wiec rosnie "na oko" w petli, a po
   zakonczeniu doskakuje do konca i znika. */
function updateLoadbar() {
  const bar = el.loadbar;
  if (!bar) return;
  const loading = !!state.loading;
  if (loading === prevLoading) return;
  prevLoading = loading;
  clearTimeout(loadbarHideTimer);
  if (loading) {
    bar.classList.remove('done', 'hide');
    void bar.offsetWidth; // wymus restart animacji, gdyby druga nawigacja ruszyla zanim pierwsza dobiegla konca
    bar.classList.add('active');
  } else {
    bar.classList.remove('active');
    bar.classList.add('done');
    loadbarHideTimer = setTimeout(() => {
      bar.classList.add('hide');
      loadbarHideTimer = setTimeout(() => bar.classList.remove('done', 'hide'), 400);
    }, 200);
  }
}

const el = {
  chrome: $('#chrome'),
  tabs: $('#tabs'),
  tabstrip: $('#tabstrip'),
  newtab: $('#newtab'),
  privateBadge: $('#privateBadge'),
  omnibox: $('#omnibox'),
  address: $('#address'),
  lock: $('#lock'),
  lockLabel: $('#lockLabel'),
  star: $('#star'),
  shield: $('#shield'),
  webstoreInstall: $('#webstoreInstall'),
  zoomChip: $('#zoomChip'),
  extSlot: $('#extSlot'),
  bookmarksbar: $('#bookmarksbar'),
  findbar: $('#findbar'),
  findInput: $('#findInput'),
  findCount: $('#findCount'),
  layer: $('#layer'),
  scrim: $('#scrim'),
  loadbar: $('#loadbar')
};

function setIcon(node, name) { if (node) node.innerHTML = iconSvg(name); }

setIcon($('#back'), 'back');
setIcon($('#forward'), 'forward');
setIcon($('#reload'), 'reload');
setIcon($('#home'), 'home');
setIcon($('#newtab'), 'plus');
setIcon($('#bookmarksBtn'), 'bookmark');
setIcon($('#downloads'), 'download');
setIcon($('#menu'), 'menu');
setIcon($('#min'), 'minimize');
setIcon($('#max'), 'maximize');
setIcon($('#close'), 'close');
setIcon(el.star, 'star');
setIcon(el.shield, 'shield');
setIcon(el.webstoreInstall, 'puzzle');
setIcon(el.lock, 'globe');
setIcon($('#findPrev'), 'chevronUp');
setIcon($('#findNext'), 'chevronDown');
setIcon($('#findClose'), 'x');
el.privateBadge.innerHTML = `${iconSvg('incognito')}<span>Prywatne</span>`;

/* ------------------------------------------------------------------ layer */

function expand(name) { api.send('ui.popover', { name }); document.body.classList.add('expanded'); }
function collapse() { api.send('ui.popover', { name: null }); document.body.classList.remove('expanded'); }

/* Gdy okienko o zgode znika bez klikniecia Zezwol/Zablokuj (np. otworzylo sie
   inne menu, kliknieto poza nim, Escape), proces glowny i tak czeka na
   odpowiedz - bez tego strona wisialaby w nieskonczonosc, jakby nikt nigdy
   nie zareagowal na jej prosbe. Traktujemy takie zamkniecie jak odmowe. */
function denyOrphanedPermission() {
  if (!popover || popover.name !== 'permission' || popover.el.dataset.answered === '1') return;
  const key = popover.el.dataset.permKey;
  if (key) api.send('permission.answer', { key, answer: 'deny', remember: false });
}

function closePopover(silent) {
  denyOrphanedPermission();
  if (popover) { popover.el.remove(); popover = null; }
  el.layer.querySelectorAll('.bm-sub, .bm-ctx').forEach((n) => n.remove());
  el.layer.innerHTML = '';
  if (!silent) collapse();
  document.body.classList.remove('expanded');
}

function openPanel(name, node, anchorRect, opts = {}) {
  closePopover(true);
  node.classList.add('panel');
  el.layer.appendChild(node);
  popover = { name, el: node };
  layerTouchedAt = Date.now();
  expand(name);
  document.body.classList.add('expanded');

  const pad = 8;
  const view = (state && state.viewport) || { width: window.innerWidth, height: window.innerHeight };
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  let x = opts.align === 'left' ? anchorRect.left : anchorRect.right - w;
  if (opts.align === 'point') x = anchorRect.left;
  let y = anchorRect.bottom + 6;
  if (opts.align === 'point') y = anchorRect.top;
  x = Math.max(pad, Math.min(view.width - w - pad, x));
  if (y + h > view.height - pad) y = Math.max(pad, view.height - h - pad);
  node.style.left = `${Math.round(x)}px`;
  node.style.top = `${Math.round(y)}px`;
  return node;
}

el.scrim.addEventListener('mousedown', () => forceClose());

/** Wyjscie awaryjne: czysci warstwe i mowi procesowi glownemu, zeby ja zwinal. */
function forceClose() {
  denyOrphanedPermission();
  layerTouchedAt = 0;
  if (popover) { popover.el.remove(); popover = null; }
  el.layer.innerHTML = '';
  document.body.classList.remove('expanded');
  api.send('menu.close');
  api.send('ui.popover', { name: null });
}

for (const id of ['#menu', '#downloads', '#shield', '#bookmarksBtn']) $(id).classList.add('pop-trigger');
document.addEventListener('mousedown', (e) => {
  if (!el.layer.firstChild) return;
  if (popover && popover.name === 'omni') return;
  if (e.target.closest('.panel') || e.target.closest('.pop-trigger') || e.target.closest('.ext-slot')) return;
  forceClose();
}, true);

function panel(html, cls = '') {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
}

function menuHtml(items) {
  return items.map((item) => {
    if (item.type === 'separator') return '<div class="menu-sep"></div>';
    if (item.type === 'title') return `<div class="menu-title">${escapeHtml(item.label)}</div>`;
    if (item.type === 'custom') return item.html;
    const cls = ['menu-item'];
    if (item.enabled === false) cls.push('disabled');
    if (item.danger) cls.push('danger');
    return `<div class="${cls.join(' ')}" data-id="${item.id}">
      ${item.icon ? iconSvg(item.icon) : '<span style="width:16px"></span>'}
      <span>${escapeHtml(item.label)}</span>
      ${item.accel ? `<span class="accel">${escapeHtml(item.accel)}</span>` : ''}
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* -------------------------------------------------------------- tab strip */

const tabNodes = new Map();

/* Wlasny dymek podpowiedzi dla kart, zamiast natywnego atrybutu title.
   Powod: tytul karty ma dwie linijki (nazwa + adres), a taki wieloliniowy
   natywny tooltip na Windows renderuje sie zupelnie inaczej niz reszta
   podpowiedzi w Nazunie (biale, kanciaste okienko zamiast ciemnego, jak np.
   przy ikonie blokera) - rzucalo sie to w oczy. */
let tabTipEl = null;
let tabTipTimer = null;
let tabTipNode = null;

function ensureTabTip() {
  if (!tabTipEl) {
    tabTipEl = document.createElement('div');
    tabTipEl.className = 'tab-tip';
    tabTipEl.innerHTML = '<b></b><span></span>';
    el.layer.appendChild(tabTipEl);
  }
  return tabTipEl;
}

function fillTabTip(node) {
  const tip = ensureTabTip();
  tip.querySelector('b').textContent = node.dataset.tipTitle || 'Nowa karta';
  const url = node.dataset.tipUrl || '';
  tip.querySelector('span').textContent = node.dataset.tipSleeping ? `${url} · uśpiona` : url;
}

function hideTabTip() {
  clearTimeout(tabTipTimer);
  tabTipNode = null;
  if (tabTipEl) tabTipEl.classList.remove('show');
}

function scheduleTabTip(node) {
  clearTimeout(tabTipTimer);
  tabTipTimer = setTimeout(() => {
    tabTipNode = node;
    const tip = ensureTabTip();
    fillTabTip(node);
    const r = node.getBoundingClientRect();
    tip.style.left = `${Math.round(r.left)}px`;
    tip.style.top = `${Math.round(r.bottom + 6)}px`;
    tip.classList.add('show');
  }, 450);
}

function renderTabs() {
  // Przy duzej liczbie kart plynne "rozjezdzanie sie" szerokosci wszystkich
  // kart naraz (patrz transition: flex-basis w shell.css) to animacja
  // ktora przelicza uklad (reflow), a nie tylko przesuwa gotowa warstwe -
  // koszt rosnie z liczba kart na pasku. Przy tylu kartach sa i tak juz przy
  // minimalnej szerokosci (patrz .narrow ponizej), wiec wizualnie prawie nic
  // to nie traci, a ratuje plynnosc dokladnie tam, gdzie ma to najwieksze
  // znaczenie - przy wielu otwartych kartach.
  el.tabs.classList.toggle('many', state.tabs.length > 11);
  const ids = new Set(state.tabs.map((t) => t.id));
  for (const [id, node] of tabNodes) {
    if (!ids.has(id)) {
      if (tabTipNode === node) hideTabTip();
      tabNodes.delete(id);
      // Karta znika plynnie zamiast skokowo (patrz .tab-leave w shell.css) -
      // node zostaje w DOM jeszcze przez chwile, wiec dopiero po animacji go
      // usuwamy. setTimeout to zabezpieczenie, gdyby z jakiegos powodu
      // animationend nie doszlo (np. wylaczone animacje w systemie).
      node.classList.add('tab-leave');
      node.addEventListener('animationend', () => node.remove(), { once: true });
      setTimeout(() => node.remove(), 220);
    }
  }
  // Karty w trakcie znikania (patrz wyzej) zostaja fizycznie w #tabs jeszcze
  // przez chwile - pomijamy je tutaj, zeby nie przesuwaly numeracji
  // prawdziwych, aktualnych kart przy wstawianiu/przestawianiu ponizej.
  const zywe = () => [...el.tabs.children].filter((n) => n.classList.contains('tab') && !n.classList.contains('tab-leave'));
  state.tabs.forEach((tab, index) => {
    let node = tabNodes.get(tab.id);
    if (!node) {
      node = document.createElement('div');
      // Nowa karta wjezdza lekkim wyskokiem (patrz .tab-enter w shell.css) -
      // klasa sama znika po animacji, zeby nic nie zostawalo na stale.
      node.className = 'tab tab-enter';
      node.addEventListener('animationend', () => node.classList.remove('tab-enter'), { once: true });
      node.dataset.id = String(tab.id);
      node.innerHTML = '<span class="lead"></span><span class="label"></span><button class="audio"></button><button class="tab-close"></button>';
      node.querySelector('.tab-close').innerHTML = iconSvg('close');
      node.addEventListener('mousedown', (e) => {
        hideTabTip();
        if (e.button === 1) { e.preventDefault(); api.send('tab.close', { id: tab.id }); return; }
        if (e.button === 0) api.send('tab.select', { id: tab.id });
      });
      node.addEventListener('contextmenu', (e) => { hideTabTip(); e.preventDefault(); tabMenu(tab.id, e); });
      node.querySelector('.tab-close').addEventListener('mousedown', (e) => {
        e.stopPropagation(); e.preventDefault();
        hideTabTip();
        api.send('tab.close', { id: tab.id });
      });
      // Glosniczek - widoczny tylko gdy karta faktycznie gra dzwiek albo jest
      // recznie wyciszona (patrz petla renderujaca nizej). Klik przelacza
      // wyciszenie bez zaznaczania/przeciagania karty, tak samo jak X obok.
      node.querySelector('.audio').addEventListener('mousedown', (e) => {
        e.stopPropagation(); e.preventDefault();
        hideTabTip();
        api.send('tab.mute', { id: tab.id });
      });
      node.addEventListener('mouseenter', () => scheduleTabTip(node));
      node.addEventListener('mouseleave', () => hideTabTip());
      wireTabDrag(node);
      tabNodes.set(tab.id, node);
    }
    const kids = zywe();
    if (kids[index] !== node) el.tabs.insertBefore(node, kids[index] || el.newtab);

    node.classList.toggle('active', tab.active);
    const lead = node.querySelector('.lead');
    if (tab.loading) {
      if (!lead.querySelector('.spinner')) lead.innerHTML = '<span class="spinner"></span>';
    } else if (tab.favicon) {
      const img = lead.querySelector('img');
      if (!img || img.getAttribute('src') !== tab.favicon) {
        lead.dataset.fallback = '';
        lead.innerHTML = '';
        const pic = document.createElement('img');
        pic.className = 'favicon';
        pic.src = tab.favicon;
        pic.addEventListener('error', () => { pic.remove(); lead.innerHTML = iconSvg('globe', 'favicon'); });
        lead.appendChild(pic);
      }
    } else {
      const want = tab.internal ? 'flower' : 'globe';
      if (lead.dataset.fallback !== want) { lead.dataset.fallback = want; lead.innerHTML = iconSvg(want, 'favicon'); }
    }
    const label = node.querySelector('.label');
    const text = tab.title || 'Nowa karta';
    if (label.textContent !== text) label.textContent = text;
    node.dataset.tipTitle = text;
    node.dataset.tipUrl = tab.url || '';
    node.dataset.tipSleeping = tab.sleeping ? '1' : '';
    if (tabTipNode === node) fillTabTip(node);
    node.classList.toggle('sleeping', !!tab.sleeping);
    node.classList.toggle('narrow', state.tabs.length > 11);
    // Glosniczek: pokazujemy go tylko gdy jest o czym informowac (karta
    // faktycznie gra dzwiek w tym momencie, albo jest recznie wyciszona) -
    // inaczej wisialby na kazdej karcie na zapas. Ikona i tytul mowia, co
    // klikniecie zrobi.
    const audioBtn = node.querySelector('.audio');
    const showAudio = tab.audible || tab.muted;
    audioBtn.classList.toggle('shown', showAudio);
    if (showAudio) {
      const want = tab.muted ? 'volumeOff' : 'volume';
      if (audioBtn.dataset.icon !== want) {
        audioBtn.dataset.icon = want;
        audioBtn.innerHTML = iconSvg(want);
      }
      audioBtn.title = tab.muted ? 'Włącz dźwięk' : 'Wycisz kartę';
    }
  });
}


/* Przeciaganie kart prowadzimy sami, a nie systemowym mechanizmem przenoszenia.
   Powod jest praktyczny: sprawdzilem i systemowe przenoszenie NIE donosi
   zdarzen miedzy dwoma oknami tej samej przegladarki. Karta zamiast wladowac
   sie do drugiego okna wyrywala sie w trzecie.

   Tutaj pasek melduje procesowi glownemu, gdzie jest kursor na EKRANIE, a ten
   wie, gdzie stoja wszystkie okna, wiec sam rozstrzyga, nad ktorym jestes.
   Dziala niezaleznie od kaprysow systemu. */

let ciagniete = null;
let ostatniRuch = 0;

function miejsceWstawienia(x) {
  const nodes = [...el.tabs.children].filter((n) => n.classList.contains('tab'));
  for (let i = 0; i < nodes.length; i++) {
    const r = nodes[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) return i;
  }
  return nodes.length;
}

function pokazWskaznik(clientX) {
  let w = document.getElementById('wskaznikKarty');
  if (!w) {
    w = document.createElement('div');
    w.id = 'wskaznikKarty';
    w.className = 'wskaznik-karty';
    el.tabstrip.appendChild(w);
  }
  const nodes = [...el.tabs.children].filter((n) => n.classList.contains('tab'));
  const i = miejsceWstawienia(clientX);
  const pas = el.tabstrip.getBoundingClientRect();
  let lewo;
  if (!nodes.length) lewo = 8;
  else if (i >= nodes.length) lewo = nodes[nodes.length - 1].getBoundingClientRect().right - pas.left;
  else lewo = nodes[i].getBoundingClientRect().left - pas.left;
  w.style.left = `${Math.max(2, lewo - 1)}px`;
  w.hidden = false;
}

function schowajWskaznik() {
  const w = document.getElementById('wskaznikKarty');
  if (w) w.hidden = true;
}

/* Czy kursor jest nad paskiem zakladek tego okna, i przed ktora zakladka
   wstawic upuszczona karte (null = na koniec). */
function nadPaskiemZakladek(x, y) {
  const bar = el.bookmarksbar;
  if (!bar || bar.hidden) return null;
  const r = bar.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  for (const n of bar.querySelectorAll('.bm')) {
    const b = n.getBoundingClientRect();
    if (x < b.left + b.width / 2) return { beforeId: n.dataset.id };
  }
  return { beforeId: null };
}

function pokazWskaznikZakladki(cel) {
  let w = document.getElementById('wskaznikZakladki');
  if (!cel) { el.bookmarksbar.classList.remove('przyjmuje'); if (w) w.hidden = true; return; }
  el.bookmarksbar.classList.add('przyjmuje');
  if (!w) {
    w = document.createElement('div');
    w.id = 'wskaznikZakladki';
    w.className = 'wskaznik-karty';
    el.bookmarksbar.appendChild(w);
  }
  const pas = el.bookmarksbar.getBoundingClientRect();
  const przed = cel.beforeId ? el.bookmarksbar.querySelector(`.bm[data-id="${CSS.escape(cel.beforeId)}"]`) : null;
  const wszystkie = el.bookmarksbar.querySelectorAll('.bm');
  let lewo = 8;
  if (przed) lewo = przed.getBoundingClientRect().left - pas.left;
  else if (wszystkie.length) lewo = wszystkie[wszystkie.length - 1].getBoundingClientRect().right - pas.left;
  w.style.left = `${Math.max(2, lewo - 1)}px`;
  w.hidden = false;
}

function wireTabDrag(node) {
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // Krzyzyk zamykania nie moze uruchamiac przeciagania, bo przechwycenie
    // wskaznika przez karte zabraloby mu wlasne klikniecie.
    if (e.target && e.target.closest && e.target.closest('.tab-close')) return;
    ciagniete = { id: Number(node.dataset.id), node, x0: e.clientX, y0: e.clientY, ptr: e.pointerId, ruszone: false };
    try { node.setPointerCapture(e.pointerId); } catch (_) {}
  });

  node.addEventListener('pointermove', (e) => {
    if (!ciagniete || ciagniete.ptr !== e.pointerId) return;
    if (!ciagniete.ruszone) {
      // Drobne drgniecie przy klikaniu to jeszcze nie przeciaganie.
      if (Math.abs(e.clientX - ciagniete.x0) < 6 && Math.abs(e.clientY - ciagniete.y0) < 6) return;
      ciagniete.ruszone = true;
      node.classList.add('dragging');
      api.send('tab.dragStart', { id: ciagniete.id });
    }
    // Nad paskiem zakladek pokazujemy, gdzie wyladuje zakladka.
    pokazWskaznikZakladki(nadPaskiemZakladek(e.clientX, e.clientY));
    const teraz = Date.now();
    if (teraz - ostatniRuch >= 40) {          // nie zasypujemy procesu glownego
      ostatniRuch = teraz;
      api.send('tab.dragRuch', { id: ciagniete.id, x: e.screenX, y: e.screenY });
    }
  });

  const koniec = (e) => {
    if (!ciagniete || ciagniete.ptr !== e.pointerId) return;
    const c = ciagniete;
    ciagniete = null;
    c.node.classList.remove('dragging');
    schowajWskaznik();
    try { c.node.releasePointerCapture(e.pointerId); } catch (_) {}
    if (!c.ruszone) return;                    // zwykle klikniecie, nie przeciaganie
    const naZakladki = nadPaskiemZakladek(e.clientX, e.clientY);
    pokazWskaznikZakladki(null);
    api.send('tab.dragKoniecP', { id: c.id, x: e.screenX, y: e.screenY, naZakladki });
  };
  node.addEventListener('pointerup', koniec);
  node.addEventListener('pointercancel', koniec);
}

/* Trzymana karta, rysowana pod kursorem. Systemowe przenoszenie rysowalo ja
   samo, ale go nie uzywamy, wiec robimy to sami. */
function duch(p) {
  let d = document.getElementById('duchKarty');
  if (!p || !p.on) { if (d) d.hidden = true; return; }
  if (!d) {
    d = document.createElement('div');
    d.id = 'duchKarty';
    d.className = 'duch-karty';
    document.body.appendChild(d);
  }
  d.textContent = String(p.tytul || 'Karta');
  // Wspolrzedne przychodza juz przeliczone na to okno (patrz tab.dragRuch).
  d.style.left = `${Number(p.x) + 12}px`;
  d.style.top = `${Number(p.y) + 10}px`;
  d.hidden = false;
}
api.on('pasek:duch', duch);

/* Podswietlenie paska, gdy karta jest nad nim. Wspolrzedna jest juz
   przeliczona na to okno przez proces glowny. */
api.on('pasek:podswietl', (p) => {
  if (!p || !p.on) { el.tabstrip.classList.remove('przyjmuje'); schowajWskaznik(); return; }
  el.tabstrip.classList.add('przyjmuje');
  pokazWskaznik(Number(p.x));
});

/* Karta upuszczona na naszym pasku. Tylko my wiemy, gdzie leza nasze karty,
   wiec miejsce wstawienia liczymy tutaj. */
api.on('pasek:upusc', (p) => {
  el.tabstrip.classList.remove('przyjmuje');
  schowajWskaznik();
  if (!p || !p.id) return;
  const clientX = Number(p.x);
  api.send('tab.przenies', { id: p.id, zeton: (state && state.zeton) || '', index: miejsceWstawienia(clientX) });
});

function tabMenu(id, event) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  const items = [
    { id: 'reload', label: 'Odśwież', icon: 'reload' },
    { id: 'duplicate', label: 'Duplikuj kartę', icon: 'copy' },
    { id: 'doNowegoOkna', label: 'Przenieś do nowego okna', icon: 'window', enabled: state.tabs.length > 1 },
    { id: 'mute', label: tab.muted ? 'Włącz dźwięk' : 'Wycisz kartę', icon: tab.muted ? 'volume' : 'volumeOff' },
    { type: 'separator' },
    { id: 'sleepNow', label: tab.sleeping ? 'Karta już uśpiona' : 'Uśpij kartę teraz', icon: 'moon', enabled: !tab.sleeping && !tab.active },
    { id: 'sleepExempt', label: tab.sleepExempt ? 'Zezwól na usypianie tej strony' : 'Nie usypiaj tej strony', icon: 'pin', enabled: !tab.internal },
    { type: 'separator' },
    { id: 'close', label: 'Zamknij kartę', icon: 'x', accel: 'Ctrl+W' },
    { id: 'closeOthers', label: 'Zamknij pozostałe', enabled: state.tabs.length > 1 },
    { id: 'closeRight', label: 'Zamknij karty po prawej', enabled: state.tabs.findIndex((t) => t.id === id) < state.tabs.length - 1 }
  ];
  const node = panel(menuHtml(items));
  node.style.minWidth = '210px';
  openPanel('tabmenu', node, { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY }, { align: 'point' });
  node.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const map = {
      // Z id - inaczej odswiezala sie karta aktywna, a nie ta kliknieta.
      reload: () => api.send('tab.reload', { id }),
      duplicate: () => api.send('tab.duplicate', { id }),
      doNowegoOkna: () => api.send('tab.doNowegoOkna', { id }),
      mute: () => api.send('tab.mute', { id }),
      sleepNow: () => api.send('tab.sleep', { id }),
      sleepExempt: () => api.send('tab.toggleSleepExempt', { id }),
      close: () => api.send('tab.close', { id }),
      closeOthers: () => api.send('tab.closeOthers', { id }),
      closeRight: () => api.send('tab.closeRight', { id })
    };
    (map[item.dataset.id] || (() => {}))();
    closePopover();
  });
}

/* ---------------------------------------------------------------- toolbar */

/* Adres tak, jak ma wygladac w pasku: bez koncowego ukosnika przy stronach
   nazuna:// i pusty na nowej karcie. */
function adresDoPokazania() {
  const raw = String((state && state.url) || '');
  const shown = /^nazuna:/i.test(raw) ? raw.replace(/\/+$/, '') : raw;
  return shown && shown !== 'nazuna://newtab' ? shown : '';
}

function renderToolbar() {
  // Stan z procesu glownego moze dojsc pozniej niz np. lista pobran -
  // bez niego nie ma czego rysowac (wczesniej konczylo sie to bledem).
  if (!state) return;
  $('#back').classList.toggle('disabled', !state.canGoBack);
  $('#forward').classList.toggle('disabled', !state.canGoForward);
  setIcon($('#reload'), state.loading ? 'stop' : 'reload');
  $('#reload').title = state.loading ? 'Zatrzymaj (Esc)' : 'Odśwież (F5)';
  updateLoadbar();

  el.omnibox.classList.toggle('secure', !!state.secure);
  el.omnibox.classList.toggle('internal', !!state.internal);
  setIcon(el.lock, state.internal ? 'flower' : state.secure ? 'lock' : 'globe');
  el.lockLabel.hidden = !state.insecure;

  if (!addressDirty && document.activeElement !== el.address) el.address.value = adresDoPokazania();

  el.star.innerHTML = iconSvg(state.bookmarked ? 'starFilled' : 'star');
  el.star.classList.toggle('active', !!state.bookmarked);
  // Male "odbicie" gwiazdki przy dodaniu/usunieciu zakladki (patrz .bump w
  // shell.css) - tylko gdy to naprawde zmiana na TEJ SAMEJ karcie (klikniecie
  // gwiazdki), a nie efekt przeskoczenia na inna karte o innym stanie
  // zakladki - inaczej odbijaloby sie przy zwyklym przelaczaniu kart.
  if (prevBookmarkedTabId === state.activeTabId && prevBookmarked !== !!state.bookmarked) {
    el.star.classList.remove('bump');
    void el.star.offsetWidth; // wymus przeliczenie stylow, zeby animacja odpalila sie od nowa
    el.star.classList.add('bump');
  }
  prevBookmarked = !!state.bookmarked;
  prevBookmarkedTabId = state.activeTabId;

  const blocking = state.adblockEnabled && state.adblockSite;
  el.shield.innerHTML = iconSvg(blocking ? 'shield' : 'shieldOff');
  el.shield.classList.toggle('active', blocking && state.blockedCount > 0);

  el.shield.title = blocking
    ? `Bloker włączony${state.blockedCount ? ` - zablokowano ${state.blockedCount}` : ''}`
    : 'Bloker wyłączony na tej stronie';

  // Strona szczegolow rozszerzenia w sklepie Chrome - Nazuna nie ma
  // wewnetrznego API sklepu (chrome.webstorePrivate), wiec sam przycisk
  // "Dodaj do Chrome" na tej stronie nie zadziala. Ten przycisk omija to,
  // pobierajac i instalujac to samo rozszerzenie naszym wlasnym mechanizmem
  // (patrz extensions.install w main), dokladnie tak samo jak przez
  // wklejenie linku w Ustawieniach - Rozszerzenia.
  el.webstoreInstall.hidden = !/^https:\/\/chromewebstore\.google\.com\/detail\//i.test(String(state.url || ''));

  const zoom = Math.round((state.zoom || 1) * 100);
  el.zoomChip.hidden = zoom === 100;
  el.zoomChip.innerHTML = `<span class="zoom-chip">${zoom}%</span>`;

  el.privateBadge.hidden = !state.isPrivate;
  setIcon($('#max'), state.maximized ? 'restore' : 'maximize');

  const active = downloadsCache.filter((d) => d.state === 'progressing' || d.state === 'paused').length;
  const dl = $('#downloads');
  dl.querySelector('.badge')?.remove();
  if (active) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = String(active);
    dl.appendChild(b);
  }
  document.documentElement.dataset.accent = (state.settings && state.settings.accent) || 'violet';
  document.documentElement.dataset.motyw = state.motyw || 'ciemny';
  document.body.classList.toggle('content-fullscreen', !!state.contentFullScreen);
  applySiteAccent();
}

// Nadpisuje staly akcent kolorystyczny akcentem wyliczonym z favicony
// aktywnej strony (patrz extractSiteAccent() w main) - jak w Vivaldim.
// Ustawienie i brak wyliczonego koloru po prostu zdejmuja nadpisanie,
// wracajac do zwyklego, stalego akcentu z Ustawien.
let siteAccentApplied = false;
function applySiteAccent() {
  const enabled = !state.settings || state.settings.siteAccentEnabled !== false;
  const a = enabled ? state.siteAccent : null;
  const root = document.documentElement.style;
  if (a) {
    root.setProperty('--accent', a.accent);
    root.setProperty('--accent-strong', a.accentStrong);
    root.setProperty('--accent-dim', a.accentDim);
    root.setProperty('--accent-ring', a.accentRing);
    siteAccentApplied = true;
  } else if (siteAccentApplied) {
    root.removeProperty('--accent');
    root.removeProperty('--accent-strong');
    root.removeProperty('--accent-dim');
    root.removeProperty('--accent-ring');
    siteAccentApplied = false;
  }
}

function renderExtensions() {
  const list = state.extensions || [];
  const current = [...el.extSlot.children].map((n) => n.dataset.id).join(',');
  const next = list.map((e) => e.id).join(',');
  if (current === next) return;
  el.extSlot.innerHTML = '';
  for (const ext of list.slice(0, 6)) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.id = ext.id;
    b.title = ext.title || ext.name;
    b.innerHTML = ext.icon ? `<img class="ext-icon" src="${escapeHtml(ext.icon)}">` : iconSvg('puzzle');
    b.addEventListener('click', () => {
      if (ext.hasPopup) api.send('extensions.popup', { id: ext.id, rect: b.getBoundingClientRect().toJSON() });
      else api.send('tab.new', { url: `nazuna://extensions` });
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const node = panel(menuHtml([
        { id: 'options', label: 'Opcje rozszerzenia', icon: 'settings', enabled: !!ext.optionsPage },
        { id: 'manage', label: 'Zarządzaj rozszerzeniami', icon: 'puzzle' },
        { type: 'separator' },
        { id: 'remove', label: 'Usuń rozszerzenie', icon: 'trash', danger: true }
      ]));
      openPanel('extmenu', node, b.getBoundingClientRect());
      node.addEventListener('click', (ev) => {
        const it = ev.target.closest('.menu-item');
        if (!it) return;
        if (it.dataset.id === 'options') api.send('extensions.options', { id: ext.id });
        if (it.dataset.id === 'manage') api.send('tab.new', { url: 'nazuna://extensions' });
        if (it.dataset.id === 'remove') api.invoke('extensions.remove', { id: ext.id });
        closePopover();
      });
    });
    el.extSlot.appendChild(b);
  }
}

/* ------------------------------------------------------------- bookmarks */

function renderBookmarks() {
  const show = state.showBookmarksBar && !state.contentFullScreen;
  el.bookmarksbar.hidden = !show;
  if (!show) return;
  const items = (state.bookmarks || []).filter((b) => b.parent === 'bar');
  if (!items.length) {
    el.bookmarksbar.innerHTML = '<span class="empty">Pasek zakładek jest pusty. Przeciągnij tu kartę albo kliknij prawym przyciskiem, żeby dodać zakładkę.</span>';
    return;
  }
  el.bookmarksbar.innerHTML = items.map((b) => {
    if (b.type === 'separator') return `<div class="bm bm-sep" data-id="${b.id}" data-type="separator"></div>`;
    const ico = b.type === 'folder' ? iconSvg('folder') : `<span class="fav">${iconSvg('globe')}</span>`;
    return `<div class="bm" data-id="${b.id}" data-url="${escapeHtml(b.url || '')}" data-type="${b.type}" title="${escapeHtml(b.title)}">${ico}<span>${escapeHtml(b.title)}</span></div>`;
  }).join('');
  el.bookmarksbar.querySelectorAll('.bm[data-type="link"]').forEach((row) => {
    const holder = row.querySelector('.fav');
    if (!holder || !row.dataset.url) return;
    const img = new Image();
    img.className = 'fav-img';
    img.addEventListener('load', () => { if (holder.isConnected) holder.replaceWith(img); });
    img.src = faviconFor(row.dataset.url);
  });
}

function faviconFor(url) {
  try {
    const u = new URL(url);
    return `${u.origin}/favicon.ico`;
  } catch (_) { return ''; }
}

el.bookmarksbar.addEventListener('click', (e) => {
  const node = e.target.closest('.bm');
  if (!node || node.dataset.type === 'separator') return;
  if (node.dataset.type === 'folder') {
    const children = (state.bookmarks || []).filter((b) => b.parent === node.dataset.id);
    const items = children.length
      ? children.map((c) => ({ id: `open:${c.id}`, label: c.title, icon: c.type === 'folder' ? 'folder' : 'globe' }))
      : [{ id: 'none', label: 'Pusty folder', enabled: false }];
    const p = panel(menuHtml(items));
    openPanel('bmfolder', p, node.getBoundingClientRect(), { align: 'left' });
    p.addEventListener('click', (ev) => {
      const it = ev.target.closest('.menu-item');
      if (!it || !it.dataset.id.startsWith('open:')) return;
      const b = state.bookmarks.find((x) => x.id === it.dataset.id.slice(5));
      if (b && b.url) api.send('nav.go', { input: b.url });
      closePopover();
    });
    return;
  }
  api.send('nav.go', { input: node.dataset.url });
});

// Srodkowy przycisk myszy (kolko) na zakladce z paska - otwiera w nowej
// karcie w tle, tak jak w kazdej innej przegladarce. Foldery i separatory
// pomijamy, bo klikniecie w nie i tak nie nawiguje (otwiera podmenu).
el.bookmarksbar.addEventListener('mousedown', (e) => {
  if (e.button !== 1) return;
  const node = e.target.closest('.bm');
  if (!node || node.dataset.type !== 'link') return;
  e.preventDefault();
  api.send('tab.new', { url: node.dataset.url, background: true });
});

function startBmRename(node) {
  const span = node.querySelector('span:not(.fav)');
  if (!span) return;
  const id = node.dataset.id;
  const original = span.textContent;
  span.contentEditable = 'true';
  span.spellcheck = false;
  const range = document.createRange();
  range.selectNodeContents(span);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  span.focus();
  const finish = (save) => {
    span.contentEditable = 'false';
    span.removeEventListener('blur', onBlur);
    span.removeEventListener('keydown', onKey);
    if (save) {
      const title = span.textContent.trim() || original || 'Bez nazwy';
      span.textContent = title;
      api.invoke('bookmarks.update', { id, patch: { title } });
    } else {
      span.textContent = original;
    }
  };
  const onBlur = () => finish(true);
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  span.addEventListener('blur', onBlur);
  span.addEventListener('keydown', onKey);
}

function openDialogPanel(name, node) {
  closePopover(true);
  node.classList.add('panel');
  el.layer.appendChild(node);
  popover = { name, el: node };
  layerTouchedAt = Date.now();
  expand(name);
  document.body.classList.add('expanded');
  const pad = 8;
  const view = (state && state.viewport) || { width: window.innerWidth, height: window.innerHeight };
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  const x = Math.max(pad, Math.round((view.width - w) / 2));
  const y = Math.max(pad, Math.min(view.height - h - pad, Math.round(view.height * 0.18)));
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  return node;
}

function addBookmarkDialog(parent = 'bar') {
  const active = (state.tabs || []).find((t) => t.id === state.activeTabId);
  const defTitle = active ? active.title : '';
  const defUrl = active && !/^nazuna:/.test(active.url) ? active.url : '';
  const node = panel(`<div class="prompt">
      <h3>${iconSvg('star')} Dodawanie zakładki</h3>
      <label style="display:block;font-size:11.5px;color:var(--text-dim);margin-bottom:5px">Nazwa</label>
      <input type="text" data-f="title" class="field" value="${escapeHtml(defTitle)}" style="margin-bottom:12px">
      <label style="display:block;font-size:11.5px;color:var(--text-dim);margin-bottom:5px">Adres</label>
      <input type="text" data-f="url" class="field" value="${escapeHtml(defUrl)}" placeholder="https://" style="margin-bottom:14px">
      <div class="row">
        <button class="btn" data-cancel>Anuluj</button>
        <button class="btn primary" data-confirm>Zachowaj</button>
      </div>
    </div>`);
  openDialogPanel('addbm', node);
  const titleInput = node.querySelector('[data-f="title"]');
  const urlInput = node.querySelector('[data-f="url"]');
  const save = () => {
    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }
    const title = titleInput.value.trim();
    api.invoke('bookmarks.add', { title: title || url, url, parent });
    closePopover();
  };
  node.addEventListener('click', (e) => {
    if (e.target.closest('[data-cancel]')) return closePopover();
    if (e.target.closest('[data-confirm]')) save();
  });
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  });
  setTimeout(() => { titleInput.focus(); titleInput.select(); }, 0);
}

function addFolderDialog(parent = 'bar') {
  const node = panel(`<div class="prompt">
      <h3>${iconSvg('folder')} Dodawanie folderu zakładek</h3>
      <label style="display:block;font-size:11.5px;color:var(--text-dim);margin-bottom:5px">Nazwa</label>
      <input type="text" data-f="title" class="field" value="Nowy folder" style="margin-bottom:14px">
      <div class="row">
        <button class="btn" data-cancel>Anuluj</button>
        <button class="btn primary" data-confirm>Zachowaj</button>
      </div>
    </div>`);
  openDialogPanel('addfolder', node);
  const titleInput = node.querySelector('[data-f="title"]');
  const save = () => {
    const title = titleInput.value.trim() || 'Nowy folder';
    api.invoke('bookmarks.addFolder', { title, parent });
    closePopover();
  };
  node.addEventListener('click', (e) => {
    if (e.target.closest('[data-cancel]')) return closePopover();
    if (e.target.closest('[data-confirm]')) save();
  });
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  });
  setTimeout(() => { titleInput.focus(); titleInput.select(); }, 0);
}

el.bookmarksbar.addEventListener('contextmenu', (e) => {
  const node = e.target.closest('.bm');

  if (!node) {
    e.preventDefault();
    const hasLinks = (state.bookmarks || []).some((b) => b.type === 'link' && b.parent === 'bar');
    const p = panel(menuHtml([
      { id: 'openall', label: 'Otwórz wszystkie zakładki', icon: 'globe', enabled: hasLinks },
      { type: 'separator' },
      { id: 'addbm', label: 'Dodaj zakładkę...', icon: 'star' },
      { id: 'addfolder', label: 'Dodaj folder...', icon: 'folder' },
      { id: 'addsep', label: 'Dodaj separator' },
      { type: 'separator' },
      { id: 'togglebar', label: state.showBookmarksBar ? 'Ukryj pasek zakładek' : 'Pokaż pasek zakładek', icon: 'bookmark' },
      { type: 'separator' },
      { id: 'manage', label: 'Menedżer zakładek', icon: 'bookmark' }
    ]));
    openPanel('bmbarmenu', p, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY }, { align: 'point' });
    p.addEventListener('click', (ev) => {
      const it = ev.target.closest('.menu-item');
      if (!it) return;
      const id = it.dataset.id;
      if (id === 'openall') api.send('bookmarks.openAll', { parent: 'bar' });
      if (id === 'addbm') { addBookmarkDialog('bar'); return; }
      if (id === 'addfolder') { addFolderDialog('bar'); return; }
      if (id === 'addsep') api.invoke('bookmarks.addSeparator', { parent: 'bar' });
      if (id === 'togglebar') api.send('menu.action', { id: 'toggle-bookmarks-bar' });
      if (id === 'manage') api.send('tab.new', { url: 'nazuna://bookmarks' });
      closePopover();
    });
    return;
  }

  e.preventDefault();
  const type = node.dataset.type;
  const items = type === 'separator'
    ? [{ id: 'remove', label: 'Usuń separator', icon: 'trash', danger: true }]
    : type === 'folder'
      ? [
        { id: 'openall', label: 'Otwórz wszystkie zakładki', icon: 'globe' },
        { type: 'separator' },
        { id: 'rename', label: 'Zmień nazwę', icon: 'code' },
        { id: 'manage', label: 'Menedżer zakładek', icon: 'bookmark' },
        { id: 'remove', label: 'Usuń folder', icon: 'trash', danger: true }
      ]
      : [
        { id: 'open', label: 'Otwórz', icon: 'globe' },
        { id: 'newtab', label: 'Otwórz w nowej karcie', icon: 'plus' },
        { type: 'separator' },
        { id: 'rename', label: 'Zmień nazwę', icon: 'code' },
        { id: 'manage', label: 'Menedżer zakładek', icon: 'bookmark' },
        { id: 'remove', label: 'Usuń', icon: 'trash', danger: true }
      ];
  const p = panel(menuHtml(items));
  openPanel('bmmenu', p, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY }, { align: 'point' });
  p.addEventListener('click', (ev) => {
    const it = ev.target.closest('.menu-item');
    if (!it) return;
    const id = it.dataset.id;
    if (id === 'open') api.send('nav.go', { input: node.dataset.url });
    if (id === 'newtab') api.send('tab.new', { url: node.dataset.url, background: true });
    if (id === 'openall') api.send('bookmarks.openAll', { parent: node.dataset.id });
    if (id === 'manage') api.send('tab.new', { url: 'nazuna://bookmarks' });
    if (id === 'remove') api.invoke('bookmarks.remove', { id: node.dataset.id });
    if (id === 'rename') { closePopover(); startBmRename(node); return; }
    closePopover();
  });
});

/* --------------------------------------------------------------- omnibox */

el.address.addEventListener('focus', () => {
  el.omnibox.classList.add('focused');
  // Zaznaczamy calosc tylko, gdy nikt jeszcze nic nie wpisal - pasek dostaje
  // fokus z powrotem takze po tym, jak nowa karta na chwile go zabrala
  // (patrz newTab w window.js), a wtedy zaznaczenie sprawiloby, ze kolejna
  // litera skasuje to, co juz napisano.
  if (!addressDirty) setTimeout(() => { if (!addressDirty) el.address.select(); }, 0);
});
el.address.addEventListener('blur', () => {
  el.omnibox.classList.remove('focused');
  addressDirty = false;
  if (popover && popover.name === 'omni') setTimeout(() => { if (popover && popover.name === 'omni') closePopover(); }, 120);
});
let suggestTimer = null;
el.address.addEventListener('input', (e) => {
  addressDirty = true;
  clearTimeout(suggestTimer);
  const value = el.address.value;
  if (!value.trim()) { suggestToken++; omniItems = []; closePopover(); return; }
  // Kasowanie (Backspace/Delete) nigdy nie ma dopisywac autouzupelnienia z
  // powrotem - inaczej nie daloby sie nic skasowac, bo samo by wracalo.
  const dopisywanie = !e.inputType || !/delete/i.test(e.inputType);
  // Krotka zwloka: przy szybkim pisaniu nie strzelamy zapytaniem po kazdej literze.
  suggestTimer = setTimeout(() => requestSuggestions(value, dopisywanie), 70);
});
el.address.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!omniItems.length) return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    omniIndex += step;
    if (omniIndex >= omniItems.length) omniIndex = -1;
    if (omniIndex < -1) omniIndex = omniItems.length - 1;
    highlightOmni();
    return;
  }
  if (e.key === 'Enter') {
    const chosen = omniIndex >= 0 ? omniItems[omniIndex] : null;
    const input = chosen ? chosen.value : el.address.value;
    if (!input.trim()) return;
    addressDirty = false;
    closePopover();
    api.send('nav.go', { input });
    el.address.blur();
    return;
  }
  if (e.key === 'Escape') {
    addressDirty = false;
    closePopover();
    // Ten sam wyglad co po zwyklym odswiezeniu paska - wczesniej Escape na
    // nowej karcie wstawial do pola surowe "nazuna://newtab".
    el.address.value = adresDoPokazania();
    el.address.blur();
  }
});

function omniListHtml() {
  return omniItems.map((s, i) => `
    <div class="omni-item" data-i="${i}">
      ${iconSvg(s.kind === 'search' ? 'search' : s.kind === 'history' ? 'clock' : s.kind === 'bookmark' ? 'star' : 'globe')}
      <span class="txt">${escapeHtml(s.title)}</span>
      <span class="sub">${escapeHtml(s.subtitle || '')}</span>
    </div>`).join('');
}

function onOmniMouseDown(e) {
  const item = e.target.closest('.omni-item');
  if (!item) return;
  e.preventDefault();
  const s = omniItems[Number(item.dataset.i)];
  if (!s) return;
  addressDirty = false;
  closePopover();
  api.send('nav.go', { input: s.value });
  el.address.blur();
}

/* Autouzupelnianie "w locie" w samym pasku, tak jak w Chrome/Firefoksie - do
   tego, co ktos napisal, dopisujemy najlepsze dopasowanie z historii albo
   zakladek (nigdy z podpowiedzi wyszukiwarki - to nie sa adresy) i od razu
   zaznaczamy dopisany kawalek, zeby dalsze pisanie go nadpisalo, a Enter
   poszedl pod caly, uzupelniony adres. */
function autoUzupelnij(typed) {
  if (el.address.value !== typed) return; // wartosc juz sie zmienila, nie doganiamy
  if (el.address.selectionStart !== typed.length || el.address.selectionEnd !== typed.length) return; // kursor nie na koncu
  const lower = typed.toLowerCase();
  const match = omniItems.find((it) => (it.kind === 'history' || it.kind === 'bookmark') &&
    typeof it.subtitle === 'string' && it.subtitle.toLowerCase().startsWith(lower) && it.subtitle.toLowerCase() !== lower);
  if (!match) return;
  const pelny = typed + match.subtitle.slice(typed.length);
  el.address.value = pelny;
  el.address.setSelectionRange(typed.length, pelny.length);
}

async function requestSuggestions(query, dopisywanie = false) {
  const token = ++suggestToken;
  if (!query.trim()) { omniItems = []; closePopover(); return; }
  const results = await api.invoke('app.suggest', { query }).catch(() => []);
  if (token !== suggestToken || document.activeElement !== el.address) return;
  omniItems = results || [];
  omniIndex = -1;
  omniQuery = query;
  if (dopisywanie) autoUzupelnij(query);
  if (!omniItems.length) { closePopover(); return; }

  // Okienko powstaje raz. Potem podmieniamy sama liste, zeby nic nie mrugalo.
  if (popover && popover.name === 'omni') {
    const list = popover.el.querySelector('.omni-list');
    if (list) {
      list.innerHTML = omniListHtml();
      popover.el.style.width = `${el.omnibox.offsetWidth}px`;
      return;
    }
  }
  const node = panel(`<div class="omni-list">${omniListHtml()}</div>`);
  node.style.width = `${el.omnibox.offsetWidth}px`;
  node.addEventListener('mousedown', onOmniMouseDown);
  openPanel('omni', node, el.omnibox.getBoundingClientRect(), { align: 'left' });
}

function highlightOmni() {
  if (!popover || popover.name !== 'omni') return;
  popover.el.querySelectorAll('.omni-item').forEach((n, i) => n.classList.toggle('sel', i === omniIndex));
  if (omniIndex >= 0) el.address.value = omniItems[omniIndex].kind === 'search' ? omniItems[omniIndex].title : omniItems[omniIndex].value;
  else el.address.value = omniQuery;   // strzalka wrocila do "nic nie wybrane" - przywracamy to, co user faktycznie wpisal
}


/* ------------------------------------------------------------- zakladki */

function bookmarkChildren(parent) {
  return (state.bookmarks || []).filter((b) => b.parent === parent);
}

function bmRowHtml(b) {
  const icon = b.type === 'folder'
    ? iconSvg('folder')
    : `<span class="fav">${iconSvg('globe')}</span>`;
  return `<div class="bm-row" draggable="true" data-id="${escapeHtml(b.id)}" data-type="${escapeHtml(b.type)}" data-url="${escapeHtml(b.url || '')}"${b.type === 'link' ? ` title="${escapeHtml(b.url || '')}"` : ''}>
    ${icon}<span class="t">${escapeHtml(b.title)}</span>
    ${b.type === 'folder' ? iconSvg('chevronLeft', 'chev') : ''}
  </div>`;
}

function bmListHtml(items) {
  if (!items.length) return '<div class="bm-empty">Ten folder jest pusty.</div>';
  return items.map(bmRowHtml).join('');
}

/* Ikona strony doklada sie dopiero gdy naprawde sie wczyta. Dopoki nie, zostaje
   globus. Zadnych atrybutow onerror, bo polityka CSP i tak ich nie wykona. */
function attachFavicons(root) {
  root.querySelectorAll('.bm-row[data-type="link"]').forEach((row) => {
    const holder = row.querySelector('.fav');
    const url = row.dataset.url;
    if (!holder || !url) return;
    const img = new Image();
    img.className = 'fav-img';
    img.addEventListener('load', () => { if (holder.isConnected) holder.replaceWith(img); });
    img.src = faviconFor(url);
  });
}

// Wspolna obsluga srodkowego przycisku myszy dla wierszy .bm-row - uzywana
// zarowno w glownym panelu zakladek (wireBookmarksPanel), jak i w podmenu
// rozwijanego folderu (openBmSubmenu), bo oba renderuja te same wiersze.
function middleOpenBmRow(e) {
  if (e.button !== 1) return;
  const row = e.target.closest('.bm-row');
  if (!row || row.dataset.type === 'folder') return;
  e.preventDefault();
  api.send('tab.new', { url: row.dataset.url, background: true });
  closePopover();
}

/* Zmiana kolejnosci zakladek w menu (i w rozwinietym folderze) przez
   przeciaganie - ta sama zasada co w nazuna://bookmarks: gorna polowa
   wiersza = przed nim, dolna = za nim, srodek folderu = do folderu. */
let bmCiagniety = null;

function bmGdzieUpuscic(row, e) {
  const r = row.getBoundingClientRect();
  const wzgl = (e.clientY - r.top) / r.height;
  if (row.dataset.type === 'folder' && wzgl > 0.25 && wzgl < 0.75) return 'do';
  return wzgl < 0.5 ? 'przed' : 'po';
}

function bmWyczyscZnaczniki() {
  el.layer.querySelectorAll('.drop-przed, .drop-po, .drop-do').forEach((n) => n.classList.remove('drop-przed', 'drop-po', 'drop-do'));
}

/* Po przeniesieniu przerysowujemy liste w juz otwartym okienku, zamiast je
   zamykac i otwierac na nowo. */
function odswiezPanelZakladek() {
  if (!popover || popover.name !== 'bookmarks') return;
  el.layer.querySelectorAll('.bm-sub').forEach((n) => n.remove());
  const lista = popover.el.querySelector('.bm-list');
  const menu = [...bookmarkChildren('menu'), ...bookmarkChildren('other')];
  if (lista) { lista.innerHTML = bmListHtml(menu); attachFavicons(lista); }
}

el.layer.addEventListener('dragstart', (e) => {
  const row = e.target.closest && e.target.closest('.bm-row');
  if (!row) return;
  bmCiagniety = row.dataset.id;
  row.classList.add('ciagniety');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', row.dataset.url || row.dataset.id); } catch (_) {}
});
el.layer.addEventListener('dragover', (e) => {
  if (!bmCiagniety) return;
  const row = e.target.closest && e.target.closest('.bm-row');
  bmWyczyscZnaczniki();
  if (!row || row.dataset.id === bmCiagniety) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  row.classList.add(`drop-${bmGdzieUpuscic(row, e)}`);
});
el.layer.addEventListener('drop', async (e) => {
  if (!bmCiagniety) return;
  const row = e.target.closest && e.target.closest('.bm-row');
  bmWyczyscZnaczniki();
  const id = bmCiagniety;
  bmCiagniety = null;
  if (!row || row.dataset.id === id) return;
  e.preventDefault();
  const cel = (state.bookmarks || []).find((b) => b.id === row.dataset.id);
  if (!cel) return;
  const tryb = bmGdzieUpuscic(row, e);
  let parent = cel.parent;
  let beforeId = cel.id;
  if (tryb === 'do') { parent = cel.id; beforeId = null; }
  else if (tryb === 'po') {
    const rodzenstwo = (state.bookmarks || []).filter((b) => b.parent === cel.parent && b.id !== id);
    const i = rodzenstwo.findIndex((b) => b.id === cel.id);
    beforeId = rodzenstwo[i + 1] ? rodzenstwo[i + 1].id : null;
  }
  await api.invoke('bookmarks.move', { id, parent, beforeId });
  const swiezy = await api.invoke('app.state').catch(() => null);
  if (swiezy) state = swiezy;
  odswiezPanelZakladek();
});
el.layer.addEventListener('dragend', () => {
  bmCiagniety = null;
  bmWyczyscZnaczniki();
  el.layer.querySelectorAll('.ciagniety').forEach((n) => n.classList.remove('ciagniety'));
});

function bookmarksPanel() {
  // Tylko menu zakladek - pasek pod adresem ma osobne zakladki i tu ich nie
  // pokazujemy (jak w Firefoksie). "other" to stara nazwa menu.
  const menu = [...bookmarkChildren('menu'), ...bookmarkChildren('other')];
  const body = menu.length
    ? `<div class="bm-list">${bmListHtml(menu)}</div>`
    : '<div class="bm-empty">Menu zakładek jest puste.<br>Kliknij gwiazdkę w pasku adresu, żeby dodać tu tę stronę.</div>';

  const node = panel(`<div class="bm-panel">
    <div class="bm-head"><b>Zakładki</b><button class="btn ghost" data-manager>Menedżer</button></div>
    ${body}
    <div class="bm-foot"><div class="menu-item" data-add>${iconSvg('star')}<span>${state.bookmarked ? 'Usuń tę stronę z menu' : 'Dodaj tę stronę'}</span><span class="accel">Ctrl+D</span></div></div>
  </div>`);
  openPanel('bookmarks', node, $('#bookmarksBtn').getBoundingClientRect());
  attachFavicons(node);
  wireBookmarksPanel(node);
}

function wireBookmarksPanel(node) {
  let hoverTimer = null;

  node.addEventListener('click', (e) => {
    if (e.target.closest('[data-manager]')) { api.send('tab.new', { url: 'nazuna://bookmarks' }); return closePopover(); }
    if (e.target.closest('[data-add]')) { api.send('bookmarks.toggle'); return closePopover(); }
    const row = e.target.closest('.bm-row');
    if (!row || row.dataset.type === 'folder') return;
    api.send('nav.go', { input: row.dataset.url });
    closePopover();
  });

  node.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.bm-row');
    if (!row) return;
    e.preventDefault();
    bmContextMenu(row, e.clientX, e.clientY);
  });

  node.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.bm-ctx')) el.layer.querySelectorAll('.bm-ctx').forEach((n) => n.remove());
  });
  node.addEventListener('mousedown', middleOpenBmRow);

  node.addEventListener('mouseover', (e) => {
    const row = e.target.closest('.bm-row');
    clearTimeout(hoverTimer);
    if (!row) return;
    if (row.dataset.type !== 'folder') {
      hoverTimer = setTimeout(() => el.layer.querySelectorAll('.bm-sub').forEach((n) => n.remove()), 220);
      return;
    }
    hoverTimer = setTimeout(() => openBmSubmenu(row), 130);
  });
}

function openBmSubmenu(row) {
  el.layer.querySelectorAll('.bm-sub').forEach((n) => n.remove());
  el.layer.querySelectorAll('.bm-row.open').forEach((n) => n.classList.remove('open'));
  row.classList.add('open');

  const sub = document.createElement('div');
  sub.className = 'panel bm-sub';
  sub.innerHTML = bmListHtml(bookmarkChildren(row.dataset.id));
  el.layer.appendChild(sub);
  attachFavicons(sub);

  const view = (state && state.viewport) || { width: window.innerWidth, height: window.innerHeight };
  const anchor = row.getBoundingClientRect();
  const panelBox = popover ? popover.el.getBoundingClientRect() : anchor;
  const w = sub.offsetWidth;
  const h = sub.offsetHeight;
  let x = panelBox.left - w - 6;
  if (x < 8) x = Math.min(view.width - w - 8, panelBox.right + 6);
  const y = Math.max(8, Math.min(view.height - h - 8, anchor.top - 6));
  sub.style.left = `${Math.round(x)}px`;
  sub.style.top = `${Math.round(y)}px`;

  sub.addEventListener('click', (e) => {
    const item = e.target.closest('.bm-row');
    if (!item || item.dataset.type === 'folder') return;
    api.send('nav.go', { input: item.dataset.url });
    closePopover();
  });
  sub.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.bm-row');
    if (!item) return;
    e.preventDefault();
    bmContextMenu(item, e.clientX, e.clientY);
  });
  sub.addEventListener('mousedown', middleOpenBmRow);
}

function bmContextMenu(row, x, y) {
  el.layer.querySelectorAll('.bm-ctx').forEach((n) => n.remove());
  const isFolder = row.dataset.type === 'folder';
  const menu = document.createElement('div');
  menu.className = 'panel bm-ctx';
  menu.innerHTML = menuHtml([
    { id: 'open', label: isFolder ? 'Otwórz wszystkie w kartach' : 'Otwórz', icon: isFolder ? 'folder' : 'globe' },
    { id: 'newtab', label: 'Otwórz w nowej karcie', icon: 'plus', enabled: !isFolder },
    { type: 'separator' },
    { id: 'remove', label: 'Usuń', icon: 'trash', danger: true }
  ]);
  el.layer.appendChild(menu);

  const view = (state && state.viewport) || { width: window.innerWidth, height: window.innerHeight };
  menu.style.left = `${Math.round(Math.max(8, Math.min(view.width - menu.offsetWidth - 8, x)))}px`;
  menu.style.top = `${Math.round(Math.max(8, Math.min(view.height - menu.offsetHeight - 8, y)))}px`;

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item || item.classList.contains('disabled')) return;
    const id = item.dataset.id;
    if (id === 'open') {
      if (isFolder) api.send('bookmarks.openAll', { parent: row.dataset.id });
      else api.send('nav.go', { input: row.dataset.url });
    }
    if (id === 'newtab') api.send('tab.new', { url: row.dataset.url, background: true });
    if (id === 'remove') api.invoke('bookmarks.remove', { id: row.dataset.id });
    closePopover();
  });
}

/* ------------------------------------------------------------------ menus */

function mainMenu() {
  const zoom = Math.round((state.zoom || 1) * 100);
  const items = [
    { id: 'new-tab', label: 'Nowa karta', icon: 'plus', accel: 'Ctrl+T' },
    { id: 'new-window', label: 'Nowe okno', icon: 'window', accel: 'Ctrl+N' },
    { id: 'new-private', label: 'Okno prywatne', icon: 'incognito', accel: 'Ctrl+Shift+N' },
    { type: 'separator' },
    { type: 'custom', html: `<div class="menu-row">
        <span class="label">Powiększenie</span>
        <button class="tool" data-zoom="out">${iconSvg('zoomOut')}</button>
        <span class="zoom-value" data-zoom-value>${zoom}%</span>
        <button class="tool" data-zoom="in">${iconSvg('zoomIn')}</button>
        <button class="tool" data-zoom="reset" title="Reset">${iconSvg('check')}</button>
      </div>` },
    { type: 'separator' },
    { id: 'bookmark-page', label: state.bookmarked ? 'Usuń z zakładek' : 'Dodaj do zakładek', icon: 'star', accel: 'Ctrl+D' },
    { id: 'bookmarks', label: 'Menedżer zakładek', icon: 'bookmark', accel: 'Ctrl+Shift+O' },
    { id: 'history', label: 'Historia', icon: 'clock', accel: 'Ctrl+H' },
    { id: 'downloads', label: 'Pobrane', icon: 'download', accel: 'Ctrl+J' },
    { id: 'extensions', label: 'Rozszerzenia', icon: 'puzzle' },
    { type: 'separator' },
    { id: 'find', label: 'Znajdź na stronie', icon: 'search', accel: 'Ctrl+F' },
    { id: 'print', label: 'Drukuj', icon: 'print', accel: 'Ctrl+P' },
    { id: 'toggle-bookmarks-bar', label: state.showBookmarksBar ? 'Ukryj pasek zakładek' : 'Pokaż pasek zakładek', icon: 'bookmark' },
    { id: 'fullscreen', label: 'Pełny ekran', icon: 'fullscreen', accel: 'F11' },
    { id: 'devtools', label: 'Narzędzia dewelopera', icon: 'code', accel: 'F12' },
    { type: 'separator' },
    { id: 'settings', label: 'Ustawienia', icon: 'settings' },
    { id: 'about', label: 'O Nazunie', icon: 'info' },
    { id: 'quit', label: 'Zamknij przeglądarkę', icon: 'x' }
  ];
  const node = panel(menuHtml(items));
  node.style.minWidth = '268px';
  openPanel('menu', node, $('#menu').getBoundingClientRect());
  node.addEventListener('click', (e) => {
    const zoomBtn = e.target.closest('[data-zoom]');
    if (zoomBtn) {
      const kind = zoomBtn.dataset.zoom;
      api.send('menu.action', { id: kind === 'in' ? 'zoom-in' : kind === 'out' ? 'zoom-out' : 'zoom-reset' });
      return;
    }
    const item = e.target.closest('.menu-item');
    if (!item || item.classList.contains('disabled')) return;
    api.send('menu.action', { id: item.dataset.id });
    if (!['zoom-in', 'zoom-out', 'zoom-reset'].includes(item.dataset.id)) closePopover(true);
  });
}

function shieldMenu() {
  const on = state.adblockEnabled && state.adblockSite;
  const node = panel(`
    <div class="menu-title">Bloker treści</div>
    <div class="menu-item" data-id="site">
      ${iconSvg(on ? 'shield' : 'shieldOff')}
      <span>${on ? 'Wyłącz na' : 'Włącz na'} ${escapeHtml(state.host || 'tej stronie')}</span>
    </div>
    <div class="menu-item" data-id="global">
      ${iconSvg('settings')}<span>${state.adblockEnabled ? 'Wyłącz wszędzie' : 'Włącz wszędzie'}</span>
    </div>
    <div class="menu-sep"></div>
    <div class="menu-row"><span class="label">Zablokowano na tej stronie</span><b>${state.blockedCount || 0}</b></div>
    <div class="menu-row"><span class="label">Tryb</span><span class="tag">${state.adblockMode === 'aggressive' ? 'agresywny' : 'bezpieczny'}</span></div>
  `);
  node.style.minWidth = '270px';
  openPanel('shield', node, el.shield.getBoundingClientRect());
  node.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    if (item.dataset.id === 'site' && state.host) api.send('app.adblockSite', { host: state.host, enabled: !state.adblockSite });
    if (item.dataset.id === 'global') api.invoke('settings.set', { patch: { adblockEnabled: !state.adblockEnabled } });
    closePopover();
  });
}

/* ------------------------------------------------------------- downloads */

function bytes(n) {
  if (!n && n !== 0) return '';
  const units = ['B', 'kB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function downloadsPanel() {
  const node = panel('<div class="dl-panel"></div>');
  openPanel('downloads', node, $('#downloads').getBoundingClientRect());
  refreshDownloadsPanel(node);
  node.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'clear') downloadsCache = await api.invoke('downloads.clear');
      else downloadsCache = await api.invoke('downloads.control', { id: act.dataset.dl, action: act.dataset.act });
      refreshDownloadsPanel(node);
      renderToolbar();
      return;
    }
    const openAll = e.target.closest('[data-open-page]');
    if (openAll) { api.send('tab.new', { url: 'nazuna://downloads' }); closePopover(); }
  });
}

function refreshDownloadsPanel(node) {
  const box = node.querySelector('.dl-panel');
  if (!box) return;
  const list = downloadsCache.slice(0, 8);
  box.innerHTML = `
    <div class="dl-head"><b>Pobrane</b>
      <button class="btn ghost" data-open-page>Wszystkie</button>
      <button class="btn ghost" data-act="clear">Wyczyść</button>
    </div>
    ${list.length ? list.map(downloadRow).join('') : '<div class="dl-empty">Nic jeszcze nie pobrano</div>'}`;
}

function downloadRow(d) {
  const done = d.state === 'completed';
  const pct = d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
  const meta = done
    ? bytes(d.total)
    : d.state === 'progressing'
      ? `${bytes(d.received)} z ${d.total ? bytes(d.total) : '?'}${d.speed ? ` - ${bytes(d.speed)}/s` : ''}`
      : d.state === 'paused' ? 'Wstrzymane'
        : d.state === 'cancelled' ? 'Anulowane' : 'Nie udało się pobrać';
  return `<div class="dl-item">
    <div class="dl-icon">${iconSvg(done ? 'file' : 'download')}</div>
    <div class="dl-body">
      <div class="dl-name" title="${escapeHtml(d.filename)}">${escapeHtml(d.filename)}</div>
      <div class="dl-meta">${escapeHtml(meta)}</div>
      ${!done && (d.state === 'progressing' || d.state === 'paused') ? `<div class="dl-bar"><i style="width:${pct}%"></i></div>` : ''}
    </div>
    <div class="dl-actions">
      ${done ? `<button class="omni-btn" data-act="open" data-dl="${d.id}" title="Otwórz">${iconSvg('external')}</button>
                <button class="omni-btn" data-act="folder" data-dl="${d.id}" title="Pokaż w folderze">${iconSvg('folder')}</button>` : ''}
      ${d.state === 'progressing' ? `<button class="omni-btn" data-act="pause" data-dl="${d.id}" title="Wstrzymaj">${iconSvg('pause')}</button>` : ''}
      ${d.state === 'paused' ? `<button class="omni-btn" data-act="resume" data-dl="${d.id}" title="Wznów">${iconSvg('play')}</button>` : ''}
      ${(d.state === 'progressing' || d.state === 'paused') ? `<button class="omni-btn" data-act="cancel" data-dl="${d.id}" title="Anuluj">${iconSvg('x')}</button>` : ''}
      ${done || d.state === 'cancelled' || d.state === 'failed' ? `<button class="omni-btn" data-act="remove" data-dl="${d.id}" title="Usuń z listy">${iconSvg('trash')}</button>` : ''}
    </div>
  </div>`;
}

/* --------------------------------------------------------- context menus */

function showContextMenu(payload) {
  const node = panel(menuHtml(payload.items.map((i) => ({ ...i, icon: contextIcon(i.id) }))));
  node.style.minWidth = '230px';
  openPanel('context', node, { left: payload.x, top: payload.y, right: payload.x, bottom: payload.y }, { align: 'point' });
  /* Klikniecie w pozycje menu normalnie zabiera kursor z pola tekstowego, bo
     pozycje to zwykle kafelki, a nie pola. Wtedy Wklej nie mialoby dokad
     wkleic. Blokujemy domyslna reakcje na wcisniecie przycisku, przez co
     kursor zostaje tam, gdzie byl, a samo klikniecie dziala normalnie. */
  node.addEventListener('mousedown', (e) => e.preventDefault());
  node.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item || item.classList.contains('disabled')) return;
    api.send('context.action', { id: item.dataset.id });
    closePopover(true);
  });
}

function contextIcon(id) {
  const map = {
    'open-link-tab': 'plus', 'open-link-window': 'window', 'open-link-private': 'incognito',
    'copy-link': 'copy', 'save-link': 'download', 'open-image': 'plus', 'copy-image': 'copy',
    'copy-image-url': 'copy', 'save-image': 'download', 'save-media': 'download', 'copy-media-url': 'copy',
    undo: 'back', redo: 'forward', cut: 'x', copy: 'copy', paste: 'clipboard', 'select-all': 'check',
    'search-selection': 'search', back: 'back', forward: 'forward', reload: 'reload',
    'save-page': 'download', print: 'print', inspect: 'code'
  };
  return map[id] || null;
}

function permissionPrompt(payload) {
  const labels = {
    media: ['Dostęp do kamery i mikrofonu', 'camera'],
    geolocation: ['Dostęp do lokalizacji', 'pin'],
    notifications: ['Wysyłanie powiadomień', 'bell'],
    'clipboard-read': ['Odczyt schowka', 'clipboard'],
    'display-capture': ['Udostępnianie ekranu', 'screen'],
    midi: ['Dostęp do urządzeń MIDI', 'usb'],
    hid: ['Dostęp do urządzeń HID', 'usb'],
    serial: ['Dostęp do portu szeregowego', 'usb'],
    usb: ['Dostęp do urządzeń USB', 'usb'],
    'idle-detection': ['Wykrywanie bezczynności', 'clock'],
    'storage-access': ['Element osadzony prosi o swoje ciasteczka', 'file'],
    'window-management': ['Odczyt układu Twoich monitorów', 'window'],
    'window-placement': ['Odczyt układu Twoich monitorów', 'window']
  };
  const [label, icon] = labels[payload.permission] || ['Uprawnienie: ' + payload.permission, 'info'];
  /* Przy dostępie do danych osadzonej witryny sama nazwa domeny nikomu nic nie
     mówi. Tłumaczymy, co jest w co wstawione i po co to zwykle bywa potrzebne. */
  const tresc = payload.permission === 'storage-access' && payload.osadzona
    ? `<p><b>${escapeHtml(payload.osadzona)}</b> jest osadzony na stronie <b>${escapeHtml(payload.strona || 'tej')}</b>
         i prosi o dostęp do swoich ciasteczek.</p>
       <p class="sub">Zwykle potrzebne przy logowaniu, płatnościach i weryfikacji dwuetapowej.
         Blokujemy to domyślnie, bo tędy płynie też śledzenie między stronami.</p>`
    : `<p><b>${escapeHtml(payload.origin || 'Ta strona')}</b> prosi o zgodę.</p>`;
  const node = panel(`<div class="prompt">
      <h3>${iconSvg(icon)} ${escapeHtml(label)}</h3>
      ${tresc}
      <label class="remember"><span class="switch"><input type="checkbox" id="rememberPerm"><span class="track"></span><span class="thumb"></span></span> Zapamiętaj ten wybór</label>
      <div class="row">
        <button class="btn" data-answer="deny">Zablokuj</button>
        <button class="btn primary" data-answer="allow">Zezwól</button>
      </div>
    </div>`);
  node.dataset.permKey = payload.key;
  openPanel('permission', node, el.omnibox.getBoundingClientRect(), { align: 'left' });
  node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-answer]');
    if (!b) return;
    node.dataset.answered = '1';
    api.send('permission.answer', {
      key: payload.key,
      answer: b.dataset.answer,
      remember: node.querySelector('#rememberPerm').checked
    });
  });
}

/* ---------------------------------------------------------------- events */

$('#back').addEventListener('click', () => api.send('nav.back'));
$('#forward').addEventListener('click', () => api.send('nav.forward'));
$('#reload').addEventListener('click', () => (state && state.loading ? api.send('tab.stop') : api.send('tab.reload', {})));
$('#home').addEventListener('click', () => api.send('nav.home'));
el.newtab.addEventListener('click', () => api.send('tab.new', {}));
$('#bookmarksBtn').addEventListener('click', () => (popover && popover.name === 'bookmarks' ? closePopover() : bookmarksPanel()));
$('#menu').addEventListener('click', () => (popover && popover.name === 'menu' ? closePopover() : mainMenu()));
$('#downloads').addEventListener('click', async () => {
  if (popover && popover.name === 'downloads') return closePopover();
  downloadsCache = await api.invoke('downloads.list');
  downloadsPanel();
});
el.star.addEventListener('click', () => api.send('bookmarks.toggle'));
el.shield.addEventListener('click', () => (popover && popover.name === 'shield' ? closePopover() : shieldMenu()));

async function installFromWebstorePage() {
  if (el.webstoreInstall.classList.contains('busy')) return;
  const url = state.url;
  el.webstoreInstall.classList.add('busy');
  try {
    const r = await api.invoke('extensions.install', { input: url });
    // Wynik pokazuje warstwa powiadomien (toast.js), nie pasek.
    api.send('toast.rozszerzenie', { ok: true, nazwa: r.name });
  } catch (err) {
    api.send('toast.rozszerzenie', { ok: false, blad: String((err && err.message) || err).replace(/^Error: /, '') });
  } finally {
    el.webstoreInstall.classList.remove('busy');
  }
}
el.webstoreInstall.addEventListener('click', installFromWebstorePage);
el.zoomChip.addEventListener('click', () => api.send('zoom.reset'));
$('#min').addEventListener('click', () => api.send('window.minimize'));
$('#max').addEventListener('click', () => api.send('window.maximize'));
$('#close').addEventListener('click', () => api.send('window.close'));

$('#findClose').addEventListener('click', () => api.send('find.close'));
$('#findNext').addEventListener('click', () => api.send('find.next', { text: el.findInput.value }));
$('#findPrev').addEventListener('click', () => api.send('find.prev', { text: el.findInput.value }));
el.findInput.addEventListener('input', () => {
  if (!el.findInput.value) { el.findCount.textContent = ''; }
  api.send('find.query', { text: el.findInput.value });
});
el.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') api.send(e.shiftKey ? 'find.prev' : 'find.next', { text: el.findInput.value });
  if (e.key === 'Escape') api.send('find.close');
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (popover || el.layer.firstChild || document.body.classList.contains('expanded')) { forceClose(); return; }
  if (state && state.findOpen) { api.send('find.close'); return; }
  if (document.activeElement === el.address) { addressDirty = false; el.address.blur(); renderToolbar(); }
});

window.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('input')) e.preventDefault();
});

api.on('state', (next) => {
  state = next;
  syncLayer(next);
  renderTabs();
  renderToolbar();
  renderBookmarks();
  renderExtensions();
  el.findbar.hidden = !state.findOpen;
  const layout = state.layout;
  el.chrome.style.height = `${layout.tabStrip + layout.toolbar + (state.showBookmarksBar ? layout.bookmarksBar : 0) + (state.findOpen ? layout.findBar : 0)}px`;
  // Menu buduje sie raz przy otwarciu, wiec bez tego wartosc powiekszenia
  // zamrazala sie na tym, co bylo w chwili kliknieccia - klikniecia +/-
  // dzialaly, ale liczba obok nie ruszala sie, dopoki nie zamknieto menu.
  if (popover && popover.name === 'menu') {
    const zoomEl = popover.el.querySelector('[data-zoom-value]');
    if (zoomEl) zoomEl.textContent = `${Math.round((state.zoom || 1) * 100)}%`;
  }
});

/** Proces glowny jest jedynym zrodlem prawdy o tym, czy warstwa jest rozwinieta. */
function syncLayer(next) {
  // Stan wyslany tuz przed otwarciem okienka moglby je skasowac, wiec dajemy mu chwile.
  const settled = Date.now() - layerTouchedAt > 400;
  const hasPanel = !!el.layer.firstChild;
  if (next.expanded) {
    document.body.classList.add('expanded');
    // Warstwa lapie klikniecia, a nie ma czego pokazac: zwin ja, zamiast blokowac strone.
    // Wyjatek: podczas przeciagania karty warstwa jest rozwinieta celowo, zeby
    // trzymana karta mogla wyjsc poza pasek.
    if (settled && !hasPanel && !next.popover && !next.przeciaganie) api.send('ui.popover', { name: null });
  } else {
    if (!settled) return;
    document.body.classList.remove('expanded');
    if (hasPanel) { el.layer.innerHTML = ''; popover = null; }
  }
}

api.on('popover:show', ({ name, payload }) => {
  if (name === 'context') showContextMenu(payload);
  else if (name === 'permission') permissionPrompt(payload);
  else if (name === 'downloads') { api.invoke('downloads.list').then((l) => { downloadsCache = l; downloadsPanel(); }); }
  else if (name === 'ext-popup') { closePopover(true); document.body.classList.add('expanded'); }
});
api.on('popover:hide', () => closePopover(true));
let fsHintTimer = null;
api.on('fullscreen:hint', () => {
  clearTimeout(fsHintTimer);
  document.querySelector('.fs-hint')?.remove();
  const hint = document.createElement('div');
  hint.className = 'fs-hint';
  hint.innerHTML = `${iconSvg('fullscreen')}<span>Strona przeszła w tryb pełnoekranowy. Wyjdziesz klawiszem</span><kbd>Esc</kbd>`;
  document.body.appendChild(hint);
  fsHintTimer = setTimeout(() => {
    hint.classList.add('leaving');
    setTimeout(() => hint.remove(), 500);
  }, 3400);
});

api.on('find:focus', () => setTimeout(() => { el.findInput.focus(); el.findInput.select(); }, 40));
api.on('find:result', (r) => {
  el.findCount.textContent = r && r.matches ? `${r.active}/${r.matches}` : (el.findInput.value ? '0/0' : '');
});
/* Patrz komentarz przy wc.on('focus', ...) w main/window.js - to naprawia
   pasek adresu zostajacy pusty na stale po nawigacji zainicjowanej
   kliknieciem w strone (nie w sam pasek), gdy pole adresu bylo akurat
   aktywne z wczesniej. */
api.on('address:blur', () => {
  addressDirty = false;
  if (document.activeElement === el.address) el.address.blur();
  renderToolbar();
});
api.on('focus:address', (payload) => {
  // Oddanie fokusu po tym, jak strona go na chwile zabrala - bez czyszczenia
  // i bez zaznaczania tego, co ktos zdazyl wpisac.
  if (payload && payload.zachowaj) {
    if (document.activeElement !== el.address) el.address.focus();
    return;
  }
  addressDirty = false;
  // Gdy to pusta nowa karta (payload.clear), czyscimy pasek od razu, zamiast
  // czekac na nastepny sync() ze stanem - renderToolbar() i tak nie
  // nadpisze wartosci pola, ktore ma fokus (zeby nie kasowac tego, co ktos
  // sam wpisuje), wiec bez tego przez chwile widac tam adres poprzedniej
  // karty. Dla zwyklego Ctrl+L wartosc zostaje, ma sie dac od razu edytowac.
  if (payload && payload.clear) el.address.value = '';
  el.address.focus();
  el.address.select();
});
api.on('download-started', (d) => { upsertDownload(d); flashDownloads(); });
api.on('download-updated', upsertDownload);
api.on('download-done', (d) => { upsertDownload(d); flashDownloads(); });
api.on('bookmarks:changed', () => {});
api.on('extensions:changed', () => api.invoke('app.state').then((s) => { state = s; renderExtensions(); }));

function upsertDownload(d) {
  const i = downloadsCache.findIndex((x) => x.id === d.id);
  if (i >= 0) downloadsCache[i] = d; else downloadsCache.unshift(d);
  if (popover && popover.name === 'downloads') refreshDownloadsPanel(popover.el);
  renderToolbar();
}

let flashTimer = null;
function flashDownloads() {
  const b = $('#downloads');
  b.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => b.classList.remove('on'), 1600);
}

api.invoke('downloads.list').then((l) => { downloadsCache = l || []; renderToolbar(); }).catch(() => {});
api.invoke('app.state').then((s) => { if (s) { state = s; renderTabs(); renderToolbar(); renderBookmarks(); renderExtensions(); } }).catch(() => {});
