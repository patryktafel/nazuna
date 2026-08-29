const params = new URLSearchParams(location.search);
const typ = params.get('typ') || 'malicious';
const target = params.get('url') || '';

/* Etap 2 dopisze tu wlasciwy powod (nazwa listy, na ktorej znalazl sie
   adres), etap 3 - ewentualny wyjatek "nie pytaj wiecej dla tej strony".
   Na razie tresc jest ogolna, ale wystarczajaca, zeby przetestowac sama
   strone niezaleznie od tego, co ja pozniej wywola. */
const TRESCI = {
  malicious: {
    ikona: 'alert',
    tytul: 'Ta strona może być niebezpieczna',
    opis: 'Adres, pod który próbujesz wejść, znajduje się na liście stron znanych z rozprzestrzeniania złośliwego oprogramowania albo wyłudzania danych. Jeśli się tego nie spodziewałeś, najbezpieczniej będzie stąd wyjść.'
  },
  insecure: {
    ikona: 'lock',
    tytul: 'Połączenie nie jest szyfrowane',
    opis: 'Ta strona nie używa HTTPS, więc to, co na niej wpiszesz, może zobaczyć ktoś inny w tej samej sieci. Nie podawaj tu haseł ani danych karty, jeśli nie musisz.'
  }
};

const t = TRESCI[typ] || TRESCI.malicious;

document.getElementById('err').innerHTML = `
  ${iconSvg(t.ikona)}
  <h1>${esc(t.tytul)}</h1>
  <p>${esc(t.opis)}</p>
  <p><code>${esc(target)}</code></p>
  <div class="actions">
    <button class="btn primary" id="safe">Wróć do bezpieczeństwa</button>
  </div>
  <div class="actions" style="margin-top:2px">
    <button class="btn ghost" id="proceed">Rozumiem ryzyko, przejdź mimo to</button>
  </div>`;

document.getElementById('safe').addEventListener('click', () => api.send('nav.go', { input: 'nazuna://newtab' }));
document.getElementById('proceed').addEventListener('click', () => {
  if (target) api.send('security.proceed', { url: target });
});
