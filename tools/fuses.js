'use strict';
/* Electron Fuses Nazuny - wspolne dla electron-builder.config.js (Windows,
   Linux) i tools/after-pack.js (macOS, gdzie kolejnosc trzeba ustawic recznie:
   fuses -> podpis VMP -> codesign). Opis kazdego przelacznika: komentarz przy
   electronFuses w electron-builder.config.js.

   Zestaw jest zgodny z wymaganiami podpisu VMP castLabs (FAQ castLabs):
   runAsNode false, cookie encryption true, NODE_OPTIONS false, inspect false,
   asar integrity true, only asar true, V8 snapshot false,
   grantFileProtocolExtraPrivileges true. Inny zestaw = "Binary signature denied". */
module.exports = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  grantFileProtocolExtraPrivileges: true,
  enableCookieEncryption: true
};
