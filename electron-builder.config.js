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
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
    enableCookieEncryption: true
  },
  /* Sprawdzone pomiarem, zeby nikt nie probowal tego ponownie: przy tej
     zawartosci 'normal' i 'maximum' daja plik tej samej wielkosci (okolo
     92 MB), wiec i rozpakowuja sie tak samo dlugo. 'store' rozpakowuje sie
     natychmiast, ale plik rosnie do 376 MB, co jest nie do przyjecia.
     Wniosek: wersji jednoplikowej nie da sie przyspieszyc tym pokretlem.
     Kto chce szybkiego startu, uzywa wersji z rozpakowanego folderu. */
  compression: 'maximum',
  electronDist: electronDist(),
  electronVersion: '43.5.0',
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
