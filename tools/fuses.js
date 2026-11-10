'use strict';
/* Electron Fuses Nazuny - wspolne dla electron-builder.config.js.
   Konfiguracja macOS nadpisuje grantFileProtocolExtraPrivileges na false
   i pomija VMP; podpis hardened runtime wykonuje electron-builder.
   Opis kazdego przelacznika: komentarz przy
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
