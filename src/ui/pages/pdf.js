import * as pdfjsLib from 'nazuna://ui/vendor/pdfjs/pdf.min.mjs';

const api = window.nazuna;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'nazuna://ui/vendor/pdfjs/pdf.worker.min.mjs';

const params = new URLSearchParams(location.search);
const src = params.get('src') || '';

const el = {
  toolbar: document.getElementById('toolbar'),
  title: document.getElementById('title'),
  status: document.getElementById('status'),
  scroll: document.getElementById('scroll'),
  pages: document.getElementById('pages'),
  pageInfo: document.getElementById('pageInfo'),
  zoomLabel: document.getElementById('zoomLabel'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  zoomIn: document.getElementById('zoomIn'),
  zoomOut: document.getElementById('zoomOut'),
  download: document.getElementById('download'),
  haslo: document.getElementById('haslo'),
  hasloBlad: document.getElementById('hasloBlad'),
  hasloPole: document.getElementById('hasloPole')
};

el.prev.innerHTML = iconSvg('chevronUp');
el.next.innerHTML = iconSvg('chevronDown');
el.zoomIn.innerHTML = iconSvg('zoomIn');
el.zoomOut.innerHTML = iconSvg('zoomOut');
el.download.innerHTML = iconSvg('download');

/* Wyglad: ta strona nie laduje pagekit.js, wiec motyw ustawiamy sami. Atrybuty
   z ustawien dostaje tylko Lawendowa mgla (style pod :root[data-motyw="mgla"]
   w pdf.html). Klasyczny zostaje dokladnie taki jak byl: bez data-motyw i ze stalym
   data-accent="violet" z pliku html. Odswiezamy po zmianie ustawien, zeby
   przelaczenie wygladu bylo widac od razu. */
function zastosujWyglad(s) {
  if (!s) return;
  const root = document.documentElement;
  if (s.motyw === 'mgla') {
    root.dataset.motyw = 'mgla';
    root.dataset.mgla = (s.values && s.values.mglaKolory) || 'lawenda';
    root.dataset.accent = (s.values && s.values.accent) || 'violet';
    if (s.values && s.values.wyglad === 'washi' && !s.prywatne) root.dataset.washi = '1'; else delete root.dataset.washi;
  } else {
    delete root.dataset.motyw;
    delete root.dataset.mgla;
    delete root.dataset.washi;
    root.dataset.accent = 'violet';
  }
  // Okno prywatne: nocna paleta z turkusem jak na innych stronach (pagekit.js).
  if (s.prywatne) { dodajPalettePrywatna(); root.dataset.prywatne = '1'; } else delete root.dataset.prywatne;
}
/* Paleta okna prywatnego - te same barwy co w pages.css pod
   :root[data-motyw="mgla"][data-prywatne="1"], ale pdf.html nie laduje
   pages.css. Styl dokladamy raz na koniec <head>: ta sama waga co zestawy
   data-mgla i akcenty z theme.css, wiec wygrywa, bo stoi pozniej. Szklo
   paska i okienka hasla tez prawie czarne zamiast fioletowego. */
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
:root[data-motyw="mgla"][data-prywatne="1"] #haslo {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.035)), rgba(10, 11, 18, 0.78);
  border-color: rgba(143, 230, 225, 0.14);
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

/* Nazwa pliku do tytulu karty i zakladki - z ostatniego czlonu adresu, a nie
   z samego adresu, zeby na pasku kart bylo "raport.pdf", nie caly url. Dla
   lokalnych plikow (src="nazuna-local:<token>", patrz index.js/ipc.js) sam
   adres nic nie mowi, wiec main process dokleja gotowa nazwe w "name". */
function nazwaPliku(url) {
  try {
    const u = new URL(url);
    const ostatni = u.pathname.split('/').filter(Boolean).pop();
    return ostatni ? decodeURIComponent(ostatni) : (u.hostname || 'dokument.pdf');
  } catch (_) { return 'dokument.pdf'; }
}
const nazwa = params.get('name') || nazwaPliku(src);
el.title.textContent = nazwa;
el.title.title = nazwa;
document.title = nazwa;

let scale = 1;
const MIN_SCALE = 0.4, MAX_SCALE = 3.5, KROK = 0.15;
let pdfDoc = null;
const pageEntries = [];
/* Warstwa tekstu powstaje w tle dla calego dokumentu, bo Ctrl+F widzi tylko to,
   co jest w DOM. Przy bardzo dlugich plikach dalsze strony dostaja ja dopiero
   przy przewinieciu, zeby karta nie puchla. */
const MAX_STRON_TEKSTU_W_TLE = 500;

function ustawZoomLabel() { el.zoomLabel.textContent = `${Math.round(scale * 100)}%`; }

function ustawRozmiarKontenera(entry) {
  const viewport = entry.page.getViewport({ scale });
  entry.container.style.width = `${Math.ceil(viewport.width)}px`;
  entry.container.style.height = `${Math.ceil(viewport.height)}px`;
  // Warstwa tekstu sama skaluje sie z tej zmiennej, wiec zoom nie musi jej budowac od nowa.
  // userUnit: viewport.scale go nie zawiera, a rozmiar strony tak (duze formaty, np. rysunki).
  entry.container.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
}

/* Skok do miejsca w tym samym dokumencie (spis tresci, przypisy). */
async function idzDoCelu(cel) {
  try {
    const d = typeof cel === 'string' ? await pdfDoc.getDestination(cel) : cel;
    if (!Array.isArray(d)) return;
    const indeks = d[0] && typeof d[0] === 'object' ? await pdfDoc.getPageIndex(d[0]) : d[0];
    const entry = pageEntries[indeks];
    if (!entry) return;
    const tryb = d[1] && d[1].name;
    const gora = tryb === 'XYZ' ? d[3] : (tryb === 'FitH' || tryb === 'FitBH') ? d[2] : null;
    const odGoryStrony = typeof gora === 'number'
      ? Math.max(0, entry.page.getViewport({ scale }).convertToViewportPoint(0, gora)[1])
      : 0;
    const roznica = entry.container.getBoundingClientRect().top - el.scroll.getBoundingClientRect().top;
    // W mgle pasek unosi sie nad dokumentem: zatrzymaj cel pod nim (scroll-padding-top
    // z pdf.html). W Klasycznym to 'auto', czyli 0 - zachowanie bez zmian.
    const podPaskiem = parseFloat(getComputedStyle(el.scroll).scrollPaddingTop) || 0;
    el.scroll.scrollBy({ top: roznica + odGoryStrony - podPaskiem });
  } catch (err) {
    console.warn('[pdf] link wewnetrzny', err && err.message);
  }
}

/* Same linki zamiast calego AnnotationLayer z pdf.js: tamten wnosi formularze,
   skrypty i zalaczniki, ktorych podglad nie potrzebuje. Plik PDF jest obcy, a ta
   strona ma most do przegladarki, wiec przepuszczamy tylko http(s) i mailto. */
async function dodajLinki(entry) {
  const adnotacje = await entry.page.getAnnotations({ intent: 'display' });
  const linki = adnotacje.filter((a) => a.subtype === 'Link');
  if (!linki.length) return;
  const v = entry.page.getViewport({ scale: 1 });
  const warstwa = document.createElement('div');
  warstwa.className = 'warstwaLinkow';
  for (const a of linki) {
    const link = document.createElement('a');
    if (a.url && /^(https?:|mailto:)/i.test(a.url)) {
      link.href = a.url;
      link.title = a.url;   // cel widoczny przed kliknieciem: tekst linku w PDF moze klamac
      link.rel = 'noopener noreferrer';
      if (/^http/i.test(a.url)) link.target = '_blank';   // PDF zostaje otwarty w tej karcie
    } else if (a.dest) {
      link.href = '#';
      link.addEventListener('click', (e) => { e.preventDefault(); idzDoCelu(a.dest); });
    } else {
      continue;
    }
    const [x1, y1] = v.convertToViewportPoint(a.rect[0], a.rect[1]);
    const [x2, y2] = v.convertToViewportPoint(a.rect[2], a.rect[3]);
    link.style.left = `${(100 * Math.min(x1, x2) / v.width).toFixed(3)}%`;
    link.style.top = `${(100 * Math.min(y1, y2) / v.height).toFixed(3)}%`;
    link.style.width = `${(100 * Math.abs(x2 - x1) / v.width).toFixed(3)}%`;
    link.style.height = `${(100 * Math.abs(y2 - y1) / v.height).toFixed(3)}%`;
    warstwa.appendChild(link);
  }
  if (warstwa.childElementCount) entry.container.appendChild(warstwa);
}

async function dodajTekst(entry) {
  const warstwa = document.createElement('div');
  warstwa.className = 'textLayer';
  entry.container.appendChild(warstwa);
  const tekst = new pdfjsLib.TextLayer({
    textContentSource: entry.page.streamTextContent(),
    container: warstwa,
    viewport: entry.page.getViewport({ scale })
  });
  await tekst.render();
  // Bez tego elementu ciagniecie zaznaczenia przez pusty obszar strony skacze
  // na koniec dokumentu (rozwiazanie z przegladarki pdf.js).
  const koniec = document.createElement('div');
  koniec.className = 'endOfContent';
  warstwa.appendChild(koniec);
  warstwa.addEventListener('pointerdown', () => warstwa.classList.add('selecting'));
}
document.addEventListener('pointerup', () => {
  for (const w of document.querySelectorAll('.textLayer.selecting')) w.classList.remove('selecting');
});

/* Raz na strone: blad w tekscie czy linkach nie moze zepsuc samego obrazu strony. */
function zbudujWarstwy(entry) {
  if (!entry.warstwy) {
    entry.warstwy = (async () => {
      try { await dodajTekst(entry); } catch (err) { console.warn('[pdf] tekst strony', entry.pageNum, err && err.message); }
      // Linki po tekscie, zeby lezaly nad nim i dalo sie w nie kliknac.
      try { await dodajLinki(entry); } catch (err) { console.warn('[pdf] linki strony', entry.pageNum, err && err.message); }
    })();
  }
  return entry.warstwy;
}

async function warstwyWTle() {
  const ile = Math.min(pageEntries.length, MAX_STRON_TEKSTU_W_TLE);
  for (let i = 0; i < ile; i++) {
    await zbudujWarstwy(pageEntries[i]);
    await new Promise((r) => requestIdleCallback(r, { timeout: 300 }));
  }
}

async function renderPage(entry) {
  zbudujWarstwy(entry);
  if (entry.rendered || entry.rendering) return;
  entry.rendering = true;
  /* Zoom w trakcie rysowania: renderPage z ustawZoom widzi jeszcze "rendering"
     i wychodzi, wiec po przerwaniu trzeba narysowac strone od nowa. Inaczej
     zostawala biala kartka w starym rozmiarze pod warstwa tekstu w nowym. */
  const skalaRysowania = scale;
  let ponow = false;
  try {
    const dpr = window.devicePixelRatio || 1;
    const viewport = entry.page.getViewport({ scale: scale * dpr });
    entry.canvas.width = Math.ceil(viewport.width);
    entry.canvas.height = Math.ceil(viewport.height);
    entry.canvas.style.width = `${Math.ceil(viewport.width / dpr)}px`;
    entry.canvas.style.height = `${Math.ceil(viewport.height / dpr)}px`;
    const ctx = entry.canvas.getContext('2d');
    entry.renderTask = entry.page.render({ canvasContext: ctx, viewport });
    await entry.renderTask.promise;
    if (skalaRysowania === scale) entry.rendered = true; else ponow = true;
  } catch (err) {
    if (err && err.name === 'RenderingCancelledException') ponow = true;
    else console.warn('[pdf] strona', entry.pageNum, err && err.message);
  } finally {
    entry.rendering = false;
    entry.renderTask = null;
  }
  if (ponow) przerenderujWidoczne();
}

function przerenderujWidoczne() {
  const gorna = -800, dolna = window.innerHeight + 800;
  for (const entry of pageEntries) {
    const r = entry.container.getBoundingClientRect();
    if (r.bottom > gorna && r.top < dolna) renderPage(entry);
  }
}

const observer = new IntersectionObserver((wpisy) => {
  for (const w of wpisy) {
    if (!w.isIntersecting) continue;
    const entry = pageEntries.find((p) => p.container === w.target);
    if (entry) renderPage(entry);
  }
}, { root: el.scroll, rootMargin: '800px 0px' });

function aktualnaStrona() {
  let najlepsza = 1, najlepszaOdl = Infinity;
  for (const entry of pageEntries) {
    const odl = Math.abs(entry.container.getBoundingClientRect().top);
    if (odl < najlepszaOdl) { najlepszaOdl = odl; najlepsza = entry.pageNum; }
  }
  return najlepsza;
}

el.scroll.addEventListener('scroll', () => {
  if (pdfDoc) el.pageInfo.textContent = `${aktualnaStrona()} / ${pdfDoc.numPages}`;
}, { passive: true });

function idzDoStrony(n) {
  const entry = pageEntries[n - 1];
  if (entry) entry.container.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
el.prev.addEventListener('click', () => idzDoStrony(Math.max(1, aktualnaStrona() - 1)));
el.next.addEventListener('click', () => idzDoStrony(Math.min(pageEntries.length, aktualnaStrona() + 1)));

function ustawZoom(nowaSkala) {
  const zaokraglona = Math.round(nowaSkala * 100) / 100;
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, zaokraglona));
  ustawZoomLabel();
  for (const entry of pageEntries) {
    if (entry.renderTask) { try { entry.renderTask.cancel(); } catch (_) {} }
    entry.rendered = false;
    ustawRozmiarKontenera(entry);
  }
  przerenderujWidoczne();
}
el.zoomIn.addEventListener('click', () => ustawZoom(scale + KROK));
el.zoomOut.addEventListener('click', () => ustawZoom(scale - KROK));

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

/* pdf.js sam wola te funkcje, gdy plik wymaga hasla, i po kazdym blednym hasle.
   Hasla nigdzie nie zapisujemy: idzie tylko do watku pdf.js. */
function poprosOHaslo(podajHaslo, powod) {
  el.status.textContent = '';
  el.hasloBlad.textContent = powod === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD ? 'Błędne hasło. Spróbuj jeszcze raz.' : '';
  el.haslo.hidden = false;
  el.hasloPole.value = '';
  el.hasloPole.focus();
  el.haslo.onsubmit = (e) => {
    e.preventDefault();
    const haslo = el.hasloPole.value;
    if (!haslo) return;
    el.hasloPole.value = '';
    el.haslo.hidden = true;
    el.status.textContent = 'Wczytuję dokument...';
    podajHaslo(haslo);
  };
}

async function start() {
  if (!src) { el.status.textContent = 'Brak adresu pliku do otwarcia.'; el.toolbar.style.visibility = 'hidden'; return; }
  el.status.textContent = 'Pobieram plik...';
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
  el.status.textContent = 'Wczytuję dokument...';
  try {
    const zadanie = pdfjsLib.getDocument({
      data: resp.bytes,
      cMapUrl: 'nazuna://ui/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'nazuna://ui/vendor/pdfjs/standard_fonts/',
      isEvalSupported: false
    });
    zadanie.onPassword = poprosOHaslo;
    pdfDoc = await zadanie.promise;
  } catch (err) {
    // Pierwsza odpowiedz byla PDF-em, a teraz serwer odsyla strone WWW: to
    // zwykle "link wygasl" albo logowanie, a nie uszkodzony plik.
    if (/text\/html/i.test(String(resp.contentType || ''))) {
      pokazBladPobierania('Serwer zamiast pliku PDF odesłał stronę WWW. Link mógł być jednorazowy, wygasnąć albo wymagać zalogowania.');
    } else {
      el.status.textContent = `To nie jest poprawny plik PDF (${err.message}).`;
    }
    return;
  }
  el.status.textContent = '';
  const strony = await Promise.all(Array.from({ length: pdfDoc.numPages }, (_, i) => pdfDoc.getPage(i + 1)));
  strony.forEach((page, i) => {
    const container = document.createElement('div');
    container.className = 'pdf-page';
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    el.pages.appendChild(container);
    const entry = { container, canvas, page, pageNum: i + 1, rendered: false, rendering: false, renderTask: null };
    ustawRozmiarKontenera(entry);
    pageEntries.push(entry);
    observer.observe(container);
  });
  ustawZoomLabel();
  el.pageInfo.textContent = `1 / ${pdfDoc.numPages}`;
  przerenderujWidoczne();
  warstwyWTle();
}

start();
