/* PDF do podgladu pobierany JEDEN raz (punkt N42 z przegladu, zgloszenie 2026-11-10).

   Wczesniej session.js anulowal otwieranie PDF-a w karcie, a podglad
   (nazuna://pdf) pobieral plik drugi raz (viewer.fetch). Linki jednorazowe
   (faktury, zalaczniki z poczty, linki z tokenem) za drugim razem juz nie
   dzialaly. Teraz ta sama odpowiedz serwera zamienia sie w pobieranie do pliku
   tymczasowego (Content-Disposition: attachment dopisany w onHeadersReceived),
   a podglad czyta ten plik.

   Tylko zwykle (trwale) sesje - okno prywatne niczego nie zapisuje na dysku,
   tam zostaje stary sposob. Pliki leza w %TEMP%\nazuna-pdf i sa sprzatane przy
   starcie oraz po 12 godzinach. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const FOLDER = path.join(os.tmpdir(), 'nazuna-pdf');
const WAZNOSC_MS = 12 * 60 * 60 * 1000;
const oczekujace = new Map();   // adres -> { wcId, ses, czas }
const gotowe = new Map();       // adres -> { sciezka, ses, nazwa, czas }

function sprzataj(wszystko = false) {
  try {
    for (const f of fs.readdirSync(FOLDER)) {
      const p = path.join(FOLDER, f);
      try { if (wszystko || Date.now() - fs.statSync(p).mtimeMs > WAZNOSC_MS) fs.unlinkSync(p); } catch (_) {}
    }
  } catch (_) {}
  for (const [url, w] of gotowe) if (!fs.existsSync(w.sciezka)) gotowe.delete(url);
}

/* session.js: ta odpowiedz (PDF w glownej ramce) ma trafic do podgladu. */
function oznacz(url, wcId, ses) {
  oczekujace.set(url, { wcId, ses, czas: Date.now() });
  setTimeout(() => { const w = oczekujace.get(url); if (w && Date.now() - w.czas >= 30000) oczekujace.delete(url); }, 30500);
}

/* downloads.js (will-download): jesli to nasz PDF - zapis do pliku
   tymczasowego, bez listy pobran, a po zakonczeniu karta otwiera podglad. */
function przejmij(item, wc, ses, otworzPodglad) {
  const url = item.getURL();
  const w = oczekujace.get(url);
  if (!w || w.ses !== ses || !wc || wc.id !== w.wcId) return false;
  oczekujace.delete(url);
  try { fs.mkdirSync(FOLDER, { recursive: true }); } catch (_) {}
  const sciezka = path.join(FOLDER, `${crypto.randomBytes(8).toString('hex')}.pdf`);
  item.setSavePath(sciezka);
  const nazwa = item.getFilename() || 'dokument.pdf';
  item.once('done', (_e, stan) => {
    if (stan === 'completed') gotowe.set(url, { sciezka, ses, nazwa, czas: Date.now() });
    // Gdy sie nie udalo, podglad sprobuje jak dawniej sciagnac plik sam.
    if (!wc.isDestroyed()) otworzPodglad();
  });
  return true;
}

/* ipc.js: plik dla podgladu (tylko z tej samej sesji, ktora go pobrala). */
function plikDla(url, ses) {
  const w = gotowe.get(url);
  if (!w || w.ses !== ses) return null;
  if (!fs.existsSync(w.sciezka)) { gotowe.delete(url); return null; }
  return w;
}

sprzataj(true);
setInterval(() => sprzataj(false), 60 * 60 * 1000).unref();

module.exports = { oznacz, przejmij, plikDla };
