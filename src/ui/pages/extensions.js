const page = document.getElementById('page');
let installed = [];
let catalog = { items: [], note: '' };
let busy = false;

function confidenceTag(level) {
  const map = { wysoka: ['ok', 'zwykle działa'], srednia: ['warn', 'działa częściowo'], niska: ['low', 'bywa zawodne'] };
  const [cls, label] = map[level] || ['', level];
  return `<span class="tag ${cls}">${esc(label)}</span>`;
}

/* N41: co rozszerzenie moze robic i co znalazlo sprawdzanie aktualizacji. */
function opisDostepu(e) {
  const linie = Array.isArray(e.uprawnienia) ? e.uprawnienia : [];
  // Kazde uprawnienie we wlasnym <span> (tekst ten sam: "a; b"), zeby w wygladzie
  // mgly pokazac je jako pigulki. Klasy ext-* tylko do wygladu (extensions.html).
  const lista = linie.map((l) => `<span class="ext-upr">${esc(l)}</span>`).join('<span class="ext-sep">; </span>');
  let html = linie.length
    ? `<div class="sub ext-uprawnienia">${e.wszystkieStrony ? '<span class="tag warn">wszystkie strony</span> ' : ''}<span class="ext-upr-etykieta">Uprawnienia:</span> ${lista}</div>`
    : '<div class="sub ext-uprawnienia"><span class="ext-upr-etykieta">Uprawnienia:</span> brak dostępu do stron i danych</div>';
  if (e.brakWSklepie) {
    html += '<div class="sub ext-info ext-info-low"><span class="tag low">nie ma go już w sklepie</span> Sklep Chrome nie zna już tego rozszerzenia. Mogło zostać usunięte, także za szkodliwe działanie. Rozważ jego usunięcie.</div>';
  }
  if (e.wymagaZgody) {
    html += `<div class="sub ext-info ext-info-warn"><span class="tag warn">aktualizacja v${esc(e.wymagaZgody.version)}</span> Nowa wersja chce więcej uprawnień: ${esc((e.wymagaZgody.linie || []).join('; '))}. Kliknij „Zaktualizuj”, jeśli się zgadzasz.</div>`;
  } else if (e.oczekujacaWersja) {
    html += `<div class="sub ext-info ext-info-ok"><span class="tag ok">nowa wersja v${esc(e.oczekujacaWersja)}</span> Zostanie wczytana przy następnym uruchomieniu Nazuny.</div>`;
  }
  return html;
}

function render() {
  const installedIds = new Set(installed.map((e) => e.id));
  page.innerHTML = head('Rozszerzenia', 'puzzle') + `
    <div class="card ext-instaluj">
      <h2>Zainstaluj ze sklepu Chrome</h2>
      <div class="row">
        <div class="body">
          <input class="field" id="input" placeholder="Wklej link ze sklepu albo identyfikator rozszerzenia" spellcheck="false">
          <div class="sub">Przykład: https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh</div>
        </div>
        <div class="ctl">
          <button class="btn primary" id="install">Zainstaluj</button>
          <button class="btn" id="folder">Z folderu</button>
        </div>
      </div>
      <div class="hint">Nazuna korzysta z silnika Chromium, ale nie z warstwy Google. Większość rozszerzeń działa, jednak te
        sięgające po konto Google, własne panele boczne albo nowsze funkcje Chrome mogą nie ruszyć. Jeśli coś nie działa,
        po prostu je usuń, nic się nie stanie.</div>
    </div>

    <div class="card ext-zainstalowane">
      <h2>Zainstalowane (${installed.length})</h2>
      ${installed.length ? installed.map((e) => `
        <div class="row ext-wpis">
          ${e.icon ? `<img class="ext-ikona" src="${esc(e.icon)}">`
            : `<div class="ext-ikona">${iconSvg('puzzle')}</div>`}
          <div class="body">
            <div class="title">${esc(e.name)} <span class="tag">v${esc(e.version || '?')}</span> <span class="tag">MV${e.manifestVersion}</span></div>
            <div class="sub">${esc(e.description || 'Bez opisu')}</div>
            ${opisDostepu(e)}
          </div>
          <div class="ctl">
            ${e.wymagaZgody ? `<button class="btn" data-install="${e.id}">Zaktualizuj</button>` : ''}
            ${e.optionsPage ? `<button class="iconbtn" data-options="${e.id}" title="Opcje">${iconSvg('settings')}</button>` : ''}
            <button class="iconbtn" data-store="${e.id}" title="Strona w sklepie">${iconSvg('external')}</button>
            <label class="switch" title="Włącz lub wyłącz">
              <input type="checkbox" data-toggle="${e.id}" ${e.enabled ? 'checked' : ''}>
              <span class="track"></span><span class="thumb"></span>
            </label>
            <button class="iconbtn danger" data-remove="${e.id}" title="Usuń">${iconSvg('trash')}</button>
          </div>
        </div>`).join('')
        : `<div class="hint ext-pusto">${iconSvg('puzzle')}<span>Nie masz jeszcze żadnych rozszerzeń.</span></div>`}
    </div>

    <div class="card ext-polecane">
      <h2>Polecane</h2>
      <div class="hint">${esc(catalog.note || '')}</div>
      ${catalog.items.map((c) => `
        <div class="row ext-wpis">
          <div class="ext-ikona ext-litera">${esc(c.name.charAt(0))}</div>
          <div class="body">
            <div class="title">${esc(c.name)} ${confidenceTag(c.confidence)} <span class="tag">${esc(c.category)}</span></div>
            <div class="sub">${esc(c.summary)}</div>
          </div>
          <div class="ctl">
            ${installedIds.has(c.id)
              ? '<span class="tag ok">zainstalowane</span>'
              : `<button class="btn" data-install="${c.id}">Zainstaluj</button>`}
          </div>
        </div>`).join('')}
    </div>`;

  document.getElementById('install').addEventListener('click', () => doInstall(document.getElementById('input').value));
  document.getElementById('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doInstall(e.target.value); });
  document.getElementById('folder').addEventListener('click', async () => {
    try {
      const r = await api.invoke('extensions.installFolder');
      if (r) { toast(`Wczytano ${r.name}`); load(); }
    } catch (err) { toast(err.message); }
  });
}

async function doInstall(value) {
  if (busy || !value.trim()) return;
  busy = true;
  toast('Pobieram rozszerzenie...');
  try {
    const r = await api.invoke('extensions.install', { input: value });
    // Po instalacji od razu mowimy, do czego rozszerzenie ma dostep (N41).
    toast(`Zainstalowano ${r.name}.${r.wszystkieStrony ? ' Ma dostęp do wszystkich stron, sprawdź uprawnienia na liście.' : ''}`);
    await load();
  } catch (err) {
    toast(String(err.message || err).replace(/^Error: /, ''));
  } finally { busy = false; }
}

page.addEventListener('click', async (e) => {
  const inst = e.target.closest('[data-install]');
  if (inst) return doInstall(inst.dataset.install);
  const rm = e.target.closest('[data-remove]');
  if (rm) { installed = await api.invoke('extensions.remove', { id: rm.dataset.remove }); render(); return; }
  const st = e.target.closest('[data-store]');
  if (st) { api.send('extensions.store', { id: st.dataset.store }); return; }
  const op = e.target.closest('[data-options]');
  if (op) api.send('extensions.options', { id: op.dataset.options });
});

page.addEventListener('change', async (e) => {
  const t = e.target.closest('[data-toggle]');
  if (!t) return;
  installed = await api.invoke('extensions.toggle', { id: t.dataset.toggle, enabled: t.checked });
  render();
});

async function load() {
  [installed, catalog] = await Promise.all([
    api.invoke('extensions.list'),
    api.invoke('extensions.catalog')
  ]);
  render();
}
load();
