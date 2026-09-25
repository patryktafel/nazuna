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
  download: document.getElementById('download')
};

el.prev.innerHTML = iconSvg('chevronUp');
el.next.innerHTML = iconSvg('chevronDown');
el.zoomIn.innerHTML = iconSvg('zoomIn');
el.zoomOut.innerHTML = iconSvg('zoomOut');
el.download.innerHTML = iconSvg('download');

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

function ustawZoomLabel() { el.zoomLabel.textContent = `${Math.round(scale * 100)}%`; }

function ustawRozmiarKontenera(entry) {
  const viewport = entry.page.getViewport({ scale });
  entry.container.style.width = `${Math.ceil(viewport.width)}px`;
  entry.container.style.height = `${Math.ceil(viewport.height)}px`;
}

async function renderPage(entry) {
  if (entry.rendered || entry.rendering) return;
  entry.rendering = true;
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
    entry.rendered = true;
  } catch (err) {
    if (!err || err.name !== 'RenderingCancelledException') console.warn('[pdf] strona', entry.pageNum, err && err.message);
  } finally {
    entry.rendering = false;
    entry.renderTask = null;
  }
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

async function start() {
  if (!src) { el.status.textContent = 'Brak adresu pliku do otwarcia.'; el.toolbar.style.visibility = 'hidden'; return; }
  el.status.textContent = 'Pobieram plik...';
  let resp;
  try {
    resp = await api.invoke('viewer.fetch', { url: src });
  } catch (err) {
    el.status.textContent = `Nie udało się pobrać pliku: ${err.message}`;
    return;
  }
  if (!resp || !resp.ok) {
    el.status.textContent = `Nie udało się otworzyć pliku${resp && resp.error ? ' (' + resp.error + ')' : resp && resp.status ? ' (kod ' + resp.status + ')' : ''}.`;
    return;
  }
  el.status.textContent = 'Wczytuję dokument...';
  try {
    pdfDoc = await pdfjsLib.getDocument({
      data: resp.bytes,
      cMapUrl: 'nazuna://ui/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'nazuna://ui/vendor/pdfjs/standard_fonts/',
      isEvalSupported: false
    }).promise;
  } catch (err) {
    el.status.textContent = `To nie jest poprawny plik PDF (${err.message}).`;
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
}

start();
