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

  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] nie udało się zapisać', this.file, err.message);
    }
  }
}

module.exports = { Store };
