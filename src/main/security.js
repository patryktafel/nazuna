'use strict';

/* --------------------------------------------------------------------
   Wspolny punkt bezpieczenstwa nawigacji. Kazda proba wejscia na strone -
   z paska adresu, z klikniecia linku, z nowej karty i z przekierowania -
   przechodzi przez sprawdz(), zanim cokolwiek sie zaladuje (patrz
   window.js, metoda Tab.otworz). Dzieki jednemu wspolnemu miejscu zadna
   z tych sciezek nie moze przypadkiem ominac sprawdzenia.

   Ten plik na razie buduje sam mechanizm i strone ostrzegawcza
   (nazuna://warning). Realna detekcja dochodzi w kolejnych etapach:
     etap 2 - lista znanych zlosliwych domen (phishing, malware)
     etap 3 - ostrzezenie o polaczeniu bez szyfrowania (http)
   Do tego czasu sprawdz() zawsze zwraca null, wiec dla uzytkownika nic
   sie jeszcze nie zmienia - to szkielet pod kolejne etapy. */

function sprawdz(url) {
  return null; // null = bezpieczne. W przeciwnym razie: { typ: 'malicious' | 'insecure' }
}

function adresOstrzezenia(typ, target) {
  const params = new URLSearchParams({ typ, url: target });
  return `nazuna://warning/?${params.toString()}`;
}

module.exports = { sprawdz, adresOstrzezenia };
