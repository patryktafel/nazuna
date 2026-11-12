const api = window.nazuna;

const params = new URLSearchParams(location.search);
const src = params.get('src') || '';

const el = {
  title: document.getElementById('title'),
  status: document.getElementById('status'),
  scroll: document.getElementById('scroll'),
  lines: document.getElementById('lines'),
  text: document.getElementById('text'),
  format: document.getElementById('format'),
  copy: document.getElementById('copy'),
  download: document.getElementById('download')
};

el.copy.querySelector('.icon').innerHTML = iconSvg('copy');
el.download.querySelector('.icon').innerHTML = iconSvg('download');
el.format.querySelector('.icon').innerHTML = iconSvg('code');

/* Wyglad: ta strona nie laduje pagekit.js, wiec motyw ustawiamy sami. Atrybuty
   z ustawien dostaje tylko Lawendowa mgla (style pod :root[data-motyw="mgla"]
   w textview.html). Klasyczny zostaje dokladnie taki jak byl: bez data-motyw i ze stalym
   data-accent="violet" z pliku html. Odswiezamy po zmianie ustawien, zeby
   przelaczenie wygladu bylo widac od razu. */
function zastosujWyglad(s) {
  if (!s) return;
  const root = document.documentElement;
  if (s.motyw === 'mgla') {
    root.dataset.motyw = 'mgla';
    root.dataset.mgla = (s.values && s.values.mglaKolory) || 'lawenda';
    root.dataset.accent = (s.values && s.values.accent) || 'violet';
    if (s.values && s.values.wyglad === 'washi' && !s.prywatne) root.dataset.washi = s.washiNoc ? 'noc' : 'dzien'; else delete root.dataset.washi;
    if (s.values && s.values.wyglad === 'engawa' && !s.prywatne) root.dataset.engawa = s.engawaNoc ? 'noc' : 'dzien'; else delete root.dataset.engawa;
    if (s.values && s.values.wyglad === 'satoyama' && !s.prywatne) root.dataset.satoyama = s.satoyamaNoc ? 'noc' : 'dzien'; else delete root.dataset.satoyama;
  } else {
    delete root.dataset.motyw;
    delete root.dataset.mgla;
    delete root.dataset.washi;
    delete root.dataset.engawa;
    delete root.dataset.satoyama;
    root.dataset.accent = 'violet';
  }
  // Okno prywatne: nocna paleta z turkusem jak na innych stronach (pagekit.js).
  if (s.prywatne) { dodajPalettePrywatna(); root.dataset.prywatne = '1'; } else delete root.dataset.prywatne;
}
/* Paleta okna prywatnego - te same barwy co w pages.css pod
   :root[data-motyw="mgla"][data-prywatne="1"], ale textview.html nie laduje
   pages.css. Styl dokladamy raz na koniec <head>: ta sama waga co zestawy
   data-mgla i akcenty z theme.css, wiec wygrywa, bo stoi pozniej. Szklo
   paska i karty z tekstem tez prawie czarne zamiast fioletowego. */
const PALETA_PRYWATNA = `
:root[data-motyw="mgla"][data-prywatne="1"] {
  --bg: #0a0b12;
  --aurora-1: rgba(18, 92, 104, .55);
  --aurora-2: rgba(22, 120, 128, .45);
  --aurora-3: rgba(30, 44, 96, .45);
  --accent: #4fc9c4;
  --accent-strong: #8fe6e1;
  --accent-dim: rgba(79, 201, 196, 0.16);
  --accent-ring: rgba(79, 201, 196, 0.32);
}
:root[data-motyw="mgla"][data-prywatne="1"] body { --text-faint: #a7b6bd; }
:root[data-motyw="mgla"][data-prywatne="1"] #toolbar {
  background: rgba(8, 9, 16, 0.86);
  border-color: rgba(143, 230, 225, 0.14);
}
:root[data-motyw="mgla"][data-prywatne="1"] #code {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.03)), rgba(10, 11, 18, 0.62);
  border-color: rgba(143, 230, 225, 0.12);
}`;
function dodajPalettePrywatna() {
  if (document.getElementById('paletaPrywatna')) return;
  const styl = document.createElement('style');
  styl.id = 'paletaPrywatna';
  styl.textContent = PALETA_PRYWATNA;
  document.head.appendChild(styl);
}
function odswiezWyglad() {
  if (!api || !api.invoke) return;
  api.invoke('settings.get').then(zastosujWyglad).catch(() => {});
}
odswiezWyglad();
if (api && api.on) api.on('settings:changed', odswiezWyglad);

/* Ikona pliku przed nazwa - czysto dekoracyjna, widoczna tylko w mgle. */
const tytulIkona = document.createElement('span');
tytulIkona.className = 'tytul-ikona';
tytulIkona.setAttribute('aria-hidden', 'true');
tytulIkona.innerHTML = iconSvg('file');
el.title.before(tytulIkona);

function nazwaPliku(url) {
  try {
    const u = new URL(url);
    const ostatni = u.pathname.split('/').filter(Boolean).pop();
    return ostatni ? decodeURIComponent(ostatni) : (u.hostname || 'plik.txt');
  } catch (_) { return 'plik.txt'; }
}
const nazwa = nazwaPliku(src);
el.title.textContent = nazwa;
el.title.title = src;
document.title = nazwa;

function escHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* Prosty, sprawdzony sposob na kolorowanie JSON-a bez parsera AST: jedno
   wyrazenie regularne wylapuje po kolei napisy, liczby, true/false/null,
   a to, czy napis jest kluczem czy wartoscia, poznaje po dwukropku zaraz
   za nim. Wystarcza do czytelnego podgladu, nie do edycji. */
function podswietlJSON(jsonText) {
  const wzorzec = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  return escHtml(jsonText).replace(wzorzec, (dopasowanie) => {
    let klasa = 'num';
    if (/^"/.test(dopasowanie)) klasa = /:\s*$/.test(dopasowanie) ? 'key' : 'str';
    else if (/true|false/.test(dopasowanie)) klasa = 'bool';
    else if (/null/.test(dopasowanie)) klasa = 'null';
    return `<span class="${klasa}">${dopasowanie}</span>`;
  });
}

let surowyTekst = '';
let sformatowanyTekst = null; // null, gdy to nie jest poprawny JSON
let pokazSformatowany = true;

function wyswietl() {
  const doPokazania = (pokazSformatowany && sformatowanyTekst != null) ? sformatowanyTekst : surowyTekst;
  const liczbaLinii = doPokazania.split('\n').length;
  el.lines.textContent = Array.from({ length: liczbaLinii }, (_, i) => i + 1).join('\n');
  el.text.innerHTML = sformatowanyTekst != null && pokazSformatowany ? podswietlJSON(doPokazania) : escHtml(doPokazania);
  el.format.classList.toggle('active', pokazSformatowany && sformatowanyTekst != null);
  el.format.querySelector('.lbl').textContent = sformatowanyTekst != null
    ? (pokazSformatowany ? 'Sformatowany' : 'Surowy')
    : 'Zwykły tekst';
  el.format.style.visibility = sformatowanyTekst != null ? 'visible' : 'hidden';
}

el.format.addEventListener('click', () => {
  if (sformatowanyTekst == null) return;
  pokazSformatowany = !pokazSformatowany;
  wyswietl();
});
el.copy.addEventListener('click', () => {
  const doKopii = (pokazSformatowany && sformatowanyTekst != null) ? sformatowanyTekst : surowyTekst;
  api.invoke('app.copy', { text: doKopii });
});
el.download.addEventListener('click', () => { if (src) api.send('viewer.download', { url: src }); });

/* Podglad pobiera plik drugi raz (patrz podmienNaPodglad w session.js), a link
   jednorazowy albo wygasly juz wtedy nie odda tresci. Mowimy wiec, co sie
   stalo, i dajemy zwykle pobranie jako druga szanse. */
function pokazBladPobierania(tekst) {
  el.status.textContent = tekst;
  if (!/^https?:/i.test(src)) return;
  const przycisk = document.createElement('button');
  przycisk.className = 'btn';
  przycisk.textContent = 'Pobierz oryginał';
  przycisk.addEventListener('click', () => api.send('viewer.download', { url: src }));
  el.status.append(document.createElement('br'), przycisk);
}
function opisBledu(resp) {
  if (resp && [401, 403, 404, 410].includes(resp.status)) {
    return `Serwer nie oddał pliku drugi raz (kod ${resp.status}). Link mógł być jednorazowy, wygasnąć albo wymagać zalogowania.`;
  }
  return `Nie udało się otworzyć pliku${resp && resp.error ? ' (' + resp.error + ')' : resp && resp.status ? ' (kod ' + resp.status + ')' : ''}.`;
}

async function start() {
  if (!src) { el.status.textContent = 'Brak adresu pliku do otwarcia.'; return; }
  el.status.textContent = 'Pobieram...';
  let resp;
  try {
    resp = await api.invoke('viewer.fetch', { url: src });
  } catch (err) {
    pokazBladPobierania(`Nie udało się pobrać pliku: ${err.message}`);
    return;
  }
  if (!resp || !resp.ok) {
    pokazBladPobierania(opisBledu(resp));
    return;
  }
  // Pierwsza odpowiedz byla tekstem, a teraz serwer odsyla strone WWW: to
  // zwykle "link wygasl" albo logowanie, a nie tresc pliku.
  if (/text\/html/i.test(String(resp.contentType || ''))) {
    pokazBladPobierania('Serwer zamiast pliku odesłał stronę WWW. Link mógł być jednorazowy, wygasnąć albo wymagać zalogowania.');
    return;
  }
  // Kodowanie z naglowka serwera (np. windows-1250 w starszych polskich
  // plikach) - na sztywno wpisane UTF-8 zamienialo w nich polskie litery w
  // krzaczki. Nieznana nazwa kodowania wraca do UTF-8.
  const m = /charset\s*=\s*"?([\w-]+)/i.exec(String(resp.contentType || ''));
  let dekoder;
  try { dekoder = new TextDecoder(m ? m[1] : 'utf-8'); } catch (_) { dekoder = new TextDecoder('utf-8'); }
  try {
    surowyTekst = dekoder.decode(resp.bytes);
  } catch (_) {
    el.status.textContent = 'Ten plik nie jest tekstem, którego dałoby się tu pokazać.';
    return;
  }
  try {
    const rozebrany = JSON.parse(surowyTekst);
    sformatowanyTekst = JSON.stringify(rozebrany, null, 2);
  } catch (_) {
    sformatowanyTekst = null;
    pokazSformatowany = false;
  }
  el.status.textContent = '';
  wyswietl();
}

start();
