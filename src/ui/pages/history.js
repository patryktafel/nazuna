const page = document.getElementById('page');
let items = [];
let query = '';

function render() {
  const grouped = [];
  let lastDay = null;
  for (const item of items) {
    const label = dayLabel(item.ts);
    if (label !== lastDay) { grouped.push({ header: label }); lastDay = label; }
    grouped.push(item);
  }

  page.innerHTML = head('Historia', 'clock', `
    <input class="field search" id="search" type="search" placeholder="Szukaj w historii" value="${esc(query)}">
    <button class="btn danger" id="clear">Wyczyść historię</button>`) +
    (items.length ? `<div class="card">${grouped.map((row) => row.header
      ? `<div class="section-date">${esc(row.header)}</div>`
      : `<div class="list-item" data-url="${esc(row.url)}">
           <img class="fav" src="${esc(favicon(row.url))}" onerror="this.style.visibility='hidden'">
           <div class="main">
             <div class="name">${esc(row.title || row.url)}</div>
             <div class="url">${esc(row.url)}</div>
           </div>
           <div class="when">${new Date(row.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</div>
           <div class="acts"><button class="iconbtn danger" data-remove="${esc(row.url)}" title="Usuń">${iconSvg('trash')}</button></div>
         </div>`).join('')}</div>`
      : `<div class="empty">${iconSvg('clock')}<div>${query ? 'Nic nie pasuje do tego wyszukiwania.' : 'Historia jest pusta.'}</div></div>`);

  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    query = search.value;
    load();
  });
  document.getElementById('clear').addEventListener('click', async () => {
    await api.invoke('history.clear', { since: 0 });
    items = [];
    render();
    toast('Historia wyczyszczona');
  });
}

page.addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    e.stopPropagation();
    items = await api.invoke('history.remove', { urls: [rm.dataset.remove] });
    const keep = document.getElementById('search');
    query = keep ? keep.value : '';
    load();
    return;
  }
  const row = e.target.closest('.list-item');
  if (row) api.send('nav.go', { input: row.dataset.url });
});

let timer = null;
async function load() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const focused = document.activeElement && document.activeElement.id === 'search';
    const pos = focused ? document.activeElement.selectionStart : null;
    items = await api.invoke('history.search', { query, limit: 500 });
    render();
    if (focused) {
      const s = document.getElementById('search');
      s.focus();
      if (pos !== null) s.setSelectionRange(pos, pos);
    }
  }, 90);
}

load();
