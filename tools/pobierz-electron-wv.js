'use strict';
/* Pobiera wersję Electrona od castLabs (tę z obsługą Widevine) i rozpakowuje
   ją do folderu electron-wv. Uruchamiane raz; przy kolejnych budowaniach
   skrypt widzi gotowy folder i kończy od razu. */
const fs = require('fs');
const path = require('path');
const https = require('https');

const WERSJA = '43.5.0';

/* Domyslnie pobieramy silnik dla Windows. Uruchomienie z argumentem --mac
   sciaga wariant dla Macow z procesorem Apple, do osobnego folderu, zeby oba
   mogly lezec obok siebie. */
const NA_MACA = process.argv.includes('--mac');
const NA_LINUKSA = process.argv.includes('--linux');
const WARIANT = NA_MACA ? 'darwin-arm64' : (NA_LINUKSA ? 'linux-x64' : 'win32-x64');
const FOLDER = NA_MACA ? 'electron-wv-mac' : (NA_LINUKSA ? 'electron-wv-linux' : 'electron-wv');
const ZNACZNIK = NA_MACA ? 'Electron.app' : (NA_LINUKSA ? 'electron' : 'electron.exe');

const PLIK = `electron-v${WERSJA}%2Bwvcus-${WARIANT}.zip`;
const URL = `https://github.com/castlabs/electron-releases/releases/download/v${WERSJA}%2Bwvcus/${PLIK}`;

const root = path.join(__dirname, '..');
const cel = path.join(root, FOLDER);
const zip = path.join(root, `${FOLDER}.zip`);

function pobierz(url, plik, glebokosc = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'nazuna-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && glebokosc < 6) {
        res.destroy();
        return resolve(pobierz(res.headers.location, plik, glebokosc + 1));
      }
      if (res.statusCode !== 200) {
        res.destroy();
        return reject(new Error(`serwer odpowiedział ${res.statusCode}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let pobrane = 0;
      let ostatnio = 0;
      const out = fs.createWriteStream(plik);
      res.on('data', (c) => {
        pobrane += c.length;
        const proc = total ? Math.floor((pobrane / total) * 100) : 0;
        if (proc >= ostatnio + 10) { ostatnio = proc; process.stdout.write(`   ${proc}%\n`); }
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  if (fs.existsSync(path.join(cel, ZNACZNIK))) {
    console.log('Silnik z obsługą DRM już jest, pomijam pobieranie.');
    return;
  }
  console.log('Pobieram silnik z obsługą DRM (około 140 MB, tylko za pierwszym razem)...');
  try {
    await pobierz(URL, zip);
  } catch (err) {
    console.error(`\nNie udało się pobrać silnika: ${err.message}`);
    console.error('Nazuna zbuduje się mimo to, ale bez odtwarzania Netfliksa i podobnych.\n');
    try { fs.unlinkSync(zip); } catch (_) {}
    return;
  }
  console.log('Rozpakowuję...');
  fs.mkdirSync(cel, { recursive: true });
  if (NA_MACA || NA_LINUKSA) {
    /* Paczki dla Maca i Linuksa zawieraja dowiazania symboliczne oraz pliki,
       ktore musza zostac wykonywalne. Biblioteka adm-zip gubi jedno i drugie,
       po czym aplikacja nie daje sie uruchomic. Systemowy unzip to zachowuje. */
    const { execFileSync } = require('child_process');
    execFileSync('unzip', ['-qq', '-o', zip, '-d', cel], { stdio: 'inherit' });
  } else {
    const AdmZip = require('adm-zip');
    new AdmZip(zip).extractAllTo(cel, true);
  }
  try { fs.unlinkSync(zip); } catch (_) {}
  console.log('Silnik gotowy.\n');
})();
