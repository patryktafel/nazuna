'use strict';
const fs = require('fs');
const path = require('path');

/* Nazuna buduje się na wersji Electrona od castLabs, która zawiera obsługę
   Widevine. Tej wersji nie ma w npm, więc leży rozpakowana w folderze
   electron-wv (pobiera ją tools/pobierz-electron-wv.js).
   Gdyby jej zabrakło, budujemy na zwykłym Electronie z node_modules, tylko
   bez odtwarzania serwisów z DRM. */
const NA_MACA = process.argv.includes('--mac');
const NA_LINUKSA = process.argv.includes('--linux');

function electronDist() {
  if (NA_MACA) {
    const mac = path.join(__dirname, 'electron-wv-mac');
    if (fs.existsSync(path.join(mac, 'Electron.app'))) return 'electron-wv-mac';
    return 'node_modules/electron/dist';
  }
  if (NA_LINUKSA) {
    const lin = path.join(__dirname, 'electron-wv-linux');
    if (fs.existsSync(path.join(lin, 'electron'))) return 'electron-wv-linux';
    return 'node_modules/electron/dist';
  }
  const local = path.join(__dirname, 'electron-wv');
  if (fs.existsSync(path.join(local, 'electron.exe'))) return 'electron-wv';
  /* Przy publikowaniu (npm run dist:publish, CI) nie wolno po cichu
     brac starszego Electrona z node_modules - auto-update rozeslalby go
     wszystkim. Lokalny build testowy dalej moze. */
  const iPub = process.argv.indexOf('--publish');
  const publikuje = iPub !== -1 && process.argv[iPub + 1] !== 'never';
  if (publikuje || process.env.CI) {
    throw new Error('Brak silnika castLabs w folderze electron-wv (npm run pobierz-silnik). Nie publikuję wydania na starszym Electronie z node_modules.');
  }
  return 'node_modules/electron/dist';
}

/* Wersja brana z tego, na czym naprawde budujemy (plik "version" w folderze
   silnika, np. "43.8.3+wvcus"), zeby nie trzeba jej bylo zmieniac w dwoch
   miejscach. */
function electronVersion() {
  try {
    return fs.readFileSync(path.join(__dirname, electronDist(), 'version'), 'utf8').trim().replace(/\+.*$/, '');
  } catch (_) {
    return require('electron/package.json').version;
  }
}

module.exports = {
  appId: 'com.tafel.nazuna',
  /* Wydania (instalator + latest.yml) laduja na publicznym repo
     nazuna-updates - tylko stamtad electron-updater w main/updater.js
     sprawdza nowe wersje. Kod zrodlowy zostaje osobno, w repo
     nazuna. "private: false" mowi electron-updaterowi, zeby przy
     sprawdzaniu i pobieraniu aktualizacji nie szukal tokenu GitHub -
     repo jest publiczne, wiec nie jest potrzebny. Samo budowanie
     (npm run dist) nigdy nie publikuje samo z siebie - publikuje tylko
     "npm run dist:publish" (GitHub Actions), i to od razu jako gotowe
     wydanie: domyslnie electron-builder tworzylby szkic (releaseType
     "draft"), ktorego autoUpdater by nie widzial, wiec wymuszamy
     "release". */
  /* Opis wydania na GitHubie - bez tego electron-builder sam z siebie nic
     sensownego nie wpisuje, wiec kazda wersja miala ten sam, przypadkowy
     tekst. Plik jest generowany tuz przed builda (patrz tools/generuj-notatki-wydania.js
     w skryptach npm run dist*) na podstawie biezacego wpisu w CHANGELOG.txt. */
  releaseInfo: {
    releaseNotesFile: 'build/release-notes.md'
  },
  publish: {
    provider: 'github',
    owner: 'patryktafel',
    repo: 'nazuna-updates',
    private: false,
    releaseType: 'release'
  },
  productName: 'Nazuna',
  asar: true,
  /* Electron Fuses - przelaczniki wypalane na stale w spakowanej wersji
     (dzialaja inaczej niz zwykle ustawienia w kodzie, ktore ktos mogliby
     obejsc podmieniajac pliki po instalacji). Kazdy dotyka innej,
     konkretnej dziury:

     runAsNode: false - bez tego samo Nazuna.exe, odpalone ze zmienna
       srodowiskowa ELECTRON_RUN_AS_NODE=1, zamienia sie w zwykly interpreter
       Node.js z pelnym dostepem do systemu - znana sztuczka do przemycania
       zlosliwego kodu pod plaszczykiem zaufanej, podpisanej aplikacji.
       Nazuna tej zdolnosci nigdy nie potrzebuje.
     enableNodeOptionsEnvironmentVariable / enableNodeCliInspectArguments:
       false - to samo w duchu co powyzej, tylko przez zmienna NODE_OPTIONS
       albo flagi --inspect/--inspect-brk (zdalny debugger z pelnym dostepem
       do JS aplikacji). Bez zadnego legalnego zastosowania w gotowej wersji.
     enableEmbeddedAsarIntegrityValidation + onlyLoadAppFromAsar: true -
       Electron sprawdza przy starcie, czy paczka z kodem (app.asar) nie
       zostala podmieniona/zmodyfikowana na dysku po instalacji, i odmawia
       wczytania kodu spoza niej. Bez tego ktokolwiek z dostepem do plikow
       mogby po cichu podmienic kod Nazuny na wlasny, a program dalej
       wygladalby i uruchamial sie identycznie.
     grantFileProtocolExtraPrivileges: false - strony otwierane z dysku
       (file://) dostaja teraz dokladnie tyle uprawnien co w zwyklej
       przegladarce, a nie wiecej. W 0.1.62 to psulo wlasny pasek Nazuny,
       bo on jako jedyny element calej aplikacji laduje sie sam przez
       file:// (shell.html) - od 0.1.64 pasek tez chodzi przez wlasny
       protokol (nazuna://ui/shell.html), tak jak reszta wewnetrznych stron,
       wiec ta blokada juz nic mu nie zabiera.
     enableCookieEncryption: true - ciasteczka na dysku sa teraz szyfrowane
       kluczem systemowym (Windows DPAPI), a nie trzymane plaskim tekstem -
       ktos z samym dostepem do plikow (bez uprawnien tego konta Windows)
       nie odczyta z nich sesji logowania. */
  /* Wartosci w tools/fuses.js. grantFileProtocolExtraPrivileges: true od 0.1.104,
     bo podpis VMP castLabs (Netflix, HBO Max, Disney+...) przyjmuje tylko zestaw
     fuses z FAQ castLabs. Dotyczy tylko plikow HTML otwieranych z dysku
     (file://); pasek i strony Nazuny ida przez nazuna://.
     macOS: fuses ustawia tools/after-pack.js, bo tam musza powstac przed
     podpisem VMP, a electron-builder ustawia je dopiero po afterPack. */
  electronFuses: NA_MACA ? undefined : require('./tools/fuses'),
  /* Sprawdzone pomiarem, zeby nikt nie probowal tego ponownie: przy tej
     zawartosci 'normal' i 'maximum' daja plik tej samej wielkosci (okolo
     92 MB), wiec i rozpakowuja sie tak samo dlugo. 'store' rozpakowuje sie
     natychmiast, ale plik rosnie do 376 MB, co jest nie do przyjecia.
     Wniosek: wersji jednoplikowej nie da sie przyspieszyc tym pokretlem.
     Kto chce szybkiego startu, uzywa wersji z rozpakowanego folderu. */
  compression: 'maximum',
  electronDist: electronDist(),
  electronVersion: electronVersion(),
  afterPack: 'tools/after-pack.js',
  // Podpis VMP castLabs (Netflix i inne DRM) - PO podpisie Authenticode, patrz tools/after-sign.js.
  afterSign: 'tools/after-sign.js',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['src/**/*', 'package.json', '!**/*.map'],
  extraResources: [{ from: 'resources', to: '.' }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    requestedExecutionLevel: 'asInvoker',
    artifactName: 'Nazuna-${version}-Instalator.${ext}'
  },
  /* Instalator zamiast jednego pliku .exe: pyta o folder docelowy i o to,
     czy zrobic skroty (wlasna strona kreatora, patrz build/installer.nsh),
     a wyglad naglowka i panelu bocznego jest utrzymany w ciemnym,
     fioletowym motywie Nazuny (build/installerHeader.bmp, installerSidebar.bmp -
     wygenerowane z tego samego logo co ikona aplikacji). Wersje portable
     buduje sie osobno, komenda "npm run dist:portable", tylko na zadanie.
     "differentialPackage: false" wylacza generowanie osobnego pliku .blockmap
     (uzywanego tylko do pobierania samej roznicy miedzy wersjami) - bez niego
     electron-updater po prostu pobiera caly nowy instalator, co dla Nazuny
     nie robi wiekszej roznicy, a przy okazji omija bledy electron-buildera,
     ktory przy publikowaniu na GitHuba probowal wyslac .exe i .blockmap
     naraz i gubil sie, tworzac dwa wydania zamiast jednego. */
  nsis: {
    oneClick: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    differentialPackage: false,
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    installerHeader: 'build/installerHeader.bmp',
    installerSidebar: 'build/installerSidebar.bmp',
    uninstallerSidebar: 'build/uninstallerSidebar.bmp',
    include: 'build/installer.nsh',
    artifactName: 'Nazuna-${version}-Instalator.${ext}'
  },
  /* macOS (Mac z procesorem Apple). Bez platnego certyfikatu Apple: identity null
     wylacza podpis electron-buildera, a tools/after-pack.js sklada wszystko w
     wymaganej kolejnosci: fuses, podpis VMP castLabs, podpis lokalny (ad-hoc,
     codesign -s -). Bez zadnego podpisu macOS na procesorach Apple w ogole nie
     uruchamia programu. Pierwsze uruchomienie wymaga potwierdzenia w
     Ustawieniach systemowych > Prywatnosc i ochrona > "Otworz mimo to".
     .dmg do instalacji przeciagnieciem, .zip pod przyszle aktualizacje.
     Electron 44 wymaga macOS 12 lub nowszego. */
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }],
    icon: 'build/icon.png',
    category: 'public.app-category.productivity',
    darkModeSupport: true,
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false,
    artifactName: 'Nazuna-${version}-Mac.${ext}',
    /* Rejestracja w systemie jako przegladarka (adresy http/https) i program do
       otwierania stron .html i plikow PDF - bez tego macOS nie pozwala wybrac
       Nazuny jako domyslnej przegladarki. */
    protocols: [{ name: 'Web', schemes: ['http', 'https'] }],
    fileAssociations: [{ ext: ['html', 'htm', 'xhtml'], role: 'Viewer' }, { ext: 'pdf', role: 'Viewer' }],
    extendInfo: {
      NSHumanReadableCopyright: '',
      LSMinimumSystemVersion: '12.0',
      /* Bez tych opisow macOS zamyka program, gdy strona poprosi o kamere albo
         mikrofon (np. wideorozmowa). */
      NSCameraUsageDescription: 'Strona internetowa prosi o dostęp do kamery.',
      NSMicrophoneUsageDescription: 'Strona internetowa prosi o dostęp do mikrofonu.',
      NSBluetoothAlwaysUsageDescription: 'Strona internetowa prosi o dostęp do urządzenia Bluetooth.'
    }
  },
  dmg: {
    artifactName: 'Nazuna-${version}-Mac.${ext}'
  },
  /* Ubuntu i pochodne. Paczka .deb instaluje sie dwuklikiem i sama dodaje
     ikone do menu programow. Nie robimy AppImage, bo na nowszych Ubuntu wymaga
     doinstalowania biblioteki libfuse2 i bez niej nie dzieje sie nic, co jest
     najgorszym mozliwym bledem dla kogos, kto tylko chce potestowac. */
  linux: {
    target: [{ target: 'deb', arch: ['x64'] }],
    icon: 'build/icon.png',
    category: 'Network;WebBrowser',
    synopsis: 'Przeglądarka na silniku Chromium, stawiająca na prywatność',
    description: 'Nazuna to lekka przeglądarka na silniku Chromium, stawiająca na prywatność - wbudowany bloker reklam i skryptów śledzących, bez telemetrii, z ciemnym motywem.',
    desktop: { entry: { MimeType: 'text/html;x-scheme-handler/http;x-scheme-handler/https' } },
    artifactName: 'nazuna_${version}_${arch}.${ext}'
  },
  deb: {
    // Format .deb wymaga opiekuna paczki. Nie ma tu zadnego adresu, ktory
    // cokolwiek by znaczyl, wiec wpisujemy nazwe projektu.
    maintainer: 'Nazuna <nazuna@localhost>',
    // Zaleznosci, ktorych Chromium wymaga, a ktorych goly Ubuntu serwerowy
    // moze nie miec. Na zwyklym pulpicie sa juz zainstalowane.
    depends: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libdrm2', 'libgbm1', 'libxcb-dri3-0']
  },

  portable: {
    artifactName: 'Nazuna.exe',
    requestExecutionLevel: 'user',
    unpackDirName: 'Nazuna-${version}'
  }
};
