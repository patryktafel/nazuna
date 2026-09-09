'use strict';
const { app } = require('electron');
const { DOH_PROVIDERS } = require('./constants');
const data = require('./data');

/* DNS przez HTTPS. Bez tego kazde zapytanie "jaki adres ma ta domena" leci
   plaskim tekstem do serwera DNS dostawcy internetu - widzi wiec kazda
   strone, ktora odwiedzasz, nawet jesli sama strona idzie juz szyfrowanym
   https. app.configureHostResolver() to wbudowana w Chromium obsluga tego
   - dziala tak samo jak przelacznik "Uzyj bezpiecznego DNS" w Chrome, tylko
   od razu z wybranym dostawca, bez pytania przy kazdym uruchomieniu.

   Tryb 'secure' wymusza DoH bez cichego cofania sie do zwyklego DNS, gdy
   wybrany dostawca akurat nie odpowiada - to swiadomy wybor: wolimy rzadka
   chwile bez internetu niz DNS, ktory po cichu przestaje byc szyfrowany.
   Zmiana ustawienia wywoluje ta funkcje ponownie, wiec dziala od razu, bez
   restartu przegladarki. */
function applySecureDns() {
  const wybrany = data.settings.get('secureDns', 'cloudflare');
  const provider = DOH_PROVIDERS[wybrany];
  try {
    if (provider) {
      app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: [provider.template] });
    } else {
      app.configureHostResolver({ secureDnsMode: 'off' });
    }
  } catch (err) {
    console.warn('[privacy] configureHostResolver:', err.message);
  }
}

module.exports = { applySecureDns };
