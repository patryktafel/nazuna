const params = new URLSearchParams(location.search);
const typ = params.get('typ') || 'malicious';
const target = params.get('url') || '';

const TRESCI = {
  malicious: {
    ikona: 'alert',
    tytul: 'Ta strona może być niebezpieczna',
    opis: 'Adres, pod który próbujesz wejść, znajduje się na liście stron znanych z rozprzestrzeniania złośliwego oprogramowania albo wyłudzania danych. Jeśli się tego nie spodziewałeś, najbezpieczniej będzie stąd wyjść.'
  },
  insecure: {
    ikona: 'lock',
    tytul: 'Połączenie nie jest szyfrowane',
    opis: 'Ta strona nie używa HTTPS, więc to, co na niej wpiszesz, może zobaczyć ktoś inny w tej samej sieci. Nie podawaj tu haseł ani danych karty, jeśli nie musisz. To ostrzeżenie pokaże się dla tej strony tylko raz - jeśli przejdziesz dalej, następnym razem Nazuna wpuści cię bez pytania.'
  }
};

const t = TRESCI[typ] || TRESCI.malicious;

/* Dla zlosliwych domen przycisk "przejdz mimo to" jest celowo schowany za
   dodatkowym klikniecem "Szczegoly" - tak samo robi to Chrome i Firefox przy
   prawdziwym ostrzezeniu Safe Browsing, zeby nikt nie kliknal przez samo
   przyzwyczajenie do klikania w duzy przycisk. Przy http nie ma takiej
   potrzeby - to ostrzezenie i tak pyta tylko raz na strone. */
const chowajPrzycisk = typ === 'malicious';

document.getElementById('err').innerHTML = `
  ${iconSvg(t.ikona)}
  <h1>${esc(t.tytul)}</h1>
  <p>${esc(t.opis)}</p>
  <p><code>${esc(target)}</code></p>
  <div class="actions">
    <button class="btn primary" id="safe">Wróć do bezpieczeństwa</button>
  </div>
  ${chowajPrzycisk ? `
  <div class="actions" id="detailsRow" style="margin-top:16px">
    <button class="btn ghost" id="details" style="font-size:11.5px">Szczegóły</button>
  </div>
  <div class="actions" id="detailsBox" hidden style="margin-top:6px;flex-direction:column;gap:10px">
    <p style="font-size:11.5px;margin:0">Ta strona jest na liście znanych zagrożeń. Jeśli mimo to chcesz tam wejść, robisz to na własną odpowiedzialność.</p>
    <button class="btn ghost danger" id="proceed">Mimo wszystko przejdź do tej strony</button>
  </div>` : `
  <div class="actions" style="margin-top:2px">
    <button class="btn ghost" id="proceed">Rozumiem ryzyko, przejdź mimo to</button>
  </div>`}`;

document.getElementById('safe').addEventListener('click', () => api.send('nav.go', { input: 'nazuna://newtab' }));
const detailsBtn = document.getElementById('details');
if (detailsBtn) {
  detailsBtn.addEventListener('click', () => {
    document.getElementById('detailsBox').hidden = false;
    document.getElementById('detailsRow').hidden = true;
  });
}
document.getElementById('proceed').addEventListener('click', () => {
  if (target) api.send('security.proceed', { url: target, typ });
});
