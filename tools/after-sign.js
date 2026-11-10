'use strict';
/* Podpis VMP od castLabs (EVS) - potrzebny serwisom z DRM (Netflix, Disney+...),
   zeby uznaly Nazune za zaufana przegladarke. Darmowy, konto zalozyl
   uzytkownik 2026-11-10 (nazwa konta: patryktafel).

   KOLEJNOSC: na Windows podpis VMP musi powstac PO zwyklym podpisie programu
   (Authenticode / signtool), inaczej "things will break" (dokumentacja castLabs).
   Dlatego hook afterSign, a nie afterPack: electron-builder wola go zaraz po
   podpisaniu Nazuna.exe, a przed zlozeniem instalatora.

   Logowanie:
   - na GitHubie (Actions): sekrety EVS_ACCOUNT_NAME i EVS_PASSWD w repo nazuna
     (release.yml przekazuje je jako zmienne srodowiskowe) - odswiezamy nimi token;
   - lokalnie: token zapamietany przez `python -m castlabs_evs.account signup`.
   Brak modulu, konta albo sieci NIE przerywa budowania - instalator powstaje
   bez nowego podpisu VMP (wtedy jak dawniej), a w logu jest ostrzezenie. */
const { execFileSync } = require('child_process');

function python(args) {
  for (const exe of ['python3', 'python', 'py']) {
    try {
      return execFileSync(exe, exe === 'py' ? ['-3', ...args] : args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
  }
  throw new Error('nie znaleziono Pythona');
}

/* Podpis VMP folderu z gotowym programem, wolany z afterSign na Windows.
   macOS zachowuje izolacje file:// i nie korzysta z darmowego EVS. */
function podpiszVmp(dir) {
  if (process.env.NAZUNA_BEZ_VMP) { console.log('  • podpis VMP pominiety (NAZUNA_BEZ_VMP)'); return; }
  try {
    if (process.env.EVS_ACCOUNT_NAME && process.env.EVS_PASSWD) {
      python(['-m', 'castlabs_evs.account', '--no-ask', 'refresh']);
    }
    const wynik = python(['-m', 'castlabs_evs.vmp', '--no-ask', 'sign-pkg', dir]);
    console.log('  • podpis VMP castLabs:', wynik.trim().split('\n').join(' | '));
    const spr = python(['-m', 'castlabs_evs.vmp', '--no-ask', 'verify-pkg', dir]);
    console.log('  • weryfikacja VMP:', spr.trim().split('\n').join(' | '));
  } catch (err) {
    const opis = String((err.stderr || '') + (err.stdout || '') || err.message).trim().split('\n').slice(-3).join(' | ');
    console.warn('  • UWAGA: podpis VMP castLabs NIE powstal:', opis);
  }
}

exports.podpiszVmp = podpiszVmp;

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'win32') return;
  podpiszVmp(context.appOutDir);
};
