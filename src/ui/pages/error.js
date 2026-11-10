const params = new URLSearchParams(location.search);
const url = params.get('url') || '';
const code = params.get('code') || '';
const description = params.get('description') || '';

const REASONS = {
  'awaria': ['Ta karta uległa awarii', 'Kliknij "Spróbuj ponownie", żeby wczytać ją od nowa.'],
  '-105': ['Nie znaleziono tej domeny', 'Sprawdź, czy adres nie ma literówki.'],
  '-106': ['Brak połączenia z internetem', 'Wygląda na to, ze komputer nie ma dostepu do sieci.'],
  '-109': ['Serwer nie odpowiada', 'Adres jest poprawny, ale nikt pod nim nie odbiera.'],
  '-118': ['Połączenie trwało zbyt długo', 'Serwer nie odpowiedział na czas.'],
  '-137': ['Nie udało się ustalić adresu serwera', 'Problem z DNS albo z siecią.'],
  '-201': ['Certyfikat strony jest nieważny', 'Połączenie może być niebezpieczne.'],
  '-202': ['Certyfikat nie pasuje do adresu', 'Połączenie może być niebezpieczne.'],
  '-501': ['Połączenie nie jest bezpieczne', 'Strona nie udostępnia poprawnego szyfrowania.']
};

const [title, hint] = REASONS[code] || ['Nie udało się otworzyć strony', 'Spróbuj odświeżyć za chwilę.'];

document.getElementById('err').innerHTML = `
  ${iconSvg('alert')}
  <h1>${esc(title)}</h1>
  <p>${esc(hint)}</p>
  <p><code>${esc(url)}</code></p>
  ${description ? `<p style="color:var(--text-faint);font-size:12px">${esc(description)} (${esc(code)})</p>` : ''}
  <div class="actions">
    <button class="btn primary" id="retry">${iconSvg('reload', 'err-btn-ikona')}Spróbuj ponownie</button>
    <button class="btn" id="home">Nowa karta</button>
  </div>`;

document.getElementById('retry').addEventListener('click', () => api.send('nav.go', { input: url }));
document.getElementById('home').addEventListener('click', () => api.send('nav.go', { input: 'nazuna://newtab' }));
