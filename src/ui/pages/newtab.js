
/* Motyw i akcent, tak samo jak na pozostalych stronach wewnetrznych. Nowa karta
   nie wciaga pagekit.js, wiec ma wlasna, krotka wersje tego samego. */
(function wyglad() {
  const zastosuj = (s) => {
    if (!s) return;
    const root = document.documentElement;
    if (s.values && s.values.accent) root.dataset.accent = s.values.accent;
    root.dataset.motyw = s.motyw || 'ciemny';
    root.dataset.mgla = (s.values && s.values.mglaKolory) || 'lawenda';
    if (s.values && s.values.wyglad === 'washi' && !s.prywatne) root.dataset.washi = s.washiNoc ? 'noc' : 'dzien'; else delete root.dataset.washi;
    if (s.values && s.values.wyglad === 'engawa' && !s.prywatne) root.dataset.engawa = s.engawaNoc ? 'noc' : 'dzien'; else delete root.dataset.engawa;
    if (s.values && s.values.wyglad === 'satoyama' && !s.prywatne) root.dataset.satoyama = s.satoyamaNoc ? 'noc' : 'dzien'; else delete root.dataset.satoyama;
    if (s.prywatne) root.dataset.prywatne = '1'; else delete root.dataset.prywatne;
    const info = document.getElementById('prywatneInfo');
    if (info) info.hidden = !s.prywatne;
  };
  const odswiez = () => window.nazuna.invoke('settings.get').then(zastosuj).catch(() => {});
  odswiez();
  if (window.nazuna.on) window.nazuna.on('settings:changed', odswiez);
})();
const api = window.nazuna;
document.getElementById('searchIcon').innerHTML = iconSvg('search');

// Ten pasek to wylacznie wyszukiwarka, nie ogolny pasek adresu - wpisany
// tekst zawsze idzie do wyszukiwarki (nav.search), nawet jesli wyglada jak
// adres strony. Kto chce od razu wpisac adres, ma do tego gorny pasek.
document.getElementById('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = document.getElementById('q').value.trim();
  if (value) api.send('nav.search', { input: value });
});

document.querySelectorAll('[data-go]').forEach((b) => {
  b.addEventListener('click', () => api.send('nav.go', { input: b.dataset.go }));
});

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
  // Srodkowy przycisk myszy - otwiera kafelek w nowej karcie w tle, tak jak
  // w kazdej innej przegladarce, zamiast podmieniac ta strone startowa.
  btn.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    api.send('tab.new', { url: site.origin, background: true });
  });
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

/* Kafelki to wylacznie to, co ktos sam tu dopiał - zadnego automatycznego
   podpowiadania na podstawie historii przegladania. Dzieki temu strona nowej
   karty nie zdradza (i nie podmienia losowo) tego, co ktos akurat ostatnio
   przegladal. */
async function render() {
  const stan = await api.invoke('newtab.skroty').catch(() => ({ przypiete: [] }));
  const przypiete = (stan && stan.przypiete) || [];

  box.innerHTML = '';
  przypiete.forEach((s) => box.appendChild(tile(s, usunKafelek)));
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

/* Kursor domyslnie stoi w pasku adresu na gorze (patrz newTab() w window.js,
   wysyla 'focus:address'), tak jak w Chrome i Firefoksie - to okienko
   wyszukiwania na srodku jest tylko dla kogos, kto woli kliknac tutaj. */

/* ------------------------------------------- Lawendowa mgla: zegar i licznik
   Zegar, powitanie i licznik widac tylko w wygladzie mgly (CSS w pages.css),
   ale licza sie zawsze - przelaczenie wygladu dziala wtedy od razu. */
const POWITANIA = [
  [5, 10, 'Dzień dobry. Miłego poranka.'],
  [10, 17, 'Dzień dobry. Miłego dnia.'],
  [17, 22, 'Dobry wieczór. Spokojnego przeglądania.'],
  [22, 24, 'Późno już. Może jeszcze chwilka?'],
  [0, 5, 'Późno już. Może jeszcze chwilka?']
];
/* Washi: dawne japonskie nazwy miesiecy (kalendarz ksiezycowy, dzis uzywane
   poetycko) i japonskie powitanie wg pory dnia. Widac tylko w Washi (washi.css). */
const MIESIACE_JP = [
  ['睦月', 'Mutsuki', 'miesiąc przyjaźni'], ['如月', 'Kisaragi', 'miesiąc ciepłych ubrań'],
  ['弥生', 'Yayoi', 'miesiąc rozkwitu'], ['卯月', 'Uzuki', 'miesiąc kwiatów deucji'],
  ['皐月', 'Satsuki', 'miesiąc sadzenia ryżu'], ['水無月', 'Minazuki', 'miesiąc wody'],
  ['文月', 'Fumizuki', 'miesiąc listów'], ['葉月', 'Hazuki', 'miesiąc liści'],
  ['長月', 'Nagatsuki', 'miesiąc długich nocy'], ['神無月', 'Kannazuki', 'miesiąc bez bogów'],
  ['霜月', 'Shimotsuki', 'miesiąc szronu'], ['師走', 'Shiwasu', 'miesiąc pędzących mnichów']
];
const POWITANIA_JP = [
  [5, 10, 'おはよう · ohayō'], [10, 17, 'こんにちは · konnichiwa'],
  [17, 22, 'こんばんは · konbanwa'], [22, 24, 'おやすみ · oyasumi'], [0, 5, 'おやすみ · oyasumi']
];
function odswiezZegar() {
  const teraz = new Date();
  document.getElementById('czas').textContent =
    `${String(teraz.getHours()).padStart(2, '0')}:${String(teraz.getMinutes()).padStart(2, '0')}`;
  const h = teraz.getHours();
  const p = POWITANIA.find(([od, do_]) => h >= od && h < do_);
  document.getElementById('powitanie').textContent = p ? p[2] : '';
  const m = MIESIACE_JP[teraz.getMonth()];
  document.getElementById('jpMiesiac').textContent = `${m[0]}  ·  ${m[1]}  ·  ${m[2]}`;
  const pj = POWITANIA_JP.find(([od, do_]) => h >= od && h < do_);
  document.getElementById('jpPowitanie').textContent = pj ? pj[2] : '';
  // Nastepne odswiezenie rowno z poczatkiem kolejnej minuty.
  setTimeout(odswiezZegar, 60000 - (teraz.getSeconds() * 1000 + teraz.getMilliseconds()) + 50);
}
odswiezZegar();

// 1 element, 2-4 elementy, 5+ elementow (ale 12-14 elementow).
function elementy(n) {
  if (n === 1) return 'element śledzący';
  const j = n % 10, d = n % 100;
  if (j >= 2 && j <= 4 && !(d >= 12 && d <= 14)) return 'elementy śledzące';
  return 'elementów śledzących';
}
document.getElementById('licznikIkona').innerHTML = iconSvg('shield');
async function odswiezLicznik() {
  const w = await api.invoke('newtab.blokadyDzis').catch(() => null);
  const el = document.getElementById('licznik');
  if (!w || !w.wlaczony || !w.ile) { el.hidden = true; return; }
  document.getElementById('licznikTekst').textContent =
    `Dziś Nazuna zatrzymała ${w.ile.toLocaleString('pl-PL')} ${elementy(w.ile)}`;
  el.hidden = false;
}
odswiezLicznik();
setInterval(() => { if (!document.hidden) odswiezLicznik(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) odswiezLicznik(); });
