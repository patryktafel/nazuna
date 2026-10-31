'use strict';
const fs = require('fs');
const path = require('path');

/** Tiny debounced JSON store. Atomic writes, survives a crash mid-save. */
class Store {
  /* opcje.kopia: trzymaj obok plik .bak z ostatnia dobra wersja (zakladki,
     ustawienia). Nie dla historii i pobran - po "Wyczysc historie" stara
     kopia lezalaby dalej na dysku. */
  constructor(file, defaults = {}, opcje = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = JSON.parse(JSON.stringify(defaults));
    this._timer = null;
    this._chain = Promise.resolve();
    this._kopia = !!opcje.kopia;
    /* Brak pliku (pierwsze uruchomienie) to co innego niz zepsuty plik. Kiedys
       oba przypadki po cichu dawaly wartosci domyslne, a pierwszy zapis
       nadpisywal zepsuty plik pustym stanem - np. po zaniku pradu wszystkie
       zakladki znikaly na zawsze. Teraz zepsuty plik odkladamy na bok
       (.corrupt-<czas>) i probujemy wczytac kopie .bak. */
    const wczytany = this._wczytaj(file);
    if (wczytany.ok) {
      Object.assign(this.data, wczytany.dane);
    } else if (wczytany.zepsuty) {
      const bok = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try { fs.renameSync(file, bok); } catch (_) {
        // Nie da sie odlozyc - nie nadpisuj w tej sesji kopii .bak zlym plikiem.
        this._kopia = false;
      }
      console.error('[store] zepsuty plik, odlozony jako', bok);
      const zKopii = this._wczytaj(`${file}.bak`);
      if (zKopii.ok) {
        Object.assign(this.data, zKopii.dane);
        console.error('[store] wczytano kopie', `${file}.bak`);
      }
    }
  }

  /* { ok, dane } albo { ok: false, zepsuty } - zepsuty=false gdy pliku po
     prostu nie ma. */
  _wczytaj(file) {
    let tekst;
    try { tekst = fs.readFileSync(file, 'utf8'); } catch (err) {
      return { ok: false, zepsuty: err.code !== 'ENOENT' };
    }
    try {
      // BOM po recznej edycji w Notatniku to nie zepsuty plik.
      const parsed = JSON.parse(tekst.replace(/^﻿/, ''));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ok: true, dane: parsed };
    } catch (_) { /* nizej */ }
    return { ok: false, zepsuty: true };
  }

  get(key, fallback) {
    const v = this.data[key];
    return v === undefined ? fallback : v;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
    return value;
  }

  assign(patch) {
    Object.assign(this.data, patch);
    this.save();
  }

  save() {
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush(), 300);
  }

  /* Asynchroniczny zapis, zeby duzy plik (np. 30 tysiecy wpisow historii) nie
     zamrazal na chwile calego okna, gdy trafi na wolny dysk. Wywolania
     szeregujemy przez _chain - dwa zapisy z rzedu nie nadepna sobie wtedy na
     ten sam plik .tmp. JSON.stringify robimy od razu, zanim cokolwiek czeka
     na dysk, wiec zapisujemy dokladnie ten stan danych sprzed wywolania, nie
     jakis pozniejszy. Zwraca Promise - wiekszosc wywolan go ignoruje (i tak
     jest debounce), ale np. zamykanie programu na niego czeka. */
  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const snapshot = JSON.stringify(this.data);
    this._chain = this._chain.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        /* fsync przed rename: bez niego po naglym zaniku pradu NTFS potrafi
           zostawic plik po rename pusty albo z zerami. */
        const uchwyt = await fs.promises.open(tmp, 'w');
        try {
          await uchwyt.writeFile(snapshot);
          await uchwyt.sync();
        } finally {
          await uchwyt.close();
        }
        if (this._kopia) {
          // Obecny plik to poprzedni udany zapis - zostaje jako .bak.
          await fs.promises.copyFile(this.file, `${this.file}.bak`).catch(() => {});
        }
        await fs.promises.rename(tmp, this.file);
      } catch (err) {
        console.error('[store] nie udało się zapisać', this.file, err.message);
      }
    });
    return this._chain;
  }
}

module.exports = { Store };
