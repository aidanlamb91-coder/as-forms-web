/**
 * 1.2.1-web Other forms: unlocks the encrypted forms library on the website (port of Android
 * forms/FormsCrypto.kt). Same format as scripts/encrypt-forms.py in the Android repo:
 *  - key  = PBKDF2-HMAC-SHA256(access code, salt from key.json, iterations from key.json, 32 bytes)
 *  - file = "ASF1" + 12-byte IV + AES-256-GCM ciphertext + 16-byte tag.
 * WebCrypto only (free, built into the browser). The AES key is made NON-EXTRACTABLE, so it can
 * be kept in IndexedDB and used again, but its bytes can never be read back out by any script.
 * A wrong access code makes the GCM tag check fail, which we report as WrongCode.
 */
(function (global) {
  const MAGIC = [0x41, 0x53, 0x46, 0x31]; // "ASF1"
  const MIN_ITERATIONS = 200000;
  const subtle = () => global.crypto.subtle;

  class WrongCode extends Error { constructor() { super('Wrong access code'); this.name = 'WrongCode'; } }
  class BadFile extends Error { constructor(m) { super(m || 'Not an AS Forms file'); this.name = 'BadFile'; } }

  function bytes(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    throw new Error('Expected bytes');
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** Turns the access code into the AES key (slow on purpose: about a second). Never extractable. */
  async function deriveKey(code, saltB64, iterations) {
    if (!(iterations >= MIN_ITERATIONS)) throw new Error('Too few iterations');
    const base = await subtle().importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(saltB64), iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt', 'encrypt'],
    );
  }

  /** Decrypts one downloaded file. Throws WrongCode when the key doesn't fit. */
  async function open(key, blob) {
    const b = bytes(blob);
    if (b.length < 4 + 12 + 16 || MAGIC.some((m, i) => b[i] !== m)) throw new BadFile();
    try {
      return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b.slice(4, 16) }, key, b.slice(16)));
    } catch (e) {
      throw new WrongCode();
    }
  }

  /** Encrypts in the same format (used for the device's own files and by the tests). */
  async function seal(key, plain, iv) {
    const v = iv || global.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: v }, key, bytes(plain)));
    const out = new Uint8Array(16 + ct.length);
    out.set(MAGIC, 0); out.set(v, 4); out.set(ct, 16);
    return out;
  }

  async function sha256Hex(data) {
    const h = new Uint8Array(await subtle().digest('SHA-256', bytes(data)));
    return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  /** A fresh random key for this device (HR details, drafts, signatures). Never extractable. */
  function newDeviceKey() {
    return subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  global.AsFormsCrypto = { deriveKey, open, seal, sha256Hex, newDeviceKey, b64ToBytes, bytes, WrongCode, BadFile, MIN_ITERATIONS };
})(typeof window !== 'undefined' ? window : globalThis);
