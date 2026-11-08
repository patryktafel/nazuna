/* Ekran powitalny (nazuna://welcome) - kreator przy pierwszym starcie, po
   aktualizacji do nowego wygladu (kreatorWersja w data.js/index.js) albo przy
   kazdym starcie, gdy ktos zaznaczy "Pokazuj ten ekran przy kazdym starcie".
   Kazdy wybor zapisuje sie od razu, wiec cala przegladarka zmienia sie na
   zywo, jeszcze w trakcie kreatora. */

const WERSJA_KREATORA = 1; // to samo co w index.js

let cfg = { values: {} };
let krok = 0;

function powitanieWgPory() {
  const h = new Date().getHours();
  if (h >= 5 && h < 17) return 'Dzień dobry. Rozgość się.';
  if (h >= 17 && h < 22) return 'Dobry wieczór. Rozgość się.';
  return 'Witaj o tej późnej porze. Rozgość się.';
}

async function zapisz(patch) {
  cfg.values = await api.invoke('settings.set', { patch }).catch(() => cfg.values) || cfg.values;
  rysuj();
}

/* Karta wyboru z malym podgladem. podglad = klasy elementu .pw-podglad. */
function karta(id, nazwa, opis, podglad, wybrana) {
  return `<button class="pw-karta${wybrana ? ' wybrana' : ''}" type="button" data-wybor="${esc(id)}" aria-pressed="${wybrana}">
    <span class="pw-podglad ${esc(podglad)}"><i></i><i></i><i></i></span>
    <span class="pw-karta-nazwa">${esc(nazwa)}${wybrana ? iconSvg('check') : ''}</span>
    <span class="pw-karta-opis">${esc(opis)}</span>
  </button>`;
}

const KROKI = [
  {
    tytul: () => powitanieWgPory(),
    opis: 'Trzy małe kroki i Nazuna będzie Twoja. Wszystko da się później zmienić w ustawieniach.',
    tresc: () => {
      const w = cfg.values.wyglad === 'klasyczny' ? 'klasyczny' : 'mgla';
      return `<div class="pw-etykieta">Krok 1 · Wybierz wygląd</div>
        <div class="pw-karty">
          ${karta('wyglad:mgla', 'Lawendowa mgła', 'Nowy wygląd: miękkie kolory, szklany pasek', 'mgla', w === 'mgla')}
          ${karta('wyglad:klasyczny', 'Klasyczny', 'Wygląd sprzed zmiany, jasny albo ciemny', 'klasyczny', w === 'klasyczny')}
        </div>`;
    }
  },
  {
    tytul: () => 'Dopasuj kolory',
    // Okno prywatne ma zawsze swoje nocne kolory (data-prywatne nadpisuje
    // zestaw tla), wiec obietnica "od razu" tu by nie byla prawdziwa.
    opis: () => (cfg.prywatne && cfg.values.wyglad !== 'klasyczny'
      ? 'Wybierz nastrój. To okno prywatne ma zawsze swoje nocne kolory, więc zmianę zobaczysz w zwykłym oknie.'
      : 'Wybierz nastrój. Zobaczysz go od razu w całej przeglądarce.'),
    tresc: () => {
      if (cfg.values.wyglad === 'klasyczny') {
        const t = cfg.values.theme === 'light' || cfg.values.theme === 'system' ? cfg.values.theme : 'dark';
        return `<div class="pw-etykieta">Krok 2 · Motyw</div>
          <div class="pw-karty trzy">
            ${karta('theme:dark', 'Ciemny', 'Spokojny dla oczu wieczorem', 'ciemny', t === 'dark')}
            ${karta('theme:light', 'Jasny', 'Jak biała kartka', 'jasny', t === 'light')}
            ${karta('theme:system', 'Jak w Windows', 'Przełącza się razem z systemem', 'system', t === 'system')}
          </div>`;
      }
      const k = cfg.values.mglaKolory || 'lawenda';
      return `<div class="pw-etykieta">Krok 2 · Kolory tła</div>
        <div class="pw-karty trzy">
          ${karta('mglaKolory:lawenda', 'Lawenda', 'Fiolet z nutą błękitu', 'lawenda', k === 'lawenda')}
          ${karta('mglaKolory:roz', 'Róż', 'Ciepły róż i brzoskwinia', 'roz', k === 'roz')}
          ${karta('mglaKolory:morski', 'Morski', 'Głęboki błękit oceanu', 'morski', k === 'morski')}
        </div>`;
    }
  },
  {
    tytul: () => 'Nazuna już Cię chroni',
    opis: 'Nie musisz nic włączać. Tak jest od pierwszej minuty.',
    tresc: () => {
      const v = cfg.values;
      const punkt = (wlaczone, ikona, tytul, opis) => `<li class="pw-ochrona${wlaczone ? '' : ' wylaczona'}">
          <span class="pw-ochrona-ikona">${iconSvg(ikona)}</span>
          <span><b>${esc(tytul)}</b><small>${esc(wlaczone ? opis : 'Wyłączone - włączysz w ustawieniach')}</small></span>
        </li>`;
      return `<div class="pw-etykieta">Krok 3 · Twoja prywatność</div>
        <ul class="pw-lista">
          ${punkt(v.adblockEnabled !== false, 'shield', 'Bloker reklam i śledzenia', 'Reklamy i skrypty śledzące są zatrzymywane, zanim się wczytają')}
          ${punkt(v.slojkiCiasteczek !== false, 'lock', 'Osobne ciasteczka dla każdej strony', 'Przyciski i reklamy z innych firm nie śledzą Cię między stronami')}
          ${punkt(v.securityWarningsEnabled !== false, 'alert', 'Ostrzeżenia przed niebezpiecznymi stronami', 'Nazuna ostrzeże przed znanymi oszustwami i stronami bez szyfrowania')}
          ${punkt(true, 'incognito', 'Okno prywatne bez śladów', 'Po zamknięciu nie zostaje historia, ciasteczka ani pobrane pliki na liście')}
        </ul>`;
    }
  }
];

function rysuj() {
  const k = KROKI[krok];
  // Fokus klawiatury: karty sa rysowane od nowa, a "Wstecz" bywa chowane -
  // bez tego fokus spadalby na body i znikalo zaznaczenie.
  const aktywny = document.activeElement;
  const wybor = aktywny && aktywny.dataset ? aktywny.dataset.wybor : null;
  document.getElementById('tytul').textContent = k.tytul();
  document.getElementById('opis').textContent = typeof k.opis === 'function' ? k.opis() : k.opis;
  document.getElementById('kropki').innerHTML = KROKI.map((_, i) => `<span class="${i === krok ? 'teraz' : ''}"></span>`).join('');
  document.getElementById('krok').innerHTML = k.tresc();
  document.getElementById('wstecz').hidden = krok === 0;
  document.getElementById('pomin').hidden = krok === KROKI.length - 1;
  document.getElementById('dalej').textContent = krok === KROKI.length - 1 ? 'Zaczynamy' : 'Dalej';
  document.getElementById('zawsze').checked = cfg.values.pokazujPowitanie === true;
  const nowa = wybor ? document.querySelector(`[data-wybor="${CSS.escape(wybor)}"]`) : null;
  if (nowa) nowa.focus();
  else if (aktywny && aktywny !== document.body && (aktywny.hidden || !aktywny.isConnected)) {
    document.getElementById('dalej').focus();
  }
}

function zakoncz() {
  api.send('nav.go', { input: 'nazuna://newtab' });
}

document.getElementById('krok').addEventListener('click', (e) => {
  const b = e.target.closest('[data-wybor]');
  if (!b) return;
  const [klucz, wartosc] = b.dataset.wybor.split(':');
  zapisz({ [klucz]: wartosc });
});
document.getElementById('dalej').addEventListener('click', () => {
  if (krok < KROKI.length - 1) { krok += 1; rysuj(); } else zakoncz();
});
document.getElementById('wstecz').addEventListener('click', () => { if (krok > 0) { krok -= 1; rysuj(); } });
document.getElementById('pomin').addEventListener('click', zakoncz);
document.getElementById('zawsze').addEventListener('change', (e) => zapisz({ pokazujPowitanie: e.target.checked }));

(async () => {
  cfg = await api.invoke('settings.get').catch(() => cfg) || cfg;
  rysuj();
  // Kreator widziany - przy nastepnym starcie juz sie nie narzuca (chyba ze
  // ktos zaznaczyl "Pokazuj ten ekran przy kazdym starcie").
  if ((cfg.values.kreatorWersja || 0) < WERSJA_KREATORA) api.invoke('settings.set', { patch: { kreatorWersja: WERSJA_KREATORA } }).catch(() => {});
  document.body.classList.add('pw-gotowe');
})();
