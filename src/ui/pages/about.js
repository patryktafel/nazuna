const page = document.getElementById('page');

api.invoke('app.info').then((info) => {
  page.innerHTML = `
    <div style="text-align:center;padding:44px 0 30px">
      <img src="nazuna://assets/mark.png" style="width:74px;height:74px" alt="">
      <div style="font-size:27px;font-weight:300;letter-spacing:6px;margin-top:14px">nazuna</div>
      <div style="color:var(--text-faint);margin-top:8px;font-size:12.5px">Przenośna przeglądarka na silniku Chromium. Wersja ${esc(info.version)}</div>
    </div>
    <div class="card">
      <h2>Wersje</h2>
      ${[['Chromium', info.chrome], ['Electron', info.electron], ['Node', info.node], ['V8', info.v8]]
        .map(([k, val]) => `<div class="row"><div class="body"><div class="title">${k}</div></div><div class="ctl"><span class="tag">${esc(val)}</span></div></div>`).join('')}
    </div>
    <div class="card">
      <h2>Ta instalacja</h2>
      <div class="row"><div class="body"><div class="title">Tryb</div><div class="sub">${info.portable ? 'Uruchomiona z pliku przenośnego' : 'Uruchomiona z rozpakowanego folderu'}</div></div></div>
      <div class="row"><div class="body"><div class="title">Folder danych</div><div class="sub">${esc(info.userData)}</div></div>
        <div class="ctl"><button class="btn" id="open">Otwórz</button></div></div>
      <div class="row"><div class="body"><div class="title">Odtwarzanie serwisów z DRM</div>
        <div class="sub">${info.widevine && info.widevine.supported
          ? (info.widevine.ready
              ? 'Moduł Widevine gotowy. Netflix i podobne powinny działać.'
              : (info.widevine.pending
                  ? 'Moduł Widevine pobiera się w tle. Odśwież tę stronę za chwilę.'
                  : `Moduł Widevine niedostępny: ${esc(info.widevine.error || 'nieznany powód')}`))
          : 'Ta wersja nie zawiera modułu Widevine.'}</div></div>
        <div class="ctl"><span class="tag ${info.widevine && info.widevine.ready ? 'ok' : (info.widevine && info.widevine.supported ? 'warn' : 'low')}">${info.widevine && info.widevine.ready ? 'aktywny' : (info.widevine && info.widevine.supported ? 'w toku' : 'brak')}</span></div></div>
      <div class="row"><div class="body"><div class="title">Czas uruchomienia</div>
        <div class="sub">${info.startMs === null || info.startMs === undefined
          ? 'nie zmierzono'
          : `Okno pojawiło się ${esc(String(info.startMs))} ms po starcie programu.` + (info.portable
            ? ' Wersja jednoplikowa rozpakowuje się przed tym pomiarem, więc od kliknięcia ikony mija więcej.'
            : '')}</div></div>
        <div class="ctl"><span class="tag ${(info.startMs || 0) < 1500 ? 'ok' : 'warn'}">${esc(String(info.startMs ?? '?'))} ms</span></div></div>
      <div class="row"><div class="body"><div class="title">Bloker treści</div><div class="sub">${info.adblockReady ? 'Listy filtrów załadowane' : 'Listy filtrów niedostępne'}</div></div>
        <div class="ctl"><span class="tag ${info.adblockReady ? 'ok' : 'low'}">${info.adblockReady ? 'aktywny' : 'nieaktywny'}</span></div></div>
    </div>
    <div class="card">
      <h2>Czego nie potrafi</h2>
      <div class="hint">Serwisy zabezpieczone DRM (Netflix, HBO Max, Disney+, Spotify Web) wymagają modułu Widevine,
        którego ta wersja nie zawiera. YouTube, Gemini, Twitch i zwykle wideo działają normalnie.
        Część rozszerzeń ze sklepu Chrome może działać tylko częściowo.</div>
    </div>`;
  const btn = document.getElementById('open');
  if (btn) btn.addEventListener('click', () => api.send('app.openUserData'));
});
