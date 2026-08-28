/* Pre-bakes the filter engine so the browser blocks ads on first launch, offline. */
const fs = require('fs');
const path = require('path');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

(async () => {
  const out = path.join(__dirname, '..', 'resources', 'adblock.bin');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out) && !process.env.FORCE_ADBLOCK) {
    console.log('adblock.bin juz istnieje, pomijam');
    return;
  }
  try {
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    fs.writeFileSync(out, Buffer.from(blocker.serialize()));
    console.log('adblock.bin zapisany,', (fs.statSync(out).size / 1024 / 1024).toFixed(2), 'MB');
  } catch (err) {
    console.warn('nie udalo sie pobrac list filtrow:', err.message);
    console.warn('przegladarka pobierze je przy pierwszym uruchomieniu');
  }
})();
