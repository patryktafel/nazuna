const page = document.getElementById('page');
let items = [];

function stateLabel(d) {
  if (d.state === 'completed') return bytes(d.total);
  if (d.state === 'progressing') return `${bytes(d.received)} z ${d.total ? bytes(d.total) : '?'}${d.speed ? ` - ${bytes(d.speed)}/s` : ''}`;
  if (d.state === 'paused') return 'Wstrzymane';
  if (d.state === 'cancelled') return 'Anulowane';
  return 'Nie udało się pobrać';
}

function render() {
  page.innerHTML = head('Pobrane', 'download', `<button class="btn" id="dir">Zmień folder</button><button class="btn danger" id="clear">Wyczyść listę</button>`) +
    (items.length ? `<div class="card">${items.map((d) => {
      const pct = d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
      const running = d.state === 'progressing' || d.state === 'paused';
      return `<div class="list-item" data-row="${d.id}">
        <div class="dl-icon" style="width:34px;height:34px;border-radius:9px;background:var(--surface-3);display:flex;align-items:center;justify-content:center;color:var(--text-dim)">${iconSvg(d.state === 'completed' ? 'file' : 'download')}</div>
        <div class="main">
          <div class="name">${esc(d.filename)}</div>
          <div class="url">${esc(hostOf(d.url))} - ${esc(stateLabel(d))}</div>
          ${running ? `<div class="dl-bar" style="height:3px;border-radius:2px;background:rgba(255,255,255,.08);margin-top:7px;overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:var(--accent)"></i></div>` : ''}
        </div>
        <div class="when">${d.finishedAt ? timeAgo(d.finishedAt) : ''}</div>
        <div class="acts">
          ${d.state === 'completed' ? `<button class="iconbtn" data-act="open" data-id="${d.id}" title="Otwórz">${iconSvg('external')}</button>
            <button class="iconbtn" data-act="folder" data-id="${d.id}" title="Pokaż w folderze">${iconSvg('folder')}</button>` : ''}
          ${d.state === 'progressing' ? `<button class="iconbtn" data-act="pause" data-id="${d.id}" title="Wstrzymaj">${iconSvg('pause')}</button>` : ''}
          ${d.state === 'paused' ? `<button class="iconbtn" data-act="resume" data-id="${d.id}" title="Wznów">${iconSvg('play')}</button>` : ''}
          ${running ? `<button class="iconbtn" data-act="cancel" data-id="${d.id}" title="Anuluj">${iconSvg('x')}</button>` : ''}
          <button class="iconbtn danger" data-act="remove" data-id="${d.id}" title="Usuń z listy">${iconSvg('trash')}</button>
        </div>
      </div>`;
    }).join('')}</div>`
      : `<div class="empty">${iconSvg('download')}<div>Nic jeszcze nie pobrano.</div></div>`);

  document.getElementById('clear').addEventListener('click', async () => {
    // jak w historii: czyszczenie calej listy tylko po potwierdzeniu
    if (!confirm('Wyczyścić listę pobranych plików? Same pliki zostaną na dysku.')) return;
    items = await api.invoke('downloads.clear');
    render();
  });
  document.getElementById('dir').addEventListener('click', async () => {
    const dir = await api.invoke('downloads.chooseDir');
    if (dir) toast(`Nowy folder pobierania: ${dir}`);
  });
}

page.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  items = await api.invoke('downloads.control', { id: b.dataset.id, action: b.dataset.act });
  render();
});

api.on('download-updated', (d) => {
  const i = items.findIndex((x) => x.id === d.id);
  if (i < 0) return;
  const prev = items[i];
  items[i] = d;
  // zdarzenie przychodzi co ~0,5 s; pelny render podmienia przyciski miedzy mousedown a mouseup
  // i klik w Wstrzymaj/Anuluj ginie. Przy tym samym stanie zmieniamy tylko tekst i pasek w wierszu.
  const row = prev.state === d.state && page.querySelector(`[data-row="${CSS.escape(String(d.id))}"]`);
  if (!row) { render(); return; }
  const url = row.querySelector('.url');
  if (url) url.textContent = `${hostOf(d.url)} - ${stateLabel(d)}`;
  const bar = row.querySelector('.dl-bar > i');
  if (bar) bar.style.width = `${d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0}%`;
});
api.on('download-started', () => load());
api.on('download-done', () => load());

async function load() { items = await api.invoke('downloads.list'); render(); }
load();
