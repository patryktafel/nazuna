/* Ekran powitalny (nazuna://welcome) - kreator przy pierwszym starcie, po
   aktualizacji do nowego wygladu (kreatorWersja w data.js/index.js) albo przy
   kazdym starcie, gdy ktos zaznaczy "Pokazuj ten ekran przy kazdym starcie".
   Kazdy wybor zapisuje sie od razu, wiec cala przegladarka zmienia sie na
   zywo, jeszcze w trakcie kreatora. */

const WERSJA_KREATORA = 2; // to samo co w index.js

let cfg = { values: {} };
let krok = 0;
// Inne przegladarki z zakladkami (import.wykryj) i wyniki przenoszenia per id.
let importy = [];
const przeniesione = {};
function odmianaZakladek(n) {
  if (n === 1) return '1 zakładka';
  const r10 = n % 10, r100 = n % 100;
  return `${n} ${r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? 'zakładki' : 'zakładek'}`;
}

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
    opis: 'Kilka małych kroków i Nazuna będzie Twoja. Wszystko da się później zmienić w ustawieniach.',
    tresc: (n) => {
      const w = cfg.values.wyglad === 'klasyczny' || cfg.values.wyglad === 'washi' ? cfg.values.wyglad : 'mgla';
      return `<div class="pw-etykieta">Krok ${n} · Wybierz wygląd</div>
        <div class="pw-karty trzy">
          ${karta('wyglad:mgla', 'Lawendowa mgła', 'Miękkie kolory, szklany pasek', 'zdjecie mgla', w === 'mgla')}
          ${karta('wyglad:washi', 'Washi', 'Japoński ogród sakury, za dnia i nocą', 'zdjecie washi', w === 'washi')}
          ${karta('wyglad:klasyczny', 'Klasyczny', 'Wygląd sprzed zmiany, jasny albo ciemny', 'zdjecie klasyczny', w === 'klasyczny')}
        </div>`;
    }
  },
  {
    tytul: () => 'Dopasuj kolory',
    // Okno prywatne ma zawsze swoje nocne kolory (data-prywatne nadpisuje
    // zestaw tla), wiec obietnica "od razu" tu by nie byla prawdziwa.
    opis: () => (cfg.values.wyglad === 'washi'
      ? 'Washi ma dwie pory: jasny papier za dnia i świecącą sakurę nocą. Automatycznie przełącza się razem ze słońcem i księżycem na pasku.'
      : cfg.prywatne && cfg.values.wyglad !== 'klasyczny'
      ? 'Wybierz nastrój. To okno prywatne ma zawsze swoje nocne kolory, więc zmianę zobaczysz w zwykłym oknie.'
      : 'Wybierz nastrój. Zobaczysz go od razu w całej przeglądarce.'),
    tresc: (n) => {
      if (cfg.values.wyglad === 'washi') {
        // Washi: dzien (papier), noc (czern + swiecaca sakura) albo automatycznie.
        const t = cfg.values.washiTryb === 'dzien' || cfg.values.washiTryb === 'noc' ? cfg.values.washiTryb : 'auto';
        return `<div class="pw-etykieta">Krok ${n} · Pora dnia</div>
          <div class="pw-karty trzy">
            ${karta('washiTryb:dzien', 'Dzień', 'Kremowy papier i pastelowa sakura', 'zdjecie washi-dzien', t === 'dzien')}
            ${karta('washiTryb:noc', 'Noc', 'Głęboka czerń i świecąca sakura', 'zdjecie washi-noc', t === 'noc')}
            ${karta('washiTryb:auto', 'Automatycznie', 'Razem ze słońcem i księżycem na pasku', 'zdjecie washi', t === 'auto')}
          </div>`;
      }
      if (cfg.values.wyglad === 'klasyczny') {
        const t = cfg.values.theme === 'light' || cfg.values.theme === 'system' ? cfg.values.theme : 'dark';
        return `<div class="pw-etykieta">Krok ${n} · Motyw</div>
          <div class="pw-karty trzy">
            ${karta('theme:dark', 'Ciemny', 'Spokojny dla oczu wieczorem', 'ciemny', t === 'dark')}
            ${karta('theme:light', 'Jasny', 'Jak biała kartka', 'jasny', t === 'light')}
            ${karta('theme:system', 'Jak w systemie', 'Przełącza się razem z systemem', 'system', t === 'system')}
          </div>`;
      }
      const k = cfg.values.mglaKolory || 'lawenda';
      return `<div class="pw-etykieta">Krok ${n} · Kolory tła</div>
        <div class="pw-karty trzy">
          ${karta('mglaKolory:lawenda', 'Lawenda', 'Fiolet z nutą błękitu', 'lawenda', k === 'lawenda')}
          ${karta('mglaKolory:roz', 'Róż', 'Ciepły róż i brzoskwinia', 'roz', k === 'roz')}
          ${karta('mglaKolory:morski', 'Morski', 'Głęboki błękit oceanu', 'morski', k === 'morski')}
        </div>`;
    }
  },
  {
    tytul: () => 'Zabierz swoje zakładki',
    opis: 'Nazuna znalazła zakładki w innych przeglądarkach na tym komputerze. Możesz je przenieść jednym kliknięciem - nic nie wysyłamy do internetu.',
    tylkoGdy: () => importy.length > 0,
    tresc: (n) => `<div class="pw-etykieta">Krok ${n} · Twoje zakładki</div>
      <ul class="pw-lista">${importy.map((z) => {
        const w = przeniesione[z.id];
        const opis = w === 'trwa' ? 'Przenoszę...'
          : w && w.ok ? `Przeniesiono: ${odmianaZakladek(w.dodane)}${w.pominiete ? ` (pominięto powtórki: ${w.pominiete})` : ''}`
          : w ? (w.powod || 'Nie udało się przenieść')
          : `${odmianaZakladek(z.liczba)}${z.profil ? ` · profil ${z.profil}` : ''}`;
        const gotowe = w && w !== 'trwa' && w.ok;
        return `<li class="pw-ochrona${gotowe ? '' : ' pw-import'}">
          <span class="pw-ochrona-ikona">${iconSvg(gotowe ? 'check' : 'bookmark')}</span>
          <span class="pw-import-tekst"><b>${esc(z.przegladarka)}</b><small>${esc(opis)}</small></span>
          ${gotowe ? '' : `<button class="btn" type="button" data-import="${esc(z.id)}" ${w === 'trwa' ? 'disabled' : ''}>Przenieś</button>`}
        </li>`;
      }).join('')}</ul>`
  },
  {
    tytul: () => 'Nazuna już Cię chroni',
    opis: 'Nie musisz nic włączać. Tak jest od pierwszej minuty.',
    tresc: (n) => {
      const v = cfg.values;
      const punkt = (wlaczone, ikona, tytul, opis) => `<li class="pw-ochrona${wlaczone ? '' : ' wylaczona'}">
          <span class="pw-ochrona-ikona">${iconSvg(ikona)}</span>
          <span><b>${esc(tytul)}</b><small>${esc(wlaczone ? opis : 'Wyłączone - włączysz w ustawieniach')}</small></span>
        </li>`;
      return `<div class="pw-etykieta">Krok ${n} · Twoja prywatność</div>
        <ul class="pw-lista">
          ${punkt(v.adblockEnabled !== false, 'shield', 'Bloker reklam i śledzenia', 'Reklamy i skrypty śledzące są zatrzymywane, zanim się wczytają')}
          ${punkt(v.slojkiCiasteczek !== false, 'lock', 'Osobne ciasteczka dla każdej strony', 'Przyciski i reklamy z innych firm nie śledzą Cię między stronami')}
          ${punkt(v.securityWarningsEnabled !== false, 'alert', 'Ostrzeżenia przed niebezpiecznymi stronami', 'Nazuna ostrzeże przed znanymi oszustwami i stronami bez szyfrowania')}
          ${punkt(true, 'incognito', 'Okno prywatne bez śladów', 'Po zamknięciu nie zostaje historia, ciasteczka ani pobrane pliki na liście')}
        </ul>`;
    }
  }
];

/* Kroki do pokazania - krok z zakladkami tylko, gdy jest skad je przeniesc. */
function kroki() { return KROKI.filter((k) => !k.tylkoGdy || k.tylkoGdy()); }

function rysuj() {
  const KR = kroki();
  if (krok > KR.length - 1) krok = KR.length - 1;
  const k = KR[krok];
  // Fokus klawiatury: karty sa rysowane od nowa, a "Wstecz" bywa chowane -
  // bez tego fokus spadalby na body i znikalo zaznaczenie.
  const aktywny = document.activeElement;
  const wybor = aktywny && aktywny.dataset ? aktywny.dataset.wybor : null;
  document.getElementById('tytul').textContent = k.tytul();
  document.getElementById('opis').textContent = typeof k.opis === 'function' ? k.opis() : k.opis;
  document.getElementById('kropki').innerHTML = KR.map((_, i) => `<span class="${i === krok ? 'teraz' : ''}"></span>`).join('');
  document.getElementById('krok').innerHTML = k.tresc(krok + 1);
  document.getElementById('wstecz').hidden = krok === 0;
  document.getElementById('pomin').hidden = krok === KR.length - 1;
  document.getElementById('dalej').textContent = krok === KR.length - 1 ? 'Zaczynamy' : 'Dalej';
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

document.getElementById('krok').addEventListener('click', async (e) => {
  const imp = e.target.closest('[data-import]');
  if (imp) {
    const id = imp.dataset.import;
    przeniesione[id] = 'trwa'; rysuj();
    przeniesione[id] = await api.invoke('import.zakladki', { id }).catch(() => null) || { ok: false };
    rysuj();
    return;
  }
  const b = e.target.closest('[data-wybor]');
  if (!b) return;
  const [klucz, wartosc] = b.dataset.wybor.split(':');
  zapisz({ [klucz]: wartosc });
});
document.getElementById('dalej').addEventListener('click', () => {
  if (krok < kroki().length - 1) { krok += 1; rysuj(); } else zakoncz();
});
document.getElementById('wstecz').addEventListener('click', () => { if (krok > 0) { krok -= 1; rysuj(); } });
document.getElementById('pomin').addEventListener('click', zakoncz);
document.getElementById('zawsze').addEventListener('change', (e) => zapisz({ pokazujPowitanie: e.target.checked }));

(async () => {
  cfg = await api.invoke('settings.get').catch(() => cfg) || cfg;
  // W oknie prywatnym nie proponujemy przenoszenia (to trwala zmiana zakladek).
  if (!cfg.prywatne) importy = await api.invoke('import.wykryj').catch(() => []) || [];
  rysuj();
  // Kreator widziany - przy nastepnym starcie juz sie nie narzuca (chyba ze
  // ktos zaznaczyl "Pokazuj ten ekran przy kazdym starcie").
  if ((cfg.values.kreatorWersja || 0) < WERSJA_KREATORA) api.invoke('settings.set', { patch: { kreatorWersja: WERSJA_KREATORA } }).catch(() => {});
  document.body.classList.add('pw-gotowe');
})();
