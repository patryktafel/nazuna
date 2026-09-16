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

function znacznik(etap) {
  try {
    if (!logPath) logPath = path.join(app.getPath('userData'), 'start.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] +${Date.now() - t0}ms ${etap}\n`);
  } catch (_) { /* dziennik nigdy nie moze wywrocic aplikacji */ }
}

module.exports = { znacznik };
