'use strict';
const { shell } = require('electron');
const { execFile } = require('child_process');

/* Windows od 8. nie pozwala programom cicho, samodzielnie przejmowac wyboru
   domyslnej przegladarki - to swiadoma ochrona przed nachalnymi albo
   zlosliwymi instalatorami, ktore podmienialyby go bez wiedzy uzytkownika.
   Jedyne co Nazuna moze zrobic, to zarejestrowac sie jako KANDYDAT (patrz
   build/installer.nsh - klucze StartMenuInternet/RegisteredApplications i
   ProgId "NazunaHTML"), a sam wybor i tak zapada tylko w oknie Ustawien
   Windows. Ten modul czyta stamtad, co uzytkownik faktycznie wybral
   (UserChoice), i w razie czego otwiera mu wlasciwa strone Ustawien -
   dokladnie tak samo, jak robi to Chrome czy Firefox. */

const PROG_ID = 'NazunaHTML';
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
  if (process.platform !== 'win32') return { obslugiwane: false, domyslna: false };
  const progId = await odczytajProgId(KLUCZ_HTTP).catch(() => null);
  return { obslugiwane: true, domyslna: progId === PROG_ID };
}

function otworzUstawienia() {
  if (process.platform !== 'win32') return;
  shell.openExternal('ms-settings:defaultapps');
}

module.exports = { status, otworzUstawienia };
