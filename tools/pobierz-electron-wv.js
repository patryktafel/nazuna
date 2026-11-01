'use strict';
/* Pobiera wersję Electrona od castLabs (tę z obsługą Widevine) i rozpakowuje
   ją do folderu electron-wv. Uruchamiane raz; przy kolejnych budowaniach
   skrypt widzi gotowy folder i kończy od razu. */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { pipeline } = require('stream');

const WERSJA = '43.8.3';

/* Oczekiwane SHA-256 paczek dla WERSJA (z SHASUMS256.txt wydania castLabs,
   sprawdzone na pobranym pliku). Silnik wchodzi do podpisanego instalatora i
   przez aktualizacje trafia do wszystkich, wiec nie ufamy temu, co akurat
   lezy w wydaniu na GitHubie. Przy zmianie WERSJA trzeba tu wpisac nowe sumy:
   bez nich skrypt przerwie, a w komunikacie poda sume pobranego pliku. */
const SUMY = {
  '43.8.3': {
    'win32-x64': '87fb77020834178ab6c6cbb8362b761eb287a21bacd669c5ad0eaa3078cff9e2',
    'darwin-arm64': '814b71cd20982363415c98bcb674ebe7dd38056b78178431777eb60e1c37d114',
    'linux-x64': '7b18a7753da4b5777eb3d32a59e305c239a21caf6aee9332e94970286034172b'
  }
};

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
      /* pipeline zglasza tez blad strumienia odpowiedzi: przy samym res.pipe
         urwane polaczenie moglo zostawic niepelny plik albo nigdy sie nie
         skonczyc. */
      pipeline(res, out, (err) => (err ? reject(err) : resolve()));
    }).on('error', reject);
  });
}

function sumaPliku(plik) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    pipeline(fs.createReadStream(plik), hash, (err) => (err ? reject(err) : resolve(hash.digest('hex'))));
  });
}

(async () => {
  if (fs.existsSync(path.join(cel, ZNACZNIK))) {
    /* Plik "version" w paczce castLabs ma postac "43.8.3+wvcus". Inna wersja
       w folderze = zostal po starszym WERSJA, wiec pobieramy od nowa. */
    let jest = '';
    try { jest = fs.readFileSync(path.join(cel, 'version'), 'utf8').trim(); } catch (_) {}
    if (jest === `${WERSJA}+wvcus`) {
      console.log('Silnik z obsługą DRM już jest, pomijam pobieranie.');
      return;
    }
    console.log(`W folderze jest silnik ${jest || 'nieznanej wersji'}, wymieniam na ${WERSJA}.`);
    fs.rmSync(cel, { recursive: true, force: true });
  }
  console.log('Pobieram silnik z obsługą DRM (około 140 MB, tylko za pierwszym razem)...');
  try {
    await pobierz(URL, zip);
  } catch (err) {
    console.error(`\nNie udało się pobrać silnika: ${err.message}`);
    try { fs.unlinkSync(zip); } catch (_) {}
    /* W CI (GitHub Actions ustawia CI=true) budowanie publikuje wydanie dla
       wszystkich. Cichy powrot do starszego Electrona z node_modules rozeslalby
       silnik ze znanymi dziurami, wiec przerywamy z kodem bledu. */
    if (process.env.CI) {
      console.error('Przerywam budowanie: wydanie bez właściwego silnika byłoby na starszym Electronie.\n');
      process.exitCode = 1;
      return;
    }
    console.error('Nazuna zbuduje się mimo to, ale na starszym silniku z node_modules (tylko do testów, nie do wydania).\n');
    return;
  }
  /* Niezgodna suma przerywa zawsze, nie tylko w CI: zla paczka nie moze zostac
     rozpakowana, a kod bledu zatrzymuje dalsze kroki "npm run dist*". */
  const oczekiwana = (SUMY[WERSJA] || {})[WARIANT];
  const suma = await sumaPliku(zip);
  if (suma !== oczekiwana) {
    console.error(`\nSuma SHA-256 silnika się nie zgadza (${WERSJA}, ${WARIANT}).`);
    console.error(`  oczekiwana: ${oczekiwana || 'brak wpisu w SUMY'}`);
    console.error(`  pobrany plik: ${suma}`);
    console.error('Przerywam. Przy nowej wersji silnika wpisz sumę z SHASUMS256.txt wydania castLabs do SUMY w tools/pobierz-electron-wv.js.\n');
    try { fs.unlinkSync(zip); } catch (_) {}
    process.exitCode = 1;
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
