'use strict';
/* Ochrona sieci lokalnej. Strona z internetu, ktora probuje polaczyc sie z
   urzadzeniem w sieci domowej (router, drukarka, kamera) albo z programem na
   tym komputerze (localhost), musi dostac zgode uzytkownika - tak jak przy
   kamerze czy lokalizacji. Bez tego dowolna strona moze po cichu wysylac
   polecenia do routera albo odpytywac lokalne uslugi.

   Zasada: cel jest lokalny, a strona w karcie jest publiczna (http/https,
   sama nie jest lokalna) -> pytamy o uprawnienie 'local-network' dla domeny
   tej strony. Nie dotyczy: wpisania adresu lokalnego w pasek ani klikniecia
   linku (nawigacja glownej ramki), stron lokalnych, stron nazuna://, plikow
   i rozszerzen.

   Ograniczenie: decyduje nazwa hosta z adresu. Publiczna nazwa, ktora serwer
   DNS przekieruje na adres prywatny, nie jest tu wykrywana. */
const data = require('./data');

const UPRAWNIENIE = 'local-network';

function lokalnyHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return false;
  if (h === 'localhost' || /\.(localhost|local|lan|internal|home\.arpa)$/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return !h.includes('.');   // nazwa bez kropki to urzadzenie w sieci lokalnej
}

function rozbierz(url) {
  try { const u = new URL(url); return { protokol: u.protocol, host: u.hostname }; } catch (_) { return null; }
}

/* Odpowiedzi udzielone bez "zapamietaj" trzymamy do zamkniecia karty, zeby
   kazde kolejne zadanie tej samej strony nie otwieralo nowego pytania.
   Wartosc: 'allow', 'deny' albo obietnica trwajacego pytania. */
const odpowiedzi = new Map();

/** Zwraca null (przepuscic), 'blokuj' albo obietnice jednego z nich. */
function sprawdz(ses, efemeryczna, details, zapytaj, zapamietana) {
  if (data.settings.get('ochronaSieciLokalnej', true) === false) return null;
  if (details.resourceType === 'mainFrame') return null;
  const cel = rozbierz(details.url);
  if (!cel || !lokalnyHost(cel.host)) return null;

  const wc = details.webContents && !details.webContents.isDestroyed() ? details.webContents : null;
  const zrodlo = rozbierz(wc ? wc.getURL() : (details.referrer || ''));
  if (!zrodlo || !/^https?:$/.test(zrodlo.protokol) || lokalnyHost(zrodlo.host)) return null;

  const pamiec = zapamietana(ses, efemeryczna, zrodlo.host, UPRAWNIENIE);
  if (pamiec === 'allow') return null;
  if (pamiec === 'deny') return 'blokuj';
  // Bez karty (np. skrypt dzialajacy w tle) nie ma gdzie pokazac pytania.
  if (!wc || !zapytaj) return 'blokuj';

  const klucz = `${wc.id}|${zrodlo.host}`;
  const znane = odpowiedzi.get(klucz);
  if (znane === 'allow') return null;
  if (znane === 'deny') return 'blokuj';
  if (znane) return znane;

  const pytanie = Promise.resolve()
    .then(() => zapytaj({ webContents: wc, permission: UPRAWNIENIE, origin: zrodlo.host, details: {} }))
    .then((odp) => {
      const wynik = odp === 'allow' ? 'allow' : 'deny';
      odpowiedzi.set(klucz, wynik);
      return wynik === 'allow' ? null : 'blokuj';
    }, () => { odpowiedzi.delete(klucz); return 'blokuj'; });
  odpowiedzi.set(klucz, pytanie);
  try { wc.once('destroyed', () => odpowiedzi.delete(klucz)); } catch (_) {}
  return pytanie;
}

module.exports = { sprawdz, lokalnyHost, UPRAWNIENIE };
