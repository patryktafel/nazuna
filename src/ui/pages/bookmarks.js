const page = document.getElementById('page');
let items = [];
let query = '';

function render() {
  const filtered = items.filter((b) => !query
    || (b.title || '').toLowerCase().includes(query.toLowerCase())
    || (b.url || '').toLowerCase().includes(query.toLowerCase()));
  const folders = filtered.filter((b) => b.type === 'folder');
  const links = filtered.filter((b) => b.type === 'link');

  page.innerHTML = head('Zakładki', 'bookmark', `
    <input class="field search" id="search" type="search" placeholder="Szukaj w zakładkach" value="${esc(query)}">
    <button class="btn" id="addFolder">Nowy folder</button>`) +
    (folders.length ? `<div class="card"><h2>Foldery</h2>${folders.map(rowHtml).join('')}</div>` : '') +
    (links.length
      ? `<div class="card"><h2>Zapisane strony</h2>${links.map(rowHtml).join('')}</div>`
      : `<div class="empty">${iconSvg('bookmark')}<div>${query ? 'Nic nie pasuje.' : 'Nie masz jeszcze zakładek. Kliknij gwiazdkę w pasku adresu.'}</div></div>`);

  document.getElementById('search').addEventListener('input', (e) => { query = e.target.value; render(); });
  document.getElementById('addFolder').addEventListener('click', async () => {
    await api.invoke('bookmarks.addFolder', { title: 'Nowy folder', parent: 'bar' });
    load();
  });
}

function rowHtml(b) {
  const isFolder = b.type === 'folder';
  return `<div class="list-item" data-id="${esc(b.id)}" data-url="${esc(b.url || '')}" data-type="${b.type}">
    ${isFolder ? iconSvg('folder') : `<img class="fav" src="${esc(favicon(b.url))}">`}
    <div class="main">
      <div class="name" contenteditable="false" data-title>${esc(b.title)}</div>
      ${isFolder ? '<div class="url">Folder</div>' : `<div class="url">${esc(b.url)}</div>`}
    </div>
    <div class="acts">
      <button class="iconbtn" data-rename="${esc(b.id)}" title="Zmień nazwę">${iconSvg('code')}</button>
      <button class="iconbtn danger" data-remove="${esc(b.id)}" title="Usuń">${iconSvg('trash')}</button>
    </div>
  </div>`;
}

page.addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) { e.stopPropagation(); await api.invoke('bookmarks.remove', { id: rm.dataset.remove }); load(); return; }
  const rn = e.target.closest('[data-rename]');
  if (rn) {
    e.stopPropagation();
    const node = rn.closest('.list-item').querySelector('[data-title]');
    node.contentEditable = 'true';
    node.focus();
    document.execCommand('selectAll', false, null);
    const finish = async () => {
      node.contentEditable = 'false';
      node.removeEventListener('blur', finish);
      await api.invoke('bookmarks.update', { id: rn.dataset.rename, patch: { title: node.textContent.trim() || 'Bez nazwy' } });
      load();
    };
    node.addEventListener('blur', finish);
    node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); node.blur(); } });
    return;
  }
  const row = e.target.closest('.list-item');
  if (row && row.dataset.type === 'link') api.send('nav.go', { input: row.dataset.url });
});

async function load() {
  items = await api.invoke('bookmarks.list');
  // Nie przerywamy komus zmiany nazwy w polowie pisania.
  if (document.activeElement && document.activeElement.isContentEditable) return;
  const s = document.getElementById('search');
  const szukal = s && document.activeElement === s;
  render();
  if (szukal) { const n = document.getElementById('search'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
}
load();
// Zakladka dodana gwiazdka albo z paska ma sie tu pojawic od razu.
if (api.on) api.on('bookmarks:changed', load);
