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
