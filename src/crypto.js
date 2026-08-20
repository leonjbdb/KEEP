// Thin wrappers over WebCrypto (identical API in browsers and Node)
// plus the password padding scheme. All functions take/return Uint8Array.

export const MAX_PASSWORD_BYTES = 512;
const PAD_BUCKET = 64;
const PAD_MIN = 128;

const subtle = globalThis.crypto.subtle;

export function randomBytes(len) {
  const out = new Uint8Array(len);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export async function sha256(bytes) {
  return new Uint8Array(await subtle.digest("SHA-256", bytes));
}

export async function hkdfSha256(ikm, salt, info, length) {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

export async function aesGcmSeal(keyBytes, nonce, aad, plaintext) {
  const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
    key,
    plaintext
  );
  return new Uint8Array(ct); // ciphertext || 16-byte tag
}

/** Throws on authentication failure (wrong key, tampered data or AAD). */
export async function aesGcmOpen(keyBytes, nonce, aad, ciphertext) {
  const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const pt = await subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
    key,
    ciphertext
  );
  return new Uint8Array(pt);
}

/**
 * UTF-8 encode from code points, so a secret held in a wipeable typed array
 * can reach the cipher without passing through a JS string on the way (a
 * string could not be zeroed afterwards). Byte-for-byte identical to
 * TextEncoder over the same text — the kit is decoded by other tools, so
 * that equivalence is covered by tests.
 */
export function utf8FromCodePoints(codePoints, length = codePoints.length) {
  let n = 0;
  for (let i = 0; i < length; i++) {
    const cp = codePoints[i];
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  const out = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i < length; i++) {
    const cp = codePoints[i];
    if (cp < 0x80) {
      out[p++] = cp;
    } else if (cp < 0x800) {
      out[p++] = 0xc0 | (cp >> 6);
      out[p++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      out[p++] = 0xe0 | (cp >> 12);
      out[p++] = 0x80 | ((cp >> 6) & 0x3f);
      out[p++] = 0x80 | (cp & 0x3f);
    } else {
      out[p++] = 0xf0 | (cp >> 18);
      out[p++] = 0x80 | ((cp >> 12) & 0x3f);
      out[p++] = 0x80 | ((cp >> 6) & 0x3f);
      out[p++] = 0x80 | (cp & 0x3f);
    }
  }
  return out;
}

/** Byte length of the same encoding, without building the array. */
export function utf8LengthFromCodePoints(codePoints, length = codePoints.length) {
  let n = 0;
  for (let i = 0; i < length; i++) {
    const cp = codePoints[i];
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Pad a password to a length bucket so the ciphertext size only reveals
 * a coarse range: u16 LE length || utf8 bytes || zeros, padded to the
 * next multiple of 64 with a 128-byte floor.
 */
export function padPassword(pwBytes) {
  if (pwBytes.length === 0) throw new RangeError("password must not be empty");
  if (pwBytes.length > MAX_PASSWORD_BYTES) {
    throw new RangeError(`password longer than ${MAX_PASSWORD_BYTES} bytes`);
  }
  const raw = 2 + pwBytes.length;
  const padded = Math.max(PAD_MIN, Math.ceil(raw / PAD_BUCKET) * PAD_BUCKET);
  const out = new Uint8Array(padded);
  out[0] = pwBytes.length & 0xff;
  out[1] = (pwBytes.length >> 8) & 0xff;
  out.set(pwBytes, 2);
  return out;
}

export function unpadPassword(padded) {
  if (padded.length < PAD_MIN) throw new RangeError("padded block too short");
  const len = padded[0] | (padded[1] << 8);
  if (len === 0 || 2 + len > padded.length) throw new RangeError("corrupt padding header");
  return padded.slice(2, 2 + len);
}

/** Constant-time-ish comparison (best effort in JS). */
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex) {
  if (hex.length % 2 !== 0) throw new RangeError("odd hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new RangeError("bad hex");
    out[i] = byte;
  }
  return out;
}

export function toBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
