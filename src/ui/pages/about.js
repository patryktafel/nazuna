const page = document.getElementById('page');

function opisAktualizacji(stan) {
  switch ((stan || {}).status) {
    case 'niedostepna':
      return { tekst: 'Automatyczne aktualizacje działają tylko w zainstalowanej wersji dla Windows (nie w wersji przenośnej ani w tej kopii).', tag: ['brak', 'low'], przycisk: null };
    case 'sprawdzanie':
      return { tekst: 'Sprawdzanie dostępności nowej wersji...', tag: ['sprawdzanie', 'warn'], przycisk: null };
    case 'aktualna':
      return { tekst: 'Masz najnowszą wersję Nazuny.', tag: ['aktualna', 'ok'], przycisk: { id: 'updCheck', label: 'Sprawdź ponownie' } };
    case 'dostepna':
      return { tekst: `Dostępna nowa wersja ${esc(stan.wersja || '')} - Nazuna pobiera ją teraz sama, w tle.`, tag: ['dostępna', 'warn'], przycisk: null };
    case 'pobieranie':
      return { tekst: `Pobieranie aktualizacji... ${stan.procent ?? 0}%`, tag: ['pobieranie', 'warn'], przycisk: null };
    case 'pobrana':
      return { tekst: `Aktualizacja ${esc(stan.wersja || '')} pobrana. Zainstaluje się sama przy najbliższym zamknięciu Nazuny, albo od razu, jeśli klikniesz niżej.`, tag: ['pobrana', 'ok'], przycisk: { id: 'updInstall', label: 'Zainstaluj i uruchom ponownie' } };
    case 'blad':
      return { tekst: `Nie udało się sprawdzić aktualizacji${stan.komunikat ? `: ${esc(stan.komunikat)}` : '.'}`, tag: ['błąd', 'low'], przycisk: { id: 'updCheck', label: 'Spróbuj ponownie' } };
    default:
      return { tekst: 'Sprawdź, czy dostępna jest nowsza wersja Nazuny.', tag: ['nieznana', 'low'], przycisk: { id: 'updCheck', label: 'Sprawdź aktualizacje' } };
  }
}

function rysujAktualizacje(stan) {
  const el = document.getElementById('updateCard');
  if (!el) return;
  const o = opisAktualizacji(stan);
  el.innerHTML = `
    <div class="row"><div class="body"><div class="title">Stan</div><div class="sub">${o.tekst}</div></div>
      <div class="ctl">
        <span class="tag ${o.tag[1]}">${o.tag[0]}</span>
        ${o.przycisk ? `<button class="btn" id="${o.przycisk.id}">${o.przycisk.label}</button>` : ''}
      </div></div>`;
  if (o.przycisk) {
    document.getElementById(o.przycisk.id).addEventListener('click', () => {
      if (o.przycisk.id === 'updCheck') api.invoke('app.updateCheck');
      else if (o.przycisk.id === 'updDownload') api.send('app.updateDownload');
      else if (o.przycisk.id === 'updInstall') api.send('app.updateInstall');
    });
  }
}

api.on('update:status', rysujAktualizacje);

api.invoke('app.info').then((info) => {
  page.innerHTML = `
    <div class="ab-glowa">
      <img class="ab-znak" src="nazuna://assets/mark.png" alt=""><svg class="ab-kwiat" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="ab-poswiata" cx="50" cy="50" r="46"></circle>
        <ellipse class="ab-platek p1" cx="50" cy="27" rx="14" ry="21"></ellipse>
        <ellipse class="ab-platek p2" cx="73" cy="50" rx="21" ry="14"></ellipse>
        <ellipse class="ab-platek p3" cx="50" cy="73" rx="14" ry="21"></ellipse>
        <ellipse class="ab-platek p4" cx="27" cy="50" rx="21" ry="14"></ellipse>
        <circle class="ab-srodek" cx="50" cy="50" r="9"></circle>
      </svg>
      <div class="ab-nazwa">nazuna</div>
      <div class="ab-opis">Przeglądarka na silniku Chromium, stawiająca na prywatność i szybkość. Wersja <span class="ab-wersja">${esc(info.version)}</span></div>
      <div class="ab-autor">Stworzona przez Tafel &middot; <a href="https://github.com/patryktafel/nazuna-updates" id="linkRepo">repozytorium wydań na GitHubie</a></div>
    </div>
    <div class="card">
      <h2>Wersje</h2>
      ${[['Chromium', info.chrome], ['Electron', info.electron], ['Node', info.node], ['V8', info.v8]]
        .map(([k, val]) => `<div class="row"><div class="body"><div class="title">${k}</div></div><div class="ctl"><span class="tag">${esc(val)}</span></div></div>`).join('')}
    </div>
    <div class="card">
      <h2>Ta instalacja</h2>
      <div class="row"><div class="body"><div class="title">Folder danych</div><div class="sub">${esc(info.userData)}</div></div>
        <div class="ctl"><button class="btn" id="open">Otwórz</button></div></div>
      <div class="row"><div class="body"><div class="title">Czas uruchomienia</div>
        <div class="sub">${info.startMs === null || info.startMs === undefined
          ? 'nie zmierzono'
          : `Okno pojawiło się ${esc(String(info.startMs))} ms po starcie programu.`}</div></div>
        <div class="ctl"><span class="tag ${(info.startMs || 0) < 1500 ? 'ok' : 'warn'}">${esc(String(info.startMs ?? '?'))} ms</span></div></div>
      <div class="row"><div class="body"><div class="title">Bloker treści</div><div class="sub">${info.adblockReady ? 'Listy filtrów załadowane' : 'Listy filtrów niedostępne'}</div></div>
        <div class="ctl"><span class="tag ${info.adblockReady ? 'ok' : 'low'}">${info.adblockReady ? 'aktywny' : 'nieaktywny'}</span></div></div>
    </div>
    <div class="card">
      <h2>Aktualizacje</h2>
      <div id="updateCard"></div>
    </div>`;
  const btn = document.getElementById('open');
  if (btn) btn.addEventListener('click', () => api.send('app.openUserData'));
  const repo = document.getElementById('linkRepo');
  if (repo) repo.addEventListener('click', (e) => { e.preventDefault(); api.send('app.openExternal', { url: repo.href }); });

  api.invoke('app.updateStatus').then(rysujAktualizacje);
});
