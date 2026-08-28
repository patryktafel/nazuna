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
  return 'node_modules/electron/dist';
}

module.exports = {
  appId: 'com.tafel.nazuna',
  /* Wydania (instalator + latest.yml) laduja na publicznym repo
     nazuna-updates - tylko stamtad electron-updater w main/updater.js
     sprawdza nowe wersje. Kod zrodlowy zostaje osobno, w prywatnym repo
     nazuna. "private: false" mowi electron-updaterowi, zeby przy
     sprawdzaniu i pobieraniu aktualizacji nie szukal tokenu GitHub -
     repo jest publiczne, wiec nie jest potrzebny. Samo budowanie
     (npm run dist) nigdy nie publikuje samo z siebie - publikuje tylko
     "npm run dist:publish" (czyli wydaj.bat), i to od razu jako gotowe
     wydanie: domyslnie electron-builder tworzylby szkic (releaseType
     "draft"), ktorego autoUpdater by nie widzial, wiec wymuszamy
     "release". */
  publish: {
    provider: 'github',
    owner: 'patryktafel',
    repo: 'nazuna-updates',
    private: false,
    releaseType: 'release'
  },
  productName: 'Nazuna',
  asar: true,
  /* Sprawdzone pomiarem, zeby nikt nie probowal tego ponownie: przy tej
     zawartosci 'normal' i 'maximum' daja plik tej samej wielkosci (okolo
     92 MB), wiec i rozpakowuja sie tak samo dlugo. 'store' rozpakowuje sie
     natychmiast, ale plik rosnie do 376 MB, co jest nie do przyjecia.
     Wniosek: wersji jednoplikowej nie da sie przyspieszyc tym pokretlem.
     Kto chce szybkiego startu, uzywa wersji z rozpakowanego folderu. */
  compression: 'maximum',
  electronDist: electronDist(),
  electronVersion: '43.2.0',
  afterPack: 'tools/after-pack.js',
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
     buduje sie osobno, komenda "npm run dist:portable", tylko na zadanie. */
  nsis: {
    oneClick: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    installerHeader: 'build/installerHeader.bmp',
    installerSidebar: 'build/installerSidebar.bmp',
    uninstallerSidebar: 'build/uninstallerSidebar.bmp',
    include: 'build/installer.nsh',
    artifactName: 'Nazuna-${version}-Instalator.${ext}'
  },
  /* Na Macu nie ma czegos takiego jak jeden plik uruchamialny. Odpowiednikiem
     jest paczka Nazuna.app, ktora pakujemy sami, zeby zachowac dowiazania
     symboliczne w srodku. Aplikacji nie podpisujemy, bo podpis Apple jest
     platny, wiec przy pierwszym uruchomieniu system poprosi o potwierdzenie. */
  mac: {
    target: [{ target: 'dir', arch: ['arm64'] }],
    icon: 'build/icon.png',
    category: 'public.app-category.productivity',
    darkModeSupport: true,
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false,
    extendInfo: {
      NSHumanReadableCopyright: '',
      LSMinimumSystemVersion: '11.0'
    }
  },
  /* Ubuntu i pochodne. Paczka .deb instaluje sie dwuklikiem i sama dodaje
     ikone do menu programow. Nie robimy AppImage, bo na nowszych Ubuntu wymaga
     doinstalowania biblioteki libfuse2 i bez niej nie dzieje sie nic, co jest
     najgorszym mozliwym bledem dla kogos, kto tylko chce potestowac. */
  linux: {
    target: [{ target: 'deb', arch: ['x64'] }],
    icon: 'build/icon.png',
    category: 'Network;WebBrowser',
    synopsis: 'Przenośna przeglądarka oparta na Chromium',
    description: 'Nazuna to lekka przeglądarka na silniku Chromium, z wbudowanym blokerem reklam i ciemnym motywem.',
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
