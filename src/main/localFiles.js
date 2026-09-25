'use strict';
const crypto = require('crypto');

/* Token -> pelna sciezka do lokalnego pliku, ktory system otworzyl w Nazunie
   (skojarzenie pliku .pdf w Eksploratorze - patrz build/installer.nsh,
   ProgId "NazunaPDF" - i argToStartUrl w index.js).

   Strona nazuna://pdf nie dostaje surowej sciezki/adresu file:// wprost w
   query stringu, tylko taki token. Gdyby dostawala surowa sciezke, dowolna
   zlosliwa strona mogłaby wstawic link "nazuna://pdf?src=file:///C:/cos
   /prywatnego.pdf" i kazac Nazunie odczytac cudzy (a raczej: jakikolwiek)
   plik z dysku uzytkownika. Token generuje wylacznie main process, i tylko
   wtedy, gdy to naprawde system (a nie jakas strona) poprosil o otwarcie
   konkretnego pliku - wiec zgadniecie albo podrobienie go z zewnatrz nic
   nie daje. */
const rejestr = new Map();

function zarejestruj(absolutnaSciezka) {
  const token = crypto.randomUUID();
  rejestr.set(token, absolutnaSciezka);
  return token;
}

function pobierzSciezke(token) {
  return rejestr.get(String(token || '')) || null;
}

module.exports = { zarejestruj, pobierzSciezke };
