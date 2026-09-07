'use strict';
const fs = require('fs');
const path = require('path');

/** Tiny debounced JSON store. Atomic writes, survives a crash mid-save. */
class Store {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = JSON.parse(JSON.stringify(defaults));
    this._timer = null;
    this._chain = Promise.resolve();
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') this.data = Object.assign(this.data, parsed);
    } catch (_) { /* first run, or the file went bad; defaults stay */ }
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
        await fs.promises.writeFile(tmp, snapshot);
        await fs.promises.rename(tmp, this.file);
      } catch (err) {
        console.error('[store] nie udało się zapisać', this.file, err.message);
      }
    });
    return this._chain;
  }
}

module.exports = { Store };
