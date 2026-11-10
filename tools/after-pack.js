'use strict';
const fs = require('fs');
const path = require('path');

/* Windows: build castLabs niesie podpis VMP w pliku obok pliku wykonywalnego.
   Po zmianie nazwy electron.exe na Nazuna.exe podpis musi nazywac sie tak samo,
   inaczej zostaje osierocony plik wskazujacy na nieistniejacy program. */
function przemianujPodpisWindows(context) {
  const dir = context.appOutDir;
  const exe = `${context.packager.appInfo.productFilename}.exe`;
  const from = path.join(dir, 'electron.exe.sig');
  const to = path.join(dir, `${exe}.sig`);
  try {
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.renameSync(from, to);
      console.log(`  • podpis VMP przemianowany na ${exe}.sig`);
    }
  } catch (err) {
    console.warn('  • nie udało się przemianować podpisu VMP:', err.message);
  }
}

/* macOS: bez podpisu VMP wymagajacego dodatkowych uprawnien file://.
   electron-builder ustawia fuses, nastepnie podpisuje app i helpery
   z hardened runtime oraz odpowiednimi entitlements. */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') {
    console.log('  • VMP macOS pominięty: zachowana izolacja file://; podpis lokalny wykona electron-builder.');
    return;
  }
  if (context.electronPlatformName === 'win32') przemianujPodpisWindows(context);
};
