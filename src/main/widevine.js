'use strict';
const { components } = require('electron');

/* Odtwarzanie serwisów z DRM (Netflix, HBO, Disney+, Spotify Web).
   Moduł deszyfrujący nie jest wbudowany w plik programu, tylko dociąga się
   z serwerów Google przy pierwszym uruchomieniu. Dostępny wyłącznie
   w buildach castLabs; na zwykłym Electronie components w ogóle nie istnieje. */

const state = {
  supported: !!components,
  ready: false,
  pending: false,
  error: components ? null : 'ta wersja nie zawiera modułu DRM',
  status: null
};

function start() {
  if (!components || state.pending || state.ready) return;
  state.pending = true;
  components.whenReady()
    .then(() => {
      state.ready = true;
      state.pending = false;
      state.error = null;
      try { state.status = components.status(); } catch (_) {}
      console.log('[widevine] moduł gotowy');
    })
    .catch((err) => {
      state.pending = false;
      state.error = err && err.message ? err.message : String(err);
      console.warn('[widevine] niedostępny:', state.error);
    });
}

function info() {
  return { supported: state.supported, ready: state.ready, pending: state.pending, error: state.error };
}

module.exports = { start, info, state };
