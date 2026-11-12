'use strict';
/* Powiadomienia w rogu okna: aktualizacje, zablokowane pobieranie,
   zablokowane wyskakujace okno, wynik instalacji rozszerzenia.

   Do 0.1.85 rysowal je sam pasek przegladarki (shell), ale warstwa paska
   konczy sie na dole paska zakladek, a powiadomienie stalo nizej - wiec
   nigdy nie bylo go widac. Teraz to osobna warstwa (patrz pokazToast w
   main/window.js), zawsze tylko tak duza jak samo powiadomienie. */
const api = window.nazuna;
const slot = document.getElementById('slot');

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Rozmiar warstwy idzie za rozmiarem powiadomienia - proces glowny ustawia
   wedlug tego granice widoku (0 = schowany). */
/* Mierzymy od razu, bez requestAnimationFrame/ResizeObserver: schowana
   warstwa ma rozmiar 0x0, a Chromium w takim widoku nie rysuje klatek, wiec
   pomiar czekajacy na klatke nigdy by sie nie wykonal i warstwa nigdy by sie
   nie pokazala. getBoundingClientRect liczy uklad i bez rysowania. */
let ostatni = '';
function zglosRozmiar() {
  const jest = !!slot.firstElementChild;
  const r = slot.getBoundingClientRect();
  const rozmiar = jest ? { w: Math.ceil(r.width), h: Math.ceil(r.height) } : { w: 0, h: 0 };
  const klucz = `${rozmiar.w}x${rozmiar.h}`;
  if (klucz === ostatni) return;
  ostatni = klucz;
  api.send('toast.rozmiar', rozmiar);
}
// Tresc moze jeszcze urosnac (np. dociagniety font) - jedno sprawdzenie po chwili.
function zglosRozmiarPozniej() { zglosRozmiar(); setTimeout(zglosRozmiar, 120); }

let chowanie = null;
function ukryj(animowane = true) {
  const node = slot.firstElementChild;
  clearTimeout(chowanie);
  if (!node) return;
  if (!animowane) { slot.innerHTML = ''; zglosRozmiar(); return; }
  node.classList.add('leaving');
  chowanie = setTimeout(() => { slot.innerHTML = ''; zglosRozmiar(); }, 320);
}

function pokaz(html, klasa) {
  ukryj(false);
  const node = document.createElement('div');
  node.className = klasa ? `update-toast ${klasa}` : 'update-toast';
  node.innerHTML = html;
  slot.appendChild(node);
  const x = node.querySelector('[data-act="close"]');
  if (x) x.addEventListener('click', () => ukryj());
  zglosRozmiarPozniej();
  return node;
}

const zamknij = `<button class="dismiss" data-act="close" title="Zamknij">${iconSvg('x')}</button>`;

/* Pamietamy, ktora wersja zostala odrzucona (x), zeby ciche sprawdzanie w tle
   nie pokazywalo tego samego powiadomienia w kolko. */
let odrzuconaWersja = null;
api.on('update:status', (stan) => {
  if (!stan) return;
  if (stan.status === 'dostepna') {
    if (odrzuconaWersja === stan.wersja) return;
    const node = pokaz(`
      <div class="row">${iconSvg('download')}<div class="title">Dostępna nowa wersja ${escapeHtml(stan.wersja || '')}</div>
        <button class="dismiss" data-act="odrzuc" title="Zamknij">${iconSvg('x')}</button></div>
      <div class="sub">Nazuna pobiera ją teraz sama, w tle.</div>`);
    node.querySelector('[data-act="odrzuc"]').addEventListener('click', () => { odrzuconaWersja = stan.wersja; ukryj(); });
  } else if (stan.status === 'pobieranie') {
    if (odrzuconaWersja && odrzuconaWersja === stan.wersja) return;
    // Postep odswiezamy w miejscu, zeby karta nie migala przy kazdym procencie.
    const tytul = slot.querySelector('.update-toast[data-pobieranie] .title');
    if (tytul) { tytul.textContent = `Pobieranie aktualizacji... ${stan.procent ?? 0}%`; return; }
    const node = pokaz(`
      <div class="row">${iconSvg('download')}<div class="title">Pobieranie aktualizacji... ${stan.procent ?? 0}%</div>${zamknij}</div>
      <div class="sub">Nazuna zainstaluje ją sama, gdy pobieranie się skończy.</div>`);
    node.dataset.pobieranie = '1';
  } else if (stan.status === 'pobrana') {
    const node = pokaz(`
      <div class="row">${iconSvg('download')}<div class="title">Wersja ${escapeHtml(stan.wersja || '')} jest gotowa do instalacji</div>${zamknij}</div>
      <div class="sub">Zainstaluje się przy najbliższym uruchomieniu programu, albo od razu, jeśli klikniesz niżej.</div>
      <div class="actions"><button class="go" data-act="install">Zainstaluj i uruchom ponownie</button></div>`);
    node.querySelector('[data-act="install"]').addEventListener('click', () => api.send('app.updateInstall'));
  } else if (stan.status === 'blad') {
    pokaz(`
      <div class="row">${iconSvg('alert')}<div class="title">Nie udało się pobrać aktualizacji</div>${zamknij}</div>
      <div class="sub">${escapeHtml(stan.komunikat || 'Spróbuj ponownie później, z poziomu O programie.')}</div>`, 'error');
  }
});

/* Plik z domeny z listy znanych zagrozen (patrz downloads.js). */
api.on('download-blocked', (d) => {
  const plik = escapeHtml((d && d.filename) || 'plik');
  const skad = d && d.host ? ` z ${escapeHtml(d.host)}` : '';
  pokaz(`
    <div class="row">${iconSvg('shield')}<div class="title">Zablokowano pobieranie</div>${zamknij}</div>
    <div class="sub">"${plik}"${skad} - ta domena jest na liście znanych zagrożeń.</div>`, 'error');
});

/* Zablokowane wyskakujace okno (patrz zablokowanoOkno w window.js). Znika
   samo po chwili - to informacja, a nie cos, co trzeba zamykac. */
let samoZniknie = null;
api.on('popup-blocked', (d) => {
  if (!d || !d.url) return;
  const node = pokaz(`
    <div class="row">${iconSvg('shield')}<div class="title">Zablokowano wyskakujące okno</div>${zamknij}</div>
    <div class="sub">Strona ${escapeHtml(d.host || '')} próbowała otworzyć nową kartę albo okno bez kliknięcia.</div>
    <div class="actions"><button class="go" data-act="open">Otwórz mimo to</button></div>`);
  node.querySelector('[data-act="open"]').addEventListener('click', () => { api.send('toast.otworz', { url: d.url }); ukryj(); });
  clearTimeout(samoZniknie);
  samoZniknie = setTimeout(() => { if (slot.firstElementChild === node && !node.matches(':hover')) ukryj(); }, 8000);
});

/* Instalacja rozszerzenia przyciskiem na stronie sklepu Chrome (shell.js). */
api.on('toast:rozszerzenie', (r) => {
  if (!r) return;
  if (r.ok) {
    pokaz(`
      <div class="row">${iconSvg('puzzle')}<div class="title">Zainstalowano ${escapeHtml(r.nazwa || '')}</div>${zamknij}</div>
      <div class="sub">Rozszerzenie znajdziesz w Ustawieniach - Rozszerzenia.</div>`);
  } else {
    pokaz(`
      <div class="row">${iconSvg('alert')}<div class="title">Nie udało się zainstalować</div>${zamknij}</div>
      <div class="sub">${escapeHtml(r.blad || '')}</div>`, 'error');
  }
});

/* Motyw i akcent jak w reszcie przegladarki. */
function wyglad() {
  api.invoke('settings.get').then((s) => {
    if (!s) return;
    if (s.values && s.values.accent) document.documentElement.dataset.accent = s.values.accent;
    document.documentElement.dataset.motyw = s.motyw || 'ciemny';
    document.documentElement.dataset.mgla = (s.values && s.values.mglaKolory) || 'lawenda';
    if (s.values && s.values.wyglad === 'washi' && !s.prywatne) document.documentElement.dataset.washi = s.washiNoc ? 'noc' : 'dzien';
    else delete document.documentElement.dataset.washi;
    if (s.values && s.values.wyglad === 'engawa' && !s.prywatne) document.documentElement.dataset.engawa = s.engawaNoc ? 'noc' : 'dzien'; else delete document.documentElement.dataset.engawa;
    // Okno prywatne: nocna karta z turkusem (toast.html). Plakietki
    // #privateBadge, po ktorej poznaje je shell.css, tu nie ma.
    if (s.prywatne) document.documentElement.dataset.prywatne = '1';
    else delete document.documentElement.dataset.prywatne;
    // W mgle karta ma inne odstepy i czcionke - widoczne powiadomienie
    // zmienia wtedy rozmiar, wiec warstwe trzeba zmierzyc jeszcze raz.
    zglosRozmiarPozniej();
  }).catch(() => {});
}
wyglad();
api.on('settings:changed', wyglad);
api.send('toast.gotowy');
