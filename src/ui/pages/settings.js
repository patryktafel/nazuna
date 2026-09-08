const page = document.getElementById('page');
let cfg = null;

/* Kropki wyboru koloru maja pokazywac to, co uzytkownik naprawde dostanie.
   W jasnym motywie akcenty sa ciemniejsze, zeby byly czytelne na bieli, wiec
   probki tez musza byc ciemniejsze. Inaczej klikasz pastel, a wychodzi cos
   innego. */
const ACCENTY = {
  ciemny: { violet: '#8b7cff', mint: '#4fd8ac', sky: '#5aa7ff', rose: '#ff7aa2', amber: '#ffb257' },
  jasny:  { violet: '#6a5aef', mint: '#12a077', sky: '#1a7fe0', rose: '#de3f77', amber: '#b3720a' }
};
const NAZWY_AKCENTOW = ['violet', 'mint', 'sky', 'rose', 'amber'];

function probkiAkcentow() {
  const motyw = document.documentElement.dataset.motyw === 'jasny' ? 'jasny' : 'ciemny';
  return NAZWY_AKCENTOW.map((name) => [name, ACCENTY[motyw][name]]);
}

function toggleRow(key, title, sub) {
  return `<div class="row">
    <div class="body"><div class="title">${esc(title)}</div><div class="sub">${esc(sub)}</div></div>
    <div class="ctl"><label class="switch">
      <input type="checkbox" data-key="${key}" ${cfg.values[key] ? 'checked' : ''}>
      <span class="track"></span><span class="thumb"></span></label></div>
  </div>`;
}

function render() {
  const v = cfg.values;
  page.innerHTML = head('Ustawienia', 'settings') + `
    <div class="card">
      <h2>Wyszukiwanie i start</h2>
      <div class="row">
        <div class="body"><div class="title">Wyszukiwarka</div><div class="sub">Używana w pasku adresu i na nowej karcie</div></div>
        <div class="ctl"><select class="field" data-key="searchEngine" style="width:180px">
          ${Object.entries(cfg.engines).map(([k, e]) => `<option value="${k}" ${v.searchEngine === k ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
        </select></div>
      </div>
      <div class="row">
        <div class="body"><div class="title">Po uruchomieniu</div><div class="sub">Co ma się otworzyć przy starcie przeglądarki</div></div>
        <div class="ctl"><select class="field" data-key="startup" style="width:200px">
          <option value="newtab" ${v.startup === 'newtab' ? 'selected' : ''}>Nowa karta</option>
          <option value="homepage" ${v.startup === 'homepage' ? 'selected' : ''}>Strona startowa</option>
          <option value="restore" ${v.startup === 'restore' ? 'selected' : ''}>Karty z poprzedniej sesji</option>
        </select></div>
      </div>
      <div class="row">
        <div class="body"><div class="title">Strona startowa</div><div class="sub">Otwierana przyciskiem domku</div></div>
        <div class="ctl"><input class="field" data-key="homepage" value="${esc(v.homepage)}" style="width:280px" spellcheck="false"></div>
      </div>
      ${toggleRow('showSuggestions', 'Podpowiedzi wyszukiwania', 'Pobiera propozycje z wyszukiwarki podczas pisania w pasku adresu')}
    </div>

    <div class="card">
      <h2>Wygląd</h2>
      <div class="row">
        <div class="body"><div class="title">Motyw</div>
          <div class="sub">Jasny ma osobno dobrane kolory, nie jest odwróconym ciemnym</div></div>
        <div class="ctl"><select class="field" data-key="theme" style="width:170px">
          <option value="dark" ${v.theme !== 'light' && v.theme !== 'system' ? 'selected' : ''}>Ciemny</option>
          <option value="light" ${v.theme === 'light' ? 'selected' : ''}>Jasny</option>
          <option value="system" ${v.theme === 'system' ? 'selected' : ''}>Jak w systemie</option>
        </select></div>
      </div>
      <div class="row">
        <div class="body"><div class="title">Kolor akcentu</div><div class="sub">Wpływa na podświetlenia i aktywne elementy</div></div>
        <div class="ctl">${probkiAkcentow().map(([name, color]) => `
          <button class="accent-dot" data-accent="${name}" title="${name}" style="width:24px;height:24px;border-radius:50%;background:${color};border:2px solid ${v.accent === name ? 'var(--text)' : 'transparent'};cursor:pointer"></button>`).join('')}
        </div>
      </div>
      ${toggleRow('showBookmarksBar', 'Pasek zakładek', 'Widoczny pod paskiem adresu')}
    </div>

    <div class="card">
      <h2>Prywatność i treści</h2>
      ${toggleRow('securityWarningsEnabled', 'Ostrzeżenia o niebezpiecznych stronach', 'Blokuje strony z listy znanych złośliwych domen i ostrzega przed połączeniem bez szyfrowania (http). Wyłączenie usuwa też etykietę "Niezabezpieczona" w pasku adresu')}
      <div class="row">
        <div class="body"><div class="title">Lista złośliwych domen</div><div class="sub" id="securityInfo">sprawdzam...</div></div>
        <div class="ctl"><button class="btn" id="updateSecurity">Zaktualizuj teraz</button></div>
      </div>
      ${toggleRow('adblockEnabled', 'Bloker reklam i skryptów śledzących', 'Wbudowany, działa bez rozszerzeń. Pojedyncze strony można wyłączyć tarczą w pasku adresu')}
      <div class="row">
        <div class="body"><div class="title">Siła blokowania</div>
          <div class="sub">Bezpieczne blokuje reklamy i śledzenie na poziomie sieci, nie ruszając kodu stron. Agresywne dokłada skrypty wycinające reklamy z wnętrza odtwarzaczy, ale potrafi popsuć YouTube i inne serwisy wideo</div></div>
        <div class="ctl"><select class="field" data-key="adblockMode" style="width:170px">
          <option value="safe" ${v.adblockMode !== 'aggressive' ? 'selected' : ''}>Bezpieczne</option>
          <option value="aggressive" ${v.adblockMode === 'aggressive' ? 'selected' : ''}>Agresywne</option>
        </select></div>
      </div>
      <div class="row">
        <div class="body"><div class="title">Listy filtrów</div><div class="sub" id="filterInfo">sprawdzam...</div></div>
        <div class="ctl"><button class="btn" id="updateFilters">Zaktualizuj teraz</button></div>
      </div>
      ${toggleRow('blockThirdPartyCookies', 'Blokuj ciasteczka podmiotów trzecich', 'Odcina ciasteczka wysyłane do domen innych niż ta w pasku adresu. Tędy płynie śledzenie między stronami')}
      ${toggleRow('doNotTrack', 'Wysyłaj nagłówek Do Not Track', 'Prośba, żeby strony nie śledziły. Nie każda ja uszanuje')}
      ${toggleRow('passkeys', 'Klucze dostępu (passkeys)', 'Logowanie odciskiem palca, PIN-em albo kodem z telefonu, zamiast hasła. Gdy wyłączone, przeglądarka mówi stronom, że nie ma czym, i okno zabezpieczeń Windows przestaje wyskakiwać. Zmiana działa od nowej karty')}
      ${toggleRow('extensionsEnabled', 'Rozszerzenia', 'Wyłączenie odłącza wszystkie naraz, bez usuwania')}
      <div class="row">
        <div class="body"><div class="title">Wyczyść dane przeglądania</div><div class="sub">Historia, ciasteczka, pamięć podręczna i dane stron</div></div>
        <div class="ctl"><button class="btn danger" id="clearData">Wyczyść...</button></div>
      </div>
    </div>

    <div class="card">
      <h2>Pobieranie</h2>
      <div class="row">
        <div class="body"><div class="title">Folder pobierania</div><div class="sub">${esc(cfg.downloadDir)}</div></div>
        <div class="ctl"><button class="btn" id="chooseDir">Zmień</button></div>
      </div>
      ${toggleRow('askWhereToSave', 'Pytaj gdzie zapisać każdy plik', 'Zamiast zapisywać od razu do folderu powyżej')}
    </div>

    <div class="card">
      <h2>Zaawansowane</h2>
      ${toggleRow('hardwareAcceleration', 'Przyspieszenie sprzętowe', 'Renderowanie grafiki przez kartę graficzną. Zmiana zadziała po ponownym uruchomieniu')}
      ${toggleRow('spellcheckEnabled', 'Sprawdzanie pisowni', 'Podkreśla literówki w polach tekstowych. Domyślnie wyłączone - każda otwarta karta trzyma wtedy własny słownik w pamięci. Zmiana działa od nowej karty')}
      ${toggleRow('tabSleepEnabled', 'Usypianie nieużywanych kart', 'Karta, z której nie korzystasz od 20 minut, zwalnia zajmowaną przez siebie pamięć. Wraca do życia (z krótkim przeładowaniem) w chwili, gdy znów w nią klikniesz')}
      ${toggleRow('tabPrewarmEnabled', 'Szybsze otwieranie nowej karty', 'Trzyma w tle jedną gotową kartę, żeby kliknięcie "+" nie czekało na uruchomienie nowego procesu. Zajmuje trochę więcej pamięci - jedną dodatkową kartę na każde otwarte okno')}
      ${toggleRow('siteAccentEnabled', 'Kolor dopasowany do strony', 'Pasek Nazuny lekko przebarwia się na kolor wyliczony z ikonki aktywnej strony, zamiast trzymać cały czas jeden stały akcent')}
      <div class="row">
        <div class="body"><div class="title">Folder z danymi przeglądarki</div><div class="sub">Profil, zakładki, historia i rozszerzenia</div></div>
        <div class="ctl"><button class="btn" id="openData">Otwórz folder</button></div>
      </div>
      <div class="row">
        <div class="body"><div class="title">Przywróć ustawienia domyślne</div><div class="sub">Nie usuwa zakładek ani historii</div></div>
        <div class="ctl"><button class="btn danger" id="reset">Przywróć</button></div>
      </div>
    </div>`;

  page.querySelectorAll('[data-accent]').forEach((b) => b.addEventListener('click', () => save({ accent: b.dataset.accent })));
  document.getElementById('chooseDir').addEventListener('click', async () => {
    const dir = await api.invoke('downloads.chooseDir');
    if (dir) load();
  });
  document.getElementById('openData').addEventListener('click', () => api.send('app.openUserData'));
  document.getElementById('reset').addEventListener('click', async () => {
    cfg.values = await api.invoke('settings.reset');
    render();
    toast('Przywrócono ustawienia domyślne');
  });
  document.getElementById('clearData').addEventListener('click', clearDialog);
  refreshFilterInfo();
  document.getElementById('updateFilters').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    document.getElementById('filterInfo').textContent = 'pobieram najnowsze listy...';
    const result = await api.invoke('app.adblockUpdate');
    btn.disabled = false;
    if (result && result.ok) toast('Listy filtrów zaktualizowane');
    else toast(result && result.reason ? `Bez zmian: ${result.reason}` : 'Nie udało się pobrać list');
    refreshFilterInfo();
  });
  refreshSecurityInfo();
  document.getElementById('updateSecurity').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    document.getElementById('securityInfo').textContent = 'pobieram najnowszą listę...';
    const result = await api.invoke('app.securityUpdate');
    btn.disabled = false;
    if (result && result.ok) toast('Lista złośliwych domen zaktualizowana');
    else toast(result && result.reason ? `Bez zmian: ${result.reason}` : 'Nie udało się pobrać listy');
    refreshSecurityInfo();
  });
}

async function refreshFilterInfo() {
  const node = document.getElementById('filterInfo');
  if (!node) return;
  const st = await api.invoke('app.adblockStatus').catch(() => null);
  if (!st) { node.textContent = 'brak informacji'; return; }
  if (!st.ready) { node.textContent = 'listy filtrów nie są wczytane'; return; }
  node.textContent = st.updatedAt
    ? `Ostatnia aktualizacja: ${new Date(st.updatedAt).toLocaleString('pl-PL')}. Listy odświeżają się same co kilka dni, nie trzeba do tego aktualizować przeglądarki.`
    : 'Używane są listy dołączone do programu. Odświeżą się same przy pierwszym połączeniu z internetem.';
}

async function refreshSecurityInfo() {
  const node = document.getElementById('securityInfo');
  if (!node) return;
  const st = await api.invoke('app.securityStatus').catch(() => null);
  if (!st) { node.textContent = 'brak informacji'; return; }
  if (!st.ready) { node.textContent = 'lista nie jest jeszcze wczytana - potrzebne połączenie z internetem'; return; }
  node.textContent = `${st.count} znanych złośliwych domen. Ostatnia aktualizacja: ${new Date(st.updatedAt).toLocaleString('pl-PL')}. Lista odświeża się sama co kilka godzin.`;
}

async function save(patch) {
  cfg.values = await api.invoke('settings.set', { patch });
  document.documentElement.dataset.accent = cfg.values.accent || 'violet';
  // Motyw odswieza pagekit po rozgloszeniu zmiany, zeby nie uzyc starej wartosci.
  render();
}

/* Probki kolorow zaleza od motywu, wiec przerysowujemy je dopiero gdy pagekit
   ustawi motyw. Nasluchiwanie samego rozgloszenia bylo za wczesne. */
document.addEventListener('motyw:gotowy', () => { if (cfg && cfg.values) render(); });

page.addEventListener('change', (e) => {
  const node = e.target.closest('[data-key]');
  if (!node) return;
  const key = node.dataset.key;
  const value = node.type === 'checkbox' ? node.checked : node.value;
  save({ [key]: value });
});
page.addEventListener('keydown', (e) => {
  const node = e.target.closest('input[data-key][type="text"], input[data-key]:not([type])');
  if (node && e.key === 'Enter') { save({ [node.dataset.key]: node.value }); toast('Zapisano'); }
});

function clearDialog() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:40';
  wrap.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border-strong);border-radius:14px;box-shadow:var(--shadow-panel);width:380px;padding:20px">
    <h3 style="margin:0 0 14px;font-size:15px">Wyczyść dane przeglądania</h3>
    ${[['history', 'Historia przeglądania'], ['cookies', 'Ciasteczka i dane logowania'], ['cache', 'Pamięć podręczna'], ['storage', 'Dane stron i magazyn lokalny'], ['downloads', 'Lista pobranych plików']]
      .map(([k, label]) => `<label style="display:flex;align-items:center;gap:10px;padding:7px 0;color:var(--text-dim);font-size:12.5px">
        <span class="switch"><input type="checkbox" data-clear="${k}" ${k === 'cache' || k === 'history' ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></span>${label}</label>`).join('')}
    <div style="display:flex;gap:8px;margin-top:18px">
      <button class="btn" style="flex:1" data-cancel>Anuluj</button>
      <button class="btn danger" style="flex:1" data-confirm>Wyczyść</button>
    </div></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('[data-cancel]')) return wrap.remove();
    if (e.target.closest('[data-confirm]')) {
      const opts = {};
      wrap.querySelectorAll('[data-clear]').forEach((c) => { opts[c.dataset.clear] = c.checked; });
      wrap.remove();
      await api.invoke('settings.clearData', opts);
      toast('Dane wyczyszczone');
    }
  });
}

async function load() {
  cfg = await api.invoke('settings.get');
  document.documentElement.dataset.accent = cfg.values.accent || 'violet';
  render();
}
load();
