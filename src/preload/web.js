'use strict';
const { contextBridge, ipcRenderer, webFrame } = require('electron');

/* Mostek do procesu głównego dostają wyłącznie wewnętrzne strony nazuna://
   i tylko wtedy, gdy są ramką najwyższego poziomu. Strona internetowa nie
   może więc osadzić ustawień w ukrytej ramce i sięgnąć przez nie głębiej. */
let internal = false;
try {
  const isNazuna = String(location.protocol).toLowerCase() === 'nazuna:';
  const isTopFrame = window === window.top;
  internal = isNazuna && isTopFrame;
} catch (_) {
  internal = false;
}

if (internal) {
  contextBridge.exposeInMainWorld('nazuna', {
    invoke: (method, payload) => ipcRenderer.invoke('nazuna:invoke', method, payload),
    send: (method, payload) => ipcRenderer.send('nazuna:send', method, payload),
    on: (channel, callback) => {
      const wrapped = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    },
    platform: process.platform,
    internal: true
  });
}

/* ------------------------------------------------------------------ tozsamosc
   Nazuna jest przegladarka zbudowana na Chromium i tak sie przedstawia. Problem
   w tym, ze Electron wycina czesc standardowego wyposazenia Chromium, przez co
   strona badajaca przegladarke widziala trzy sprzeczne odpowiedzi: naglowek
   mowil "Chrome", JavaScript mowil "Chromium", a window.chrome bylo puste, co
   jest typowe dla okienka wklejonego w srodek innej aplikacji. Ponizej
   doprowadzamy te trzy miejsca do zgodnosci.

   Uwaga na granice: uzupelniamy WLASNA przegladarke o brakujace, standardowe
   elementy Chromium. Nie ruszamy niczyich stron i nie ukrywamy tego, ze te
   uzupelnienia pochodza od nas. */
let bezKluczy = false;
try { bezKluczy = process.argv.indexOf('--nazuna-bez-kluczy') !== -1; } catch (_) {}

// Ziarno do domykania odcisku przegladarki - patrz fpSeed w window.js. Puste,
// gdy uzytkownik wylaczyl ochrone w Ustawieniach (fingerprintProtection).
let fpSeed = '';
try {
  const arg = process.argv.find((a) => a.indexOf('--nazuna-fp-seed=') === 0);
  if (arg) fpSeed = arg.slice('--nazuna-fp-seed='.length);
} catch (_) {}

if (!internal) {
  const FULL = String(process.versions.chrome || '120.0.0.0');
  const MAJOR = FULL.split('.')[0] || '120';
  const script = `(() => {
  const BEZ_KLUCZY = ${JSON.stringify(bezKluczy)};
  const FP_SEED = ${JSON.stringify(fpSeed)};
  const CHROME = 'Google Chrome';
  const MAJOR = '${MAJOR}';
  const FULL = '${FULL}';

  /* --- 1. userAgentData ---------------------------------------------------
     Chromium wpisuje tu siebie, ale nie Chrome. Dopisujemy brakujaca marke
     w obu miejscach, w ktorych strona moze o nia zapytac: w skroconej liscie
     i w tej szczegolowej. Do 0.1.5 poprawialismy tylko jedno z nich, wiec
     wystarczylo zapytac o drugie, zeby zobaczyc niespojnosc. */
  try {
    const real = navigator.userAgentData;
    if (real && Array.isArray(real.brands)) {
      const add = (list, version) => {
        const copy = list.map((b) => ({ brand: b.brand, version: b.version }));
        if (!copy.some((b) => b.brand === CHROME)) copy.push({ brand: CHROME, version });
        return copy;
      };
      const brands = add(real.brands, MAJOR);
      const patched = {
        get brands() { return brands.map((b) => ({ brand: b.brand, version: b.version })); },
        get mobile() { return real.mobile; },
        get platform() { return real.platform; },
        toJSON() { return { brands: this.brands, mobile: real.mobile, platform: real.platform }; },
        getHighEntropyValues(hints) {
          return real.getHighEntropyValues(hints).then((v) => {
            if (Array.isArray(v.brands)) v.brands = add(v.brands, MAJOR);
            if (Array.isArray(v.fullVersionList)) v.fullVersionList = add(v.fullVersionList, FULL);
            return v;
          });
        }
      };
      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        configurable: true, enumerable: true, get() { return patched; }
      });
    }
  } catch (_) {}

  /* --- 2. window.chrome ---------------------------------------------------
     W prawdziwym Chromium ten obiekt ma trzy czlony: app, csi i loadTimes.
     Electron zostawia puste pudelko, co jest jednym z najstarszych i
     najprostszych sposobow odroznienia zwyklej przegladarki od okienka
     wklejonego w aplikacje. Odtwarzamy standardowy ksztalt, z prawdziwymi
     czasami z performance.

     Ksztalt sprawdzony pomiarem na Chrome 151 na Windows: dokladnie te trzy
     czlony, te same cztery pola w csi i te same trzynascie w loadTimes.
     W 0.1.7 dokladalismy tu jeszcze chrome.runtime, ale prawdziwy Chrome go
     na zwyklej stronie nie ma, wiec bylismy lepiej wyposazeni niz oryginal.
     To tez jest niespojnosc, tylko w druga strone. */
  try {
    if (!window.chrome || Object.keys(window.chrome).length === 0) {
      const sec = (ms) => (typeof ms === 'number' && ms > 0 ? ms / 1000 : 0);
      const nav = () => { try { return performance.getEntriesByType('navigation')[0] || null; } catch (_) { return null; } };
      const origin = () => { try { return performance.timeOrigin || Date.now(); } catch (_) { return Date.now(); } };
      const paint = () => {
        try {
          const e = performance.getEntriesByType('paint').find((x) => x.name === 'first-paint');
          return e ? sec(origin() + e.startTime) : 0;
        } catch (_) { return 0; }
      };

      const chrome = {};

      chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails() { return null; },
        getIsInstalled() { return false; },
        installState(callback) { if (typeof callback === 'function') setTimeout(() => callback('not_installed'), 0); },
        runningState() { return 'cannot_run'; }
      };

      chrome.csi = function csi() {
        const n = nav();
        const start = origin();
        return {
          startE: Math.round(start),
          onloadT: Math.round(start + (n ? n.domContentLoadedEventEnd : 0)),
          pageT: n ? n.domContentLoadedEventEnd : 0,
          tran: 15
        };
      };

      chrome.loadTimes = function loadTimes() {
        const n = nav();
        const start = origin();
        const at = (v) => sec(start + (typeof v === 'number' ? v : 0));
        return {
          requestTime: sec(start),
          startLoadTime: sec(start),
          commitLoadTime: n ? at(n.responseStart) : sec(start),
          finishDocumentLoadTime: n ? at(n.domContentLoadedEventEnd) : 0,
          finishLoadTime: n ? at(n.loadEventEnd) : 0,
          firstPaintTime: paint(),
          firstPaintAfterLoadTime: 0,
          navigationType: n && n.type === 'reload' ? 'Reload' : 'Other',
          wasFetchedViaSpdy: !!(n && /h2|h3/.test(String(n.nextHopProtocol || ''))),
          wasNpnNegotiated: !!(n && n.nextHopProtocol),
          npnNegotiatedProtocol: n ? String(n.nextHopProtocol || '') : '',
          wasAlternateProtocolAvailable: false,
          connectionInfo: n ? String(n.nextHopProtocol || 'unknown') : 'unknown'
        };
      };

      Object.defineProperty(window, 'chrome', { value: chrome, configurable: true, enumerable: false, writable: true });
    }
  } catch (_) {}

  /* --- 3. klucze dostepu (passkeys) ---------------------------------------
     Strona pyta przegladarke, czy da sie zalogowac kluczem. Chrome, widzac ze
     na urzadzeniu nic nie ma, odpowiada "nie" i strona od razu pokazuje pole
     na haslo. Nazuna nie odpowiadala nic, wiec pytanie szlo dalej do systemu
     i Windows otwieral swoje okno "Zabezpieczenia Windows", nawet komus, kto
     zadnego klucza nie skonfigurowal. Tu odpowiadamy za siebie.

     Wylaczamy tylko klucze. Zapisane hasla i logowanie przez konto Google czy
     Facebooka ida ta sama funkcja i musza dzialac dalej, wiec przepuszczamy
     wszystko, co nie jest pytaniem o klucz. */
  if (BEZ_KLUCZY) try {
    if (window.PublicKeyCredential) {
      const nie = () => Promise.resolve(false);
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = nie;
      PublicKeyCredential.isConditionalMediationAvailable = nie;
      if (PublicKeyCredential.getClientCapabilities) {
        PublicKeyCredential.getClientCapabilities = () => Promise.resolve({
          conditionalCreate: false, conditionalGet: false, hybridTransport: false,
          passkeyPlatformAuthenticator: false, userVerifyingPlatformAuthenticator: false,
          relatedOrigins: false, signalAllAcceptedCredentials: false,
          signalCurrentUserDetails: false, signalUnknownCredential: false
        });
      }
    }
    if (window.CredentialsContainer && navigator.credentials) {
      const proto = CredentialsContainer.prototype;
      const oGet = proto.get;
      const oCreate = proto.create;
      // Tak samo jak po kliknieciu "Anuluj" w oknie systemu: strona wraca do hasla.
      const anulowane = () => Promise.reject(new DOMException(
        'The operation either timed out or was not allowed.', 'NotAllowedError'));
      // Przy trybie warunkowym prawdziwa przegladarka bez kluczy po prostu
      // milczy, wiec i my milczymy. Odrzucenie zapalaloby stronie blad.
      const milczenie = () => new Promise(() => {});
      Object.defineProperty(proto, 'get', {
        configurable: true, writable: true,
        value: function get(options) {
          if (options && options.publicKey) {
            if (options.mediation === 'conditional') {
              // Polaczona prosba - autouzupelnianie hasel razem z passkeyami
              // na tym samym polu - nie moze zostac calkiem uciszona, bo
              // wtedy gaslo tez autouzupelnianie zwyklych zapisanych hasel,
              // ktore nie ma nic wspolnego z WebAuthn.
              if (options.password) return oGet.call(this, options);
              return milczenie();
            }
            return anulowane();
          }
          return oGet.call(this, options);
        }
      });
      Object.defineProperty(proto, 'create', {
        configurable: true, writable: true,
        value: function create(options) {
          if (options && options.publicKey) return anulowane();
          return oCreate.call(this, options);
        }
      });
    }
  } catch (_) {}

  /* --- 4. domykanie odcisku przegladarki (fingerprinting) -----------------
     Trzy klasyczne zrodla, po ktorych skrypty sledzace rozpoznaja jedno
     konkretne urzadzenie miedzy stronami: to, co narysuje canvas, to, co
     zwroci karta graficzna przez WebGL, i to, jak dokladnie zabrzmi cichy
     dzwiek wygenerowany przez Web Audio. Kazdy z tych trzech odczytow lekko
     przesuwamy - za malo, zeby cokolwiek bylo widac czy slychac, wystarczajaco,
     zeby wynik nie byl juz Twoim prawdziwym, unikalnym odciskiem sprzetu.

     FP_SEED miesza sie z domena aktualnej strony (nie samym FP_SEED), wiec
     kazda strona dostaje INNY falszywy odcisk (nie da sie po nim polaczyc
     wizyty na dwoch roznych stronach w jedna osobe), ale ZAWSZE TEN SAM przy
     kolejnych wizytach na TEJ SAMEJ stronie i przeladowaniach (zwykle strony
     dalej dzialaja normalnie, nic im nie "miga" ani nie znika). Nowe FP_SEED
     przy kazdym uruchomieniu Nazuny znaczy, ze nawet ten falszywy odcisk
     zmienia sie miedzy sesjami przegladania. */
  if (FP_SEED) try {
    function fnv1a(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      return h >>> 0;
    }
    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    let host = '';
    try { host = location.hostname || ''; } catch (_) {}
    const originSeed = fnv1a(FP_SEED + '|' + host);

    // --- canvas ---
    try {
      const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
      function noisifyPixels(bytes) {
        const rnd = mulberry32(originSeed);
        for (let i = 0; i < bytes.length; i += 4) {
          if (rnd() < 0.03) {
            const d1 = rnd() < 0.5 ? -1 : 1, d2 = rnd() < 0.5 ? -1 : 1, d3 = rnd() < 0.5 ? -1 : 1;
            bytes[i] = clamp(bytes[i] + d1);
            bytes[i + 1] = clamp(bytes[i + 1] + d2);
            bytes[i + 2] = clamp(bytes[i + 2] + d3);
          }
        }
      }
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      function noisyClone(canvas) {
        try {
          const clone = document.createElement('canvas');
          clone.width = canvas.width;
          clone.height = canvas.height;
          const cctx = clone.getContext('2d');
          cctx.drawImage(canvas, 0, 0);
          const id = origGetImageData.call(cctx, 0, 0, clone.width || 1, clone.height || 1);
          noisifyPixels(id.data);
          cctx.putImageData(id, 0, 0);
          return clone;
        } catch (_) { return canvas; }
      }
      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        return origToDataURL.apply(noisyClone(this), args);
      };
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        return origToBlob.apply(noisyClone(this), [callback, ...args]);
      };
      CanvasRenderingContext2D.prototype.getImageData = function (...args) {
        const id = origGetImageData.apply(this, args);
        try { noisifyPixels(id.data); } catch (_) {}
        return id;
      };
    } catch (_) {}

    // --- WebGL: karta graficzna to jeden z najbardziej "gadatliwych" o Twoim
    // sprzecie odczytow - dokladny model i sterownik. Podmieniamy na ten sam,
    // szeroko rozpowszechniony, generyczny opis co przegladarki bez wlasnej
    // karty graficznej (np. wirtualki), zamiast prawdziwego modelu Twojego GPU. ---
    try {
      const FAKE_VENDOR = 'Google Inc. (Google)';
      const FAKE_RENDERER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
      function patchGl(proto) {
        if (!proto || !proto.getParameter) return;
        const orig = proto.getParameter;
        proto.getParameter = function (param) {
          if (param === 0x9245) return FAKE_VENDOR;
          if (param === 0x9246) return FAKE_RENDERER;
          return orig.call(this, param);
        };
      }
      if (window.WebGLRenderingContext) patchGl(WebGLRenderingContext.prototype);
      if (window.WebGL2RenderingContext) patchGl(WebGL2RenderingContext.prototype);
    } catch (_) {}

    // --- Web Audio: klasyczna sztuczka renderuje cichy dzwiek w tle i liczy
    // sume probek - na kazdym sprzecie/sterowniku wychodzi troszke inna suma,
    // co daje kolejny odcisk urzadzenia. Zwracamy kopie bufora z drobnym,
    // niesluchalnym przesunieciem zamiast prawdziwej proby. ---
    try {
      if (window.AudioBuffer) {
        const origGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function (channel) {
          const data = origGetChannelData.call(this, channel);
          try {
            const rnd = mulberry32(originSeed ^ ((channel | 0) + 1));
            const copy = new Float32Array(data.length);
            for (let i = 0; i < data.length; i++) copy[i] = data[i] + (i % 97 === 0 ? (rnd() - 0.5) * 0.0001 : 0);
            return copy;
          } catch (_) { return data; }
        };
      }
    } catch (_) {}
  } catch (_) {}

  /* --- 5. obraz jako cala strona ------------------------------------------
     Nawigacja bezposrednio pod adres obrazka (kliknij, otworz w nowej karcie
     itp.) - Chromium sam go wyswietla wysrodkowanego, ale na BIALYM tle,
     nawet w ciemnym motywie Nazuny. Dokladamy tylko tlo pod spodem, reszte
     (dopasowanie do okna, powiekszanie klikinieciem) Chromium juz robi samo. */
  try {
    if (document.contentType && document.contentType.indexOf('image/') === 0) {
      const zastosujTlo = () => {
        try {
          const style = document.createElement('style');
          style.textContent = 'html,body{background:#14151b !important;margin:0;}';
          (document.head || document.documentElement).appendChild(style);
        } catch (_) {}
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zastosujTlo, { once: true });
      else zastosujTlo();
    }
  } catch (_) {}
})();`;
  try { webFrame.executeJavaScript(script).catch(() => {}); } catch (_) {}
}
