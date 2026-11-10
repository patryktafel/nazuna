'use strict';
const { shell, app } = require('electron');
const { execFile } = require('child_process');

/* Windows od 8. nie pozwala programom cicho, samodzielnie przejmowac wyboru
   domyslnej przegladarki - to swiadoma ochrona przed nachalnymi albo
   zlosliwymi instalatorami, ktore podmienialyby go bez wiedzy uzytkownika.
   Jedyne co Nazuna moze zrobic, to zarejestrowac sie jako KANDYDAT (patrz
   build/installer.nsh - klucze StartMenuInternet/RegisteredApplications i
   ProgId "NazunaHTML"), a sam wybor i tak zapada tylko w oknie Ustawien
   Windows. Ten modul czyta stamtad, co uzytkownik faktycznie wybral
   (UserChoice), i w razie czego otwiera mu wlasciwa strone Ustawien.

   Samo "ms-settings:defaultapps" otwiera ogolna liste kategorii (przegladarka,
   poczta, ...) - to wlasnie tam trafialo, zanim ta poprawka dodala parametr
   "registeredAppUser". Z nim Windows (od wersji 11 22H2 z poprawka 2023-04)
   przechodzi od razu na podstrone SAMEJ Nazuny, z jednym przyciskiem "Ustaw
   jako domyslna" - dokladnie tak, jak robi to Chrome czy Firefox, ktore
   uzywaja tego samego mechanizmu, tylko z wlasna nazwa w miejscu Nazuny.
   Wartosc musi byc identyczna z nazwa wpisu w RegisteredApplications
   (patrz build/installer.nsh) - inaczej Windows cicho wraca do ogolnej listy. */

const PROG_ID = 'NazunaHTML';
const NAZWA_REJESTRACJI = 'Nazuna';
const KLUCZ_HTTP = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\UrlAssociations\\http\\UserChoice';

function odczytajProgId(klucz) {
  return new Promise((resolve) => {
    execFile('reg', ['query', klucz, '/v', 'ProgId'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const m = /ProgId\s+REG_SZ\s+(.+)/.exec(String(stdout));
      resolve(m ? m[1].trim() : null);
    });
  });
}

async function status() {
  // macOS: system sam pyta uzytkownika o zgode przy zmianie domyslnej przegladarki.
  if (process.platform === 'darwin') return { obslugiwane: app.isPackaged, domyslna: app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https') };
  if (process.platform !== 'win32') return { obslugiwane: false, domyslna: false };
  const progId = await odczytajProgId(KLUCZ_HTTP).catch(() => null);
  return { obslugiwane: true, domyslna: progId === PROG_ID };
}

function otworzUstawienia() {
  if (process.platform === 'darwin') {
    if (app.isPackaged) { app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); }
    return;
  }
  if (process.platform !== 'win32') return;
  shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(NAZWA_REJESTRACJI)}`);
}

module.exports = { status, otworzUstawienia };
