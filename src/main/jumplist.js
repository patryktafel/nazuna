'use strict';
const { app } = require('electron');
const data = require('./data');

/* Menu pod prawym przyciskiem na ikonie Nazuny w pasku zadan Windows (Jump
   List), tak jak w Firefoksie: "Czesto odwiedzane" strony i zadania - nowa
   karta, nowe okno, nowe okno prywatne. Kazda pozycja uruchamia Nazune z
   jednym z ponizszych argumentow; gdy Nazuna juz dziala, trafia on do
   dzialajacej kopii (second-instance w index.js).

   Zastepuje tez domyslna liste "Ostatnio uzywane", w ktorej Windows sam
   wypisywal pliki sciagniete przez Nazune - w menu przegladarki nie ma to
   sensu, a potrafilo odslaniac nazwy pobranych plikow. */
const ARG = {
  nowaKarta: '--nazuna-nowa-karta',
  noweOkno: '--nazuna-nowe-okno',
  prywatne: '--nazuna-prywatne'
};

const ILE_CZESTYCH = 6;
const OKRES_MS = 30 * 24 * 60 * 60 * 1000;

/* W wersji z instalatora wystarczy sam argument. Przy uruchamianiu ze zrodel
   (electron.exe) trzeba jeszcze podac folder aplikacji. */
function argumenty(...reszta) {
  const baza = app.isPackaged ? [] : [`"${app.getAppPath()}"`];
  return [...baza, ...reszta].join(' ');
}

function zadanie(tytul, opis, arg) {
  return { type: 'task', title: tytul, description: opis, program: process.execPath, args: argumenty(arg), iconPath: process.execPath, iconIndex: 0 };
}

/* Najczesciej odwiedzane strony z ostatnich 30 dni - po adresie (bez czesci
   po #), z tytulem z ostatniej wizyty. */
function czeste() {
  const teraz = Date.now();
  const licznik = new Map();
  for (const wpis of data.historyStore.data.items) {
    if (!wpis || !wpis.url || teraz - wpis.ts > OKRES_MS) continue;
    if (!/^https?:\/\//i.test(wpis.url)) continue;
    const url = wpis.url.split('#')[0];
    const z = licznik.get(url);
    if (z) z.ile++;
    else licznik.set(url, { url, tytul: wpis.title || url, ile: 1 });
  }
  return [...licznik.values()]
    .sort((a, b) => b.ile - a.ile)
    .slice(0, ILE_CZESTYCH)
    .map((s) => ({
      type: 'task',
      title: String(s.tytul).slice(0, 60),
      description: s.url.slice(0, 250),
      program: process.execPath,
      // Cudzyslow wokol adresu: Windows przekazuje go wtedy jako jeden argument.
      args: argumenty(`"${s.url.replace(/"/g, '%22')}"`),
      iconPath: process.execPath,
      iconIndex: 0
    }));
}

function ustaw() {
  if (process.platform !== 'win32') return;
  try {
    const kategorie = [];
    const strony = czeste();
    if (strony.length) kategorie.push({ type: 'custom', name: 'Często odwiedzane', items: strony });
    kategorie.push({
      type: 'tasks',
      items: [
        zadanie('Nowa karta', 'Otwórz nową kartę', ARG.nowaKarta),
        zadanie('Nowe okno', 'Otwórz nowe okno', ARG.noweOkno),
        zadanie('Nowe okno prywatne', 'Okno, które nie zapisuje historii ani ciasteczek', ARG.prywatne)
      ]
    });
    const wynik = app.setJumpList(kategorie);
    // "customCategoryAccessDeniedError" = w Windows wylaczone pokazywanie
    // ostatnio otwieranych elementow - wtedy zostaja same zadania.
    if (wynik && wynik !== 'ok') app.setJumpList([kategorie[kategorie.length - 1]]);
  } catch (err) {
    console.warn('[jumplist]', err && err.message);
  }
}

let zegar = null;
function start() {
  ustaw();
  if (!zegar) zegar = setInterval(ustaw, 30 * 60 * 1000);
}

/* Ktore z zadan menu przyszlo w argumentach uruchomienia (albo null). */
function zadanieZArgumentow(argv) {
  const a = argv || [];
  if (a.includes(ARG.prywatne)) return 'prywatne';
  if (a.includes(ARG.noweOkno)) return 'noweOkno';
  if (a.includes(ARG.nowaKarta)) return 'nowaKarta';
  return null;
}

module.exports = { start, ustaw, zadanieZArgumentow, ARG };
