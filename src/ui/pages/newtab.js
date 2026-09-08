
/* Motyw i akcent, tak samo jak na pozostalych stronach wewnetrznych. Nowa karta
   nie wciaga pagekit.js, wiec ma wlasna, krotka wersje tego samego. */
(function wyglad() {
  const zastosuj = (s) => {
    if (!s) return;
    const root = document.documentElement;
    if (s.values && s.values.accent) root.dataset.accent = s.values.accent;
    root.dataset.motyw = s.motyw || 'ciemny';
  };
  const odswiez = () => window.nazuna.invoke('settings.get').then(zastosuj).catch(() => {});
  odswiez();
  if (window.nazuna.on) window.nazuna.on('settings:changed', odswiez);
})();
const api = window.nazuna;
document.getElementById('searchIcon').innerHTML = iconSvg('search');

document.getElementById('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = document.getElementById('q').value.trim();
  if (value) api.send('nav.go', { input: value });
});

document.querySelectorAll('[data-go]').forEach((b) => {
  b.addEventListener('click', () => api.send('nav.go', { input: b.dataset.go }));
});

const FALLBACK = [
  { url: 'https://www.youtube.com', label: 'YouTube' },
  { url: 'https://gemini.google.com', label: 'Gemini' },
  { url: 'https://www.google.com', label: 'Google' },
  { url: 'https://chat.openai.com', label: 'ChatGPT' },
  { url: 'https://pl.wikipedia.org', label: 'Wikipedia' },
  { url: 'https://github.com', label: 'GitHub' }
];

/* Ile kafelkow lacznie (wlasne + z historii), nie liczac przycisku "dodaj". */
const LIMIT = 10;

function originOf(url) {
  try {
    const u = new URL(url);
    if (!u.hostname) return null;   // np. file:// - nie ma z czego zrobic sensownego kafelka
    return { origin: u.origin, host: u.hostname.replace(/^www\./, '') };
  }
  catch (_) { return null; }
}

/* Kafelki z historii, z pominieciem hostow schowanych recznie (ukryte) i tych,
   ktore juz sa dopiete na sztywno (pinnedHosts) - zeby nie dublowac. */
async function autoSites(ukryte, pinnedHosts) {
  const history = await api.invoke('history.search', { query: '', limit: 4000 }).catch(() => []);
  const counts = new Map();
  for (const item of history) {
    const o = originOf(item.url);
    if (!o || ukryte.includes(o.host) || pinnedHosts.has(o.host)) continue;
    const hit = counts.get(o.origin) || { ...o, n: 0 };
    hit.n += 1;
    counts.set(o.origin, hit);
  }
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n);
  const seen = new Set(ranked.map((r) => r.host));
  for (const f of FALLBACK) {
    const o = originOf(f.url);
    if (o && !seen.has(o.host) && !ukryte.includes(o.host) && !pinnedHosts.has(o.host)) { ranked.push({ ...o, n: 0 }); seen.add(o.host); }
  }
  return ranked;
}

/* Kafelek. Etykieta i nazwa hosta trafiaja przez textContent, nie innerHTML -
   etykieta wlasnych skrotow pochodzi od uzytkownika. */
function tile(site, onRemove) {
  const wrap = document.createElement('div');
  wrap.className = 'tile-wrap';

  const btn = document.createElement('button');
  btn.className = 'tile';
  btn.title = site.origin;

  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.textContent = (site.label || site.host || '?').charAt(0).toUpperCase();
  const label = document.createElement('span');
  label.textContent = site.label || site.host;
  btn.appendChild(glyph);
  btn.appendChild(label);
  btn.addEventListener('click', () => api.send('nav.go', { input: site.origin }));
  // Delikatny "reflektorek" podazajacy za kursorem (patrz .tile::before w
  // pages.css) - drobiazg, ale to wlasnie takie detale odrozniaja dopracowany
  // interfejs od plaskiego.
  btn.addEventListener('mousemove', (e) => {
    const r = btn.getBoundingClientRect();
    btn.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    btn.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  });

  const img = new Image();
  img.onload = () => { glyph.textContent = ''; glyph.appendChild(img); };
  img.src = `${site.origin}/favicon.ico`;

  wrap.appendChild(btn);

  const usun = document.createElement('button');
  usun.type = 'button';
  usun.className = 'tile-remove';
  usun.title = 'Usuń kafelek';
  usun.innerHTML = iconSvg('x');
  usun.addEventListener('click', (e) => { e.stopPropagation(); onRemove(site); });
  wrap.appendChild(usun);

  return wrap;
}

function addTileNode(onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tile tile-add';
  btn.title = 'Dodaj kafelek';
  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.innerHTML = iconSvg('plus');
  const label = document.createElement('span');
  label.textContent = 'Dodaj';
  btn.appendChild(glyph);
  btn.appendChild(label);
  btn.addEventListener('click', onClick);
  return btn;
}

const box = document.getElementById('tiles');
const addForm = document.getElementById('addForm');
const addUrl = document.getElementById('addUrl');
const addLabel = document.getElementById('addLabel');
const addErr = document.getElementById('addErr');

function pokazForm(on) {
  addForm.hidden = !on;
  addErr.hidden = true;
  addErr.textContent = '';
  if (on) { addUrl.value = ''; addLabel.value = ''; addUrl.focus(); }
}

document.getElementById('addCancel').addEventListener('click', () => pokazForm(false));

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const wynik = await api.invoke('newtab.skroty.dodaj', { url: addUrl.value.trim(), label: addLabel.value.trim() }).catch(() => null);
  if (!wynik || wynik.error) {
    addErr.textContent = (wynik && wynik.error) || 'Nie udało się dodać.';
    addErr.hidden = false;
    return;
  }
  pokazForm(false);
  render();
});

async function usunKafelek(site) {
  await api.invoke('newtab.skroty.usun', { origin: site.origin, host: site.host }).catch(() => {});
  render();
}

async function render() {
  const stan = await api.invoke('newtab.skroty').catch(() => ({ przypiete: [], ukryte: [] }));
  const przypiete = stan.przypiete || [];
  const ukryte = stan.ukryte || [];
  const pinnedHosts = new Set(przypiete.map((s) => s.host));
  const auto = await autoSites(ukryte, pinnedHosts);
  const wolneMiejsca = Math.max(0, LIMIT - przypiete.length);
  const sites = [...przypiete, ...auto.slice(0, wolneMiejsca)];

  box.innerHTML = '';
  sites.forEach((s) => box.appendChild(tile(s, usunKafelek)));
  box.appendChild(addTileNode(() => pokazForm(true)));
}

/* Strona pokazuje sie dopiero, gdy kafelki sa gotowe - patrz .nt-ready w
   pages.css. Limit czasu na wszelki wypadek, gdyby IPC sie zacielo. */
function pokazStrone() {
  document.body.classList.add('nt-ready');
}
const zabezpieczenie = setTimeout(pokazStrone, 400);
render().catch(() => {}).finally(() => { clearTimeout(zabezpieczenie); pokazStrone(); });
if (api.on) api.on('skroty:zmiana', render);

window.addEventListener('load', () => document.getElementById('q').focus());
