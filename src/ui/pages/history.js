const page = document.getElementById('page');
let items = [];
let query = '';

/* Sam naglowek z polem szukania rysujemy raz. Przebudowywanie pola przy kazdym
   wyniku potrafilo cofnac kursor, gdy kolejna litera wpadla w trakcie zapytania. */
function renderLista() {
  const grouped = [];
  let lastDay = null;
  for (const item of items) {
    const label = dayLabel(item.ts);
    if (label !== lastDay) { grouped.push({ header: label }); lastDay = label; }
    grouped.push(item);
  }

  document.getElementById('lista').innerHTML =
    (items.length ? `<div class="card">${grouped.map((row) => row.header
      ? `<div class="section-date">${esc(row.header)}</div>`
      : `<div class="list-item" data-url="${esc(row.url)}">
           ${favLitera(row.url)}
           <div class="main">
             <div class="name">${esc(row.title || row.url)}</div>
             <div class="url">${esc(row.url)}</div>
           </div>
           <div class="when">${new Date(row.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</div>
           <div class="acts"><button class="iconbtn danger" data-remove="${esc(row.url)}" title="Usuń">${iconSvg('trash')}</button></div>
         </div>`).join('')}</div>`
      : `<div class="empty">${iconSvg('clock')}<div>${query ? 'Nic nie pasuje do tego wyszukiwania.' : 'Historia jest pusta.'}</div>`
        // podpowiedz widac tylko w wygladzie Lawendowa mgla (styl w history.html)
        + `<div class="empty-hint">${query ? 'Spróbuj innego słowa albo fragmentu adresu.' : 'Tu pojawią się strony, które odwiedzisz. Okno prywatne niczego tu nie zapisuje.'}</div></div>`);
}

function zbudujStrone() {
  page.innerHTML = head('Historia', 'clock', `
    <input class="field search" id="search" type="search" placeholder="Szukaj w historii">
    <button class="btn danger" id="clear">Wyczyść historię</button>`) + '<div id="lista"></div>';

  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    query = search.value;
    load();
  });
  document.getElementById('clear').addEventListener('click', async () => {
    // przycisk stoi obok pola szukania, a kasowanie jest nieodwracalne - pytamy jak przy resecie ustawien
    if (!confirm('Usunąć całą historię przeglądania? Tego nie da się cofnąć.')) return;
    await api.invoke('history.clear', { since: 0 });
    items = [];
    renderLista();
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
let nrZapytania = 0;
function load() {
  clearTimeout(timer);
  const nr = ++nrZapytania;
  timer = setTimeout(async () => {
    const wynik = await api.invoke('history.search', { query, limit: 500 });
    // odpowiedz na starsze zapytanie: uzytkownik pisze dalej, nie pokazujemy nieaktualnej listy
    if (nr !== nrZapytania) return;
    items = wynik;
    renderLista();
  }, 90);
}

// np. "Wyczysc dane przegladania" w Ustawieniach w innej karcie
api.on('history:changed', load);

zbudujStrone();
load();
