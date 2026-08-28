'use strict';
/* Prosty czytnik CRX2/CRX3: wyciaga paczke zip i odzyskuje klucz publiczny,
   zeby rozpakowane rozszerzenie mialo to samo ID co w sklepie Chrome. */
const crypto = require('crypto');

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result >>> 0, pos];
    shift += 7;
    if (shift > 35) break;
  }
  return [result >>> 0, pos];
}

/** Zbiera wszystkie pola naglowka CRX3: dowody podpisu i dane podpisane. */
function readHeader(header) {
  const proofs = [];
  let signedHeaderData = null;
  let pos = 0;
  while (pos < header.length) {
    const [key, p1] = readVarint(header, pos);
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 2) {
      const [len, p2] = readVarint(header, p1);
      const value = header.subarray(p2, p2 + len);
      if (field === 2 || field === 3) {
        const proof = { algorithm: field === 2 ? 'rsa' : 'ecdsa', publicKey: null, signature: null };
        let q = 0;
        while (q < value.length) {
          const [k2, q1] = readVarint(value, q);
          const f2 = k2 >>> 3;
          const w2 = k2 & 7;
          if (w2 === 2) {
            const [l2, q2] = readVarint(value, q1);
            if (f2 === 1) proof.publicKey = value.subarray(q2, q2 + l2);
            if (f2 === 2) proof.signature = value.subarray(q2, q2 + l2);
            q = q2 + l2;
          } else if (w2 === 0) { const [, q2] = readVarint(value, q1); q = q2; }
          else if (w2 === 5) q = q1 + 4;
          else if (w2 === 1) q = q1 + 8;
          else break;
        }
        if (proof.publicKey && proof.signature) proofs.push(proof);
      } else if (field === 10000) {
        signedHeaderData = value;
      }
      pos = p2 + len;
    } else if (wire === 0) { const [, p2] = readVarint(header, p1); pos = p2; }
    else if (wire === 5) pos = p1 + 4;
    else if (wire === 1) pos = p1 + 8;
    else break;
  }
  return { proofs, signedHeaderData };
}

/** Z SignedData wyciagamy crx_id, czyli 16 bajtow identyfikatora rozszerzenia. */
function crxIdFromSignedData(signedHeaderData) {
  if (!signedHeaderData) return null;
  let pos = 0;
  while (pos < signedHeaderData.length) {
    const [key, p1] = readVarint(signedHeaderData, pos);
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 2) {
      const [len, p2] = readVarint(signedHeaderData, p1);
      if (field === 1) return signedHeaderData.subarray(p2, p2 + len);
      pos = p2 + len;
    } else if (wire === 0) { const [, p2] = readVarint(signedHeaderData, p1); pos = p2; }
    else if (wire === 5) pos = p1 + 4;
    else if (wire === 1) pos = p1 + 8;
    else break;
  }
  return null;
}

function firstPublicKey(header) {
  let pos = 0;
  while (pos < header.length) {
    const [key, p1] = readVarint(header, pos);
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 2) {
      const [len, p2] = readVarint(header, p1);
      const value = header.subarray(p2, p2 + len);
      if (field === 2 || field === 3) {           // AsymmetricKeyProof
        let q = 0;
        while (q < value.length) {
          const [k2, q1] = readVarint(value, q);
          const f2 = k2 >>> 3;
          const w2 = k2 & 7;
          if (w2 === 2) {
            const [l2, q2] = readVarint(value, q1);
            if (f2 === 1) return value.subarray(q2, q2 + l2);
            q = q2 + l2;
          } else if (w2 === 0) { const [, q2] = readVarint(value, q1); q = q2; }
          else if (w2 === 5) q = q1 + 4;
          else if (w2 === 1) q = q1 + 8;
          else break;
        }
      }
      pos = p2 + len;
    } else if (wire === 0) { const [, p2] = readVarint(header, p1); pos = p2; }
    else if (wire === 5) pos = p1 + 4;
    else if (wire === 1) pos = p1 + 8;
    else break;
  }
  return null;
}

/** Chrome wyprowadza ID rozszerzenia z pierwszych 16 bajtow sha256(kluczPubliczny). */
function idFromPublicKey(publicKey) {
  const digest = crypto.createHash('sha256').update(publicKey).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (digest[i] >> 4));
    id += String.fromCharCode(97 + (digest[i] & 0x0f));
  }
  return id;
}

/* Podpis CRX3 obejmuje staly prefiks, dlugosc danych podpisanych, same dane
   i cale archiwum zip. Wystarczy jeden poprawny dowod RSA, ktorego klucz
   zgadza sie z identyfikatorem zapisanym w danych podpisanych. */
function verifyCrx3({ zip, proofs, signedHeaderData }) {
  if (!signedHeaderData || !proofs.length) return { ok: false, reason: 'plik nie zawiera podpisu' };
  const declaredId = crxIdFromSignedData(signedHeaderData);
  if (!declaredId || declaredId.length !== 16) return { ok: false, reason: 'brak identyfikatora w podpisie' };

  const prefix = Buffer.from('CRX3 SignedData\u0000', 'binary');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeaderData.length);
  const message = Buffer.concat([prefix, length, Buffer.from(signedHeaderData), Buffer.from(zip)]);

  let checked = 0;
  for (const proof of proofs) {
    if (proof.algorithm !== 'rsa') continue;
    const digest = crypto.createHash('sha256').update(proof.publicKey).digest().subarray(0, 16);
    if (!digest.equals(Buffer.from(declaredId))) continue;   // klucz nie od tego rozszerzenia
    checked++;
    try {
      const valid = crypto.createVerify('RSA-SHA256').update(message)
        .verify({ key: Buffer.from(proof.publicKey), format: 'der', type: 'spki' }, Buffer.from(proof.signature));
      if (valid) return { ok: true, id: idFromPublicKey(proof.publicKey), publicKey: proof.publicKey };
    } catch (err) {
      return { ok: false, reason: `nie moge sprawdzic podpisu: ${err.message}` };
    }
  }
  return { ok: false, reason: checked ? 'podpis nie zgadza sie z zawartoscia pliku' : 'podpis nie pasuje do identyfikatora rozszerzenia' };
}

function parse(buffer) {
  if (buffer.length < 16 || buffer.toString('utf8', 0, 4) !== 'Cr24') {
    throw new Error('To nie jest plik CRX');
  }
  const version = buffer.readUInt32LE(4);
  if (version === 2) {
    const pkLen = buffer.readUInt32LE(8);
    const sigLen = buffer.readUInt32LE(12);
    const publicKey = buffer.subarray(16, 16 + pkLen);
    return {
      zip: buffer.subarray(16 + pkLen + sigLen),
      publicKey,
      id: publicKey.length ? idFromPublicKey(publicKey) : null,
      verified: false,
      reason: 'stary format CRX2 bez weryfikowalnego podpisu'
    };
  }
  if (version === 3) {
    const headerLen = buffer.readUInt32LE(8);
    const header = buffer.subarray(12, 12 + headerLen);
    const { proofs, signedHeaderData } = readHeader(header);
    const zip = buffer.subarray(12 + headerLen);
    const verified = verifyCrx3({ zip, proofs, signedHeaderData });
    const publicKey = verified.ok ? verified.publicKey : firstPublicKey(header);
    return {
      zip,
      publicKey,
      id: publicKey ? idFromPublicKey(publicKey) : null,
      verified: verified.ok,
      reason: verified.reason || null
    };
  }
  throw new Error(`Nieobsługiwana wersja CRX: ${version}`);
}

module.exports = { parse, idFromPublicKey, verifyCrx3, readHeader };
