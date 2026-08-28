'use strict';
const fs = require('fs');
const path = require('path');

/* Build castLabs niesie podpis VMP w pliku obok pliku wykonywalnego. Po zmianie
   nazwy electron.exe na Nazuna.exe podpis musi nazywać się tak samo, inaczej
   zostaje osierocony plik wskazujący na nieistniejący program. */
exports.default = async function afterPack(context) {
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
};
