'use strict';
// Wyciaga z CHANGELOG.txt sekcje dotyczaca biezacej wersji (z package.json)
// i zapisuje ja jako osobny plik (build/release-notes.md), ktory
// electron-builder uzywa jako opis wydania na GitHubie (patrz releaseInfo w
// electron-builder.config.js). Bez tego kazde wydanie miewalo ten sam,
// przypadkowy opis - domyslny electron-builder nic tu sam z siebie madrego
// nie wymysli, trzeba mu dac gotowy tekst.
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const wersja = pkg.version;

const changelogPath = path.join(__dirname, '..', 'CHANGELOG.txt');
const changelog = fs.readFileSync(changelogPath, 'utf8');

const naglowekRe = new RegExp(`^${wersja.replace(/\./g, '\\.')} - .+$`, 'm');
const match = naglowekRe.exec(changelog);

let notatki;
if (!match) {
  // Brak wpisu w CHANGELOG dla tej wersji - nie wywracamy builda, tylko
  // zostawiamy cos neutralnego, zeby publikacja mogla isc dalej.
  notatki = `Wersja ${wersja}.`;
  console.warn(`[release-notes] Uwaga: brak wpisu w CHANGELOG.txt dla wersji ${wersja}, uzywam ogolnikowego opisu.`);
} else {
  const resztaOdNaglowka = changelog.slice(match.index);
  const linie = resztaOdNaglowka.split('\n').slice(2); // omijamy sam naglowek i linie z myslnikami pod nim
  const nastepnyNaglowekIdx = linie.findIndex((linia) => /^\d+\.\d+\.\d+ - /.test(linia));
  const tresc = (nastepnyNaglowekIdx === -1 ? linie : linie.slice(0, nastepnyNaglowekIdx))
    .join('\n')
    .trim();
  notatki = tresc || `Wersja ${wersja}.`;
}

const wyjscie = path.join(__dirname, '..', 'build', 'release-notes.md');
fs.writeFileSync(wyjscie, notatki + '\n', 'utf8');
console.log(`[release-notes] Zapisano notatki wydania dla wersji ${wersja} do ${wyjscie}`);
