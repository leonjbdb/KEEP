// PKR vault container: the byte format embedded (base64) in a
// personalized RECOVERY.html. Layout (little-endian):
//
//   off        len   field
//   0          8     magic 89 50 4B 52 0D 0A 1A 0A  ("\x89PKR\r\n\x1a\n")
//   8          2     format_version = 1
//   10         8     created_at (unix seconds, u64)
//   18         1     threshold k
//   19         1     shares n
//   20         2     set_id (random per ceremony)
//   22         32    hkdf_salt (random)
//   54         32    K_app (random 32-byte key half held by the kit file)
//   86         12    AES-GCM nonce (random, fresh per encryption)
//   98         32*n  share commitments, i = 1..n:
//                      SHA-256("PKRv1 share-commit" || hkdf_salt || index || share_y)
//   98+32n     4     ct_len (u32)
//   102+32n    var   ciphertext || 16-byte GCM tag
//   end-32     32    file_digest = SHA-256(all preceding bytes)
//
// AAD for the AEAD = bytes 0 .. 102+32n (magic through ct_len): any
// header tamper fails decryption cryptographically. The trailing digest
// is the non-cryptographic freshness/bit-rot check ("kit fingerprint" =
// first 4 digest bytes as 8 hex chars).
//
// Decryption key = HKDF-SHA256(salt = hkdf_salt,
//                              IKM  = K_app || K_share  (fixed order),
//                              info = "PKRv1 vault-key", L = 32).

import { split, combine } from "./shamir.js";
import { encodeCard } from "./card.js";
import {
  sha256,
  hkdfSha256,
  aesGcmSeal,
  aesGcmOpen,
  padPassword,
  unpadPassword,
  bytesEqual,
  toHex,
} from "./crypto.js";

export const FORMAT_VERSION = 1;
export const MIN_CARDS = 2;
export const MAX_CARDS = 10;
const MAGIC = Uint8Array.of(0x89, 0x50, 0x4b, 0x52, 0x0d, 0x0a, 0x1a, 0x0a);
const HKDF_INFO = new TextEncoder().encode("PKRv1 vault-key");
const COMMIT_PREFIX = new TextEncoder().encode("PKRv1 share-commit");

export class VaultError extends Error {
  constructor(code, message, cardSlot = null) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    // 1-based position of the offending card in the user's input, when known
    this.cardSlot = cardSlot;
  }
}

export function validateParams(k, n) {
  if (!Number.isInteger(k) || !Number.isInteger(n)) {
    throw new VaultError("BAD_PARAMS", "k and n must be integers");
  }
  if (k < 2) throw new VaultError("BAD_PARAMS", "threshold must be at least 2 keys");
  if (n < MIN_CARDS || n > MAX_CARDS) {
    throw new VaultError("BAD_PARAMS", `number of keys must be ${MIN_CARDS}..${MAX_CARDS}`);
  }
  if (k > n) throw new VaultError("BAD_PARAMS", "threshold cannot exceed the number of keys");
}

async function commitment(salt, index, shareY) {
  const buf = new Uint8Array(COMMIT_PREFIX.length + salt.length + 1 + shareY.length);
  buf.set(COMMIT_PREFIX, 0);
  buf.set(salt, COMMIT_PREFIX.length);
  buf[COMMIT_PREFIX.length + salt.length] = index;
  buf.set(shareY, COMMIT_PREFIX.length + salt.length + 1);
  return sha256(buf);
}

async function deriveKey(salt, kApp, kShare) {
  const ikm = new Uint8Array(64);
  ikm.set(kApp, 0);
  ikm.set(kShare, 32);
  const key = await hkdfSha256(ikm, salt, HKDF_INFO, 32);
  ikm.fill(0);
  return key;
}

function buildBytes(header, ct, digest) {
  const out = new Uint8Array(header.length + ct.length + 32);
  out.set(header, 0);
  out.set(ct, header.length);
  out.set(digest, header.length + ct.length);
  return out;
}

async function assemble({ createdAt, k, n, setId, salt, kApp, nonce, commitments, ct }) {
  const header = new Uint8Array(102 + 32 * n);
  const dv = new DataView(header.buffer);
  header.set(MAGIC, 0);
  dv.setUint16(8, FORMAT_VERSION, true);
  dv.setBigUint64(10, BigInt(createdAt), true);
  header[18] = k;
  header[19] = n;
  header.set(setId, 20);
  header.set(salt, 22);
  header.set(kApp, 54);
  header.set(nonce, 86);
  for (let i = 0; i < n; i++) header.set(commitments[i], 98 + 32 * i);
  dv.setUint32(98 + 32 * n, ct.length, true);
  const digest = await sha256(buildBytes(header, ct, new Uint8Array(0)).slice(0, header.length + ct.length));
  return buildBytes(header, ct, digest);
}

/**
 * The password may arrive as a string or as UTF-8 bytes. Bytes are what the
 * app hands over: a Uint8Array can be zeroed once the ciphertext exists,
 * where a string would linger in the heap until collected. Either way the
 * array returned here is the one that gets wiped — callers passing bytes
 * are handing over ownership of them.
 */
function passwordBytes(password) {
  return typeof password === "string" ? new TextEncoder().encode(password) : password;
}

/**
 * Run a full split ceremony.
 * Returns { bytes, cards, setIdHex, fingerprint, k, n, createdAt }.
 * ("cards" is the internal name for the handwritten key codes.)
 * `randomBytes(len)` supplies ALL randomness (injectable for tests);
 * `createdAt` is unix seconds.
 */
export async function createVault(password, k, n, randomBytes, createdAt) {
  validateParams(k, n);
  const pwBytes = passwordBytes(password);
  const padded = padPassword(pwBytes);

  const kShare = randomBytes(32);
  const kApp = randomBytes(32);
  const salt = randomBytes(32);
  const nonce = randomBytes(12);
  const setId = randomBytes(2);

  const shares = split(kShare, k, n, randomBytes);
  const commitments = [];
  for (const s of shares) commitments.push(await commitment(salt, s.index, s.y));

  const key = await deriveKey(salt, kApp, kShare);
  // AAD = header bytes; build header with a placeholder pass first is
  // avoided by computing ct length up front (plaintext + 16-byte tag).
  const headerLen = 102 + 32 * n;
  const aadProbe = new Uint8Array(headerLen);
  {
    const dv = new DataView(aadProbe.buffer);
    aadProbe.set(MAGIC, 0);
    dv.setUint16(8, FORMAT_VERSION, true);
    dv.setBigUint64(10, BigInt(createdAt), true);
    aadProbe[18] = k;
    aadProbe[19] = n;
    aadProbe.set(setId, 20);
    aadProbe.set(salt, 22);
    aadProbe.set(kApp, 54);
    aadProbe.set(nonce, 86);
    for (let i = 0; i < n; i++) aadProbe.set(commitments[i], 98 + 32 * i);
    dv.setUint32(98 + 32 * n, padded.length + 16, true);
  }
  const ct = await aesGcmSeal(key, nonce, aadProbe, padded);
  if (ct.length !== padded.length + 16) {
    throw new Error("internal: unexpected ciphertext length");
  }
  key.fill(0);
  padded.fill(0);
  pwBytes.fill(0);

  const bytes = await assemble({ createdAt, k, n, setId, salt, kApp, nonce, commitments, ct });
  const cards = shares.map((s) => encodeCard(s.index, setId, s.y));
  kShare.fill(0);
  for (const s of shares) s.y.fill(0);

  const digest = bytes.slice(bytes.length - 32);
  return {
    bytes,
    cards,
    k,
    n,
    createdAt,
    setIdHex: toHex(setId).toUpperCase(),
    fingerprint: toHex(digest.slice(0, 4)).toUpperCase(),
  };
}

/** Parse + integrity-check PKR bytes. Throws VaultError. */
export async function parseVault(bytes) {
  if (bytes.length < 8 || !bytesEqual(bytes.slice(0, 8), MAGIC)) {
    throw new VaultError(
      "BAD_MAGIC",
      "not a PKR vault (file corrupted, possibly by a text-mode copy?)"
    );
  }
  if (bytes.length < 102 + 32 * MIN_CARDS + 16 + 32) {
    throw new VaultError("TRUNCATED", "vault file is truncated");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint16(8, true);
  if (version !== FORMAT_VERSION) {
    throw new VaultError("BAD_VERSION", `unsupported vault version ${version}`);
  }
  const createdAt = Number(dv.getBigUint64(10, true));
  const k = bytes[18];
  const n = bytes[19];
  try {
    validateParams(k, n);
  } catch {
    throw new VaultError("BAD_PARAMS", "vault header has invalid k/n parameters");
  }
  const headerLen = 102 + 32 * n;
  if (bytes.length < headerLen + 16 + 32) {
    throw new VaultError("TRUNCATED", "vault file is truncated");
  }
  const ctLen = dv.getUint32(98 + 32 * n, true);
  if (bytes.length !== headerLen + ctLen + 32) {
    throw new VaultError("TRUNCATED", "vault length does not match its header");
  }
  const digest = await sha256(bytes.slice(0, headerLen + ctLen));
  if (!bytesEqual(digest, bytes.slice(headerLen + ctLen))) {
    throw new VaultError(
      "DIGEST_MISMATCH",
      "vault integrity check failed. This copy is corrupted; try the other USB stick"
    );
  }
  const commitments = [];
  for (let i = 0; i < n; i++) commitments.push(bytes.slice(98 + 32 * i, 98 + 32 * (i + 1)));
  return {
    version,
    createdAt,
    k,
    n,
    setId: bytes.slice(20, 22),
    salt: bytes.slice(22, 54),
    kApp: bytes.slice(54, 86),
    nonce: bytes.slice(86, 98),
    commitments,
    aad: bytes.slice(0, headerLen),
    ct: bytes.slice(headerLen, headerLen + ctLen),
    setIdHex: toHex(bytes.slice(20, 22)).toUpperCase(),
    fingerprint: toHex(digest.slice(0, 4)).toUpperCase(),
  };
}

/**
 * Validate one decoded key against a parsed vault.
 * slot is the 1-based input position, used only for error messages.
 */
export async function checkCard(vault, key, slot) {
  if (!bytesEqual(key.setId, vault.setId)) {
    throw new VaultError(
      "SET_MISMATCH",
      `key in slot ${slot} is from a different key set (kit expects set ${vault.setIdHex})`,
      slot
    );
  }
  if (key.index < 1 || key.index > vault.n) {
    throw new VaultError("BAD_INDEX", `key in slot ${slot} has index ${key.index}, kit has only ${vault.n} keys`, slot);
  }
  const expected = vault.commitments[key.index - 1];
  const actual = await commitment(vault.salt, key.index, key.shareY);
  if (!bytesEqual(expected, actual)) {
    throw new VaultError(
      "COMMITMENT_MISMATCH",
      `key in slot ${slot} is valid text but does not belong to this vault file`,
      slot
    );
  }
}

/**
 * Recover the password as UTF-8 bytes. The caller owns the array and should
 * zero it once done: bytes can be wiped, the string a decode would produce
 * cannot. `recoverPassword` below is the string form, for callers that have
 * to hand the value to something text-shaped.
 */
export async function recoverPasswordBytes(vault, keys) {
  if (keys.length !== vault.k) {
    throw new VaultError("NEED_K", `exactly ${vault.k} keys are required, got ${keys.length}`);
  }
  const seen = new Set();
  for (let i = 0; i < keys.length; i++) {
    // membership first: a foreign key should say "wrong set", not
    // "entered twice", even when its index collides with a valid key
    await checkCard(vault, keys[i], i + 1);
    if (seen.has(keys[i].index)) {
      throw new VaultError("DUPLICATE", `the same key was entered twice (key ${keys[i].index})`, i + 1);
    }
    seen.add(keys[i].index);
  }
  const kShare = combine(keys.map((c) => ({ index: c.index, y: c.shareY })));
  const key = await deriveKey(vault.salt, vault.kApp, kShare);
  kShare.fill(0);
  let padded;
  try {
    padded = await aesGcmOpen(key, vault.nonce, vault.aad, vault.ct);
  } catch {
    throw new VaultError(
      "AEAD_FAIL",
      "keys verified but decryption failed. The vault file is damaged; try the other USB stick"
    );
  } finally {
    key.fill(0);
  }
  const pw = unpadPassword(padded);
  padded.fill(0);
  return pw;
}

/** Recover the password as a string. */
export async function recoverPassword(vault, keys) {
  const pw = await recoverPasswordBytes(vault, keys);
  const text = new TextDecoder().decode(pw);
  pw.fill(0);
  return text;
}

/**
 * Rotation: same key set, new password. Requires k valid keys (proves
 * possession), keeps K_app/salt/set_id/commitments, draws a fresh nonce.
 */
export async function rotateVault(vault, keys, newPassword, randomBytes, createdAt) {
  if (keys.length !== vault.k) {
    throw new VaultError("NEED_K", `exactly ${vault.k} keys are required, got ${keys.length}`);
  }
  const seen = new Set();
  for (let i = 0; i < keys.length; i++) {
    await checkCard(vault, keys[i], i + 1);
    if (seen.has(keys[i].index)) {
      throw new VaultError("DUPLICATE", `the same key was entered twice (key ${keys[i].index})`, i + 1);
    }
    seen.add(keys[i].index);
  }
  const kShare = combine(keys.map((c) => ({ index: c.index, y: c.shareY })));
  const key = await deriveKey(vault.salt, vault.kApp, kShare);
  kShare.fill(0);

  const pwBytes = passwordBytes(newPassword);
  const padded = padPassword(pwBytes);
  const nonce = randomBytes(12);
  const n = vault.n;
  const headerLen = 102 + 32 * n;
  const aad = new Uint8Array(headerLen);
  const dv = new DataView(aad.buffer);
  aad.set(MAGIC, 0);
  dv.setUint16(8, FORMAT_VERSION, true);
  dv.setBigUint64(10, BigInt(createdAt), true);
  aad[18] = vault.k;
  aad[19] = n;
  aad.set(vault.setId, 20);
  aad.set(vault.salt, 22);
  aad.set(vault.kApp, 54);
  aad.set(nonce, 86);
  for (let i = 0; i < n; i++) aad.set(vault.commitments[i], 98 + 32 * i);
  dv.setUint32(98 + 32 * n, padded.length + 16, true);

  const ct = await aesGcmSeal(key, nonce, aad, padded);
  key.fill(0);
  padded.fill(0);
  pwBytes.fill(0);
  const digest = await sha256(buildBytes(aad, ct, new Uint8Array(0)).slice(0, headerLen + ct.length));
  const bytes = buildBytes(aad, ct, digest);
  return {
    bytes,
    k: vault.k,
    n,
    createdAt,
    setIdHex: vault.setIdHex,
    fingerprint: toHex(digest.slice(0, 4)).toUpperCase(),
  };
}
