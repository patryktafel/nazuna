/* Wspolne drobiazgi dla stron wewnętrznych */
const api = window.nazuna;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Zastepcza ikona strony: pierwsza litera domeny. Dawniej bralismy
   <origin>/favicon.ico, ale wtedy samo otwarcie historii czy zakladek
   laczylo sie z kazdym serwisem z listy (setki zapytan z naszym IP),
   a favicon nigdzie lokalnie nie przechowujemy. */
function favLitera(url) {
  const h = hostOf(url) || String(url || '');
  const z = (h.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  return `<span class="fav fav-litera" aria-hidden="true">${esc(z)}</span>`;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}

function timeAgo(ts) {
  const d = Date.now() - ts;
  const min = Math.floor(d / 60000);
  if (min < 1) return 'przed chwilą';
  if (min < 60) return `${min} min temu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} godz. temu`;
  return new Date(ts).toLocaleDateString('pl-PL');
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Dzisiaj';
  if (same(d, yesterday)) return 'Wczoraj';
  return d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function bytes(n) {
  if (!n && n !== 0) return '';
  const units = ['B', 'kB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function head(title, iconName, extra = '') {
  return `<div class="page-head">
    <h1>${iconSvg(iconName)} ${esc(title)}</h1>
    <div class="grow"></div>
    ${extra}
  </div>`;
}

function toast(message) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:28px;background:var(--surface-2);border:1px solid var(--border-strong);border-radius:10px;padding:11px 18px;box-shadow:var(--shadow-panel);font-size:12.5px;z-index:50';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* Motyw i kolor akcentu na stronach wewnetrznych. Ustawiamy je przy wczytaniu
   i odswiezamy, gdy ustawienia sie zmienia, zeby przelaczenie motywu bylo
   widac od razu we wszystkich otwartych kartach, a nie dopiero po odswiezeniu. */
function zastosujWyglad(s) {
  if (!s) return;
  const root = document.documentElement;
  if (s.values && s.values.accent) root.dataset.accent = s.values.accent;
  root.dataset.motyw = s.motyw || 'ciemny';
  root.dataset.mgla = (s.values && s.values.mglaKolory) || 'lawenda';
  // Strony, ktore rysuja cos zaleznego od motywu (np. probki kolorow), musza
  // przerysowac sie DOPIERO teraz. Rozgloszenie z procesu glownego przychodzi
  // wczesniej, zanim poznamy nowy motyw, wiec nadajemy wlasny sygnal.
  try { document.dispatchEvent(new CustomEvent('motyw:gotowy')); } catch (_) {}
}

function odswiezWyglad() {
  api.invoke('settings.get').then(zastosujWyglad).catch(() => {});
}

odswiezWyglad();

if (api.on) api.on('settings:changed', odswiezWyglad);
