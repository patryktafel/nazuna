'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/* Prosty dziennik znacznikow czasu, do diagnozowania wolnego odpalania na
   komputerze, ktorego nie widzimy (np. u znajomego) - patrz aktualizacje.log
   w updater.js, ten dziennik dziala tak samo, tylko dla calego startu
   programu, nie tylko sprawdzania aktualizacji. Zapisuje sie w tym samym
   folderze danych (nazuna://about -> "Ta instalacja" -> "Otworz"), plik
   start.log. t0 lapie sie w momencie, w ktorym silnik JS zaczyna wykonywac
   nasz kod (require('./starttrace') na samej gorze index.js) - to nie caly
   czas od kliknieca ikony (Electron/Windows robi cos wczesniej, zanim to w
   ogole ruszy), ale to najwczesniejszy punkt, jaki widzimy z naszej strony.
   Jesli w kolejnym starcie suma znacznikow ponizej wychodzi na 2-3 sekundy,
   a caly start i tak trwa 30, to brakujace 27 sekund siedzi PRZED tym
   plikiem - najpewniej antywirus albo Windows skanujacy .exe/.asar, zanim
   nasz kod w ogole dostanie szanse sie odpalic. */
const t0 = Date.now();
let logPath = null;

/* Dziennik dopisuje sie przy kazdym starcie i nigdy nie byl przycinany, wiec
   po miesiacach rosl bez konca. Raz na uruchomienie, przy pierwszym
   zapisie, zostawiamy z niego tylko swiezy koniec. Wspolne z updater.js. */
const LIMIT_DZIENNIKA = 512 * 1024;
function przytnij(plik) {
  try {
    const { size } = fs.statSync(plik);
    if (size <= LIMIT_DZIENNIKA) return;
    const fd = fs.openSync(plik, 'r');
    const zostaw = Buffer.alloc(LIMIT_DZIENNIKA / 2);
    fs.readSync(fd, zostaw, 0, zostaw.length, size - zostaw.length);
    fs.closeSync(fd);
    // Od pierwszej pelnej linii, zeby nie zaczynac od polowy wpisu.
    const nl = zostaw.indexOf(10);
    fs.writeFileSync(plik, nl >= 0 ? zostaw.subarray(nl + 1) : zostaw);
  } catch (_) { /* brak pliku albo brak dostepu - nic sie nie stalo */ }
}

function znacznik(etap) {
  try {
    if (!logPath) { logPath = path.join(app.getPath('userData'), 'start.log'); przytnij(logPath); }
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] +${Date.now() - t0}ms ${etap}\n`);
  } catch (_) { /* dziennik nigdy nie moze wywrocic aplikacji */ }
}

module.exports = { znacznik, przytnij };
