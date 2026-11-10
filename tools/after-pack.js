'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

/* macOS: kolejnosc wymagana przez castLabs i macOS:
   1. fuses (zmieniaja plik Electron Framework, wiec musza byc przed podpisami),
   2. podpis VMP castLabs (na Macu PRZED codesign, odwrotnie niz na Windows),
   3. podpis lokalny ad-hoc (codesign -s -), bez ktorego macOS na procesorach
      Apple nie uruchamia programu.
   electron-builder ustawia fuses dopiero po afterPack, dlatego w konfiguracji
   electronFuses dla Maca jest wylaczone, a wszystko dzieje sie tutaj. */
async function mac(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const fuses = await context.packager.generateFuseConfig(require('./fuses'));
  await context.packager.addElectronFuses(context, fuses);
  console.log('  • fuses ustawione (macOS)');

  require('./after-sign').podpiszVmp(context.appOutDir);

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('  • podpis lokalny (ad-hoc) gotowy');
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') return mac(context);
  if (context.electronPlatformName === 'win32') przemianujPodpisWindows(context);
};
