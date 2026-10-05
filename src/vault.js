// PKR vault container: the byte format embedded (base64) in a
// personalized RECOVERY.html. Layout (little-endian):
//
//   off        len   field
//   0          8     magic 89 50 4B 52 0D 0A 1A 0A  ("\x89PKR\r\n\x1a\n")
//   8          2     format_version = 1 or 2
//   10         8     created_at (unix seconds, u64)
//   18         1     threshold k
//   19         1     shares n
//   20         2     set_id (random per ceremony)
//   22         32    hkdf_salt (random)
//   54         32    v1: K_app (random 32-byte key half held by the kit file)
//                    v2: owner commitment
//                      SHA-256("PKRv2 owner-commit" || hkdf_salt || K_app)
//                      — K_app itself lives only on the separate owner key
//   86         12    AES-GCM nonce (random, fresh per encryption)
//   98         32*n  share commitments, i = 1..n:
//                      SHA-256("PKRv1 share-commit" || hkdf_salt || index || share_y)
//   98+32n     4     ct_len (u32)
//   102+32n    var   ciphertext || 16-byte GCM tag
//   end-32     32    file_digest = SHA-256(all preceding bytes)
//
// AAD for the AEAD = bytes 0 .. 102+32n (magic through ct_len): any
// header tamper fails decryption cryptographically (a v2 kit rewritten
// as v1 included — the version bytes are authenticated). The trailing
// digest is the non-cryptographic freshness/bit-rot check ("kit
// fingerprint" = first 4 digest bytes as 8 hex chars).
//
// Decryption key = HKDF-SHA256(salt = hkdf_salt,
//                              IKM  = K_app || K_share  (fixed order),
//                              info = "PKRv1 vault-key", L = 32).
// The derivation is identical in both versions — v2 changes only where
// K_app is stored (bech32m "KEEP1…" owner key instead of offset 54),
// which is why the info string keeps its v1 name.

import { split, combine } from "./shamir.js";
import { encodeCard, encodeOwnerKey } from "./card.js";
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
export const FORMAT_VERSION_OWNER_KEY = 2;
// The tool's compatibility declaration: the vault format versions this
// build can read, carry, and re-wrap into a fresh kit file. A file whose
// version is not listed here is refused rather than guessed at — the
// upgrade path shows this list as the promise it acts on.
export const SUPPORTED_FORMAT_VERSIONS = [FORMAT_VERSION, FORMAT_VERSION_OWNER_KEY];
export const MIN_CARDS = 2;
export const MAX_CARDS = 10;
const MAGIC = Uint8Array.of(0x89, 0x50, 0x4b, 0x52, 0x0d, 0x0a, 0x1a, 0x0a);
const HKDF_INFO = new TextEncoder().encode("PKRv1 vault-key");
const COMMIT_PREFIX = new TextEncoder().encode("PKRv1 share-commit");
const OWNER_COMMIT_PREFIX = new TextEncoder().encode("PKRv2 owner-commit");

export class VaultError extends Error {
  constructor(code, message, cardSlot = null) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    // 1-based position of the offending card in the user's input, when known
    this.cardSlot = cardSlot;
  }
}

/**
 * A v1 kit needs at least 2 of 2: with K_app in the file, a single key
 * would make one holder plus any file copy the whole secret. A v2 kit
 * (separate owner key) may go down to 1 of 1 — the owner key is itself
 * a required factor, so even then no holder can act alone.
 */
export function validateParams(k, n, separateOwnerKey = false) {
  const minK = separateOwnerKey ? 1 : 2;
  const minN = separateOwnerKey ? 1 : MIN_CARDS;
  if (!Number.isInteger(k) || !Number.isInteger(n)) {
    throw new VaultError("BAD_PARAMS", "k and n must be integers");
  }
  if (k < minK) {
    throw new VaultError("BAD_PARAMS", `threshold must be at least ${minK} ${minK === 1 ? "key" : "keys"}`);
  }
  if (n < minN || n > MAX_CARDS) {
    throw new VaultError("BAD_PARAMS", `number of keys must be ${minN}..${MAX_CARDS}`);
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

/** Commitment binding a v2 vault to its owner key — identifies a
 *  wrong-but-well-formed owner key before decryption, like the share
 *  commitments do for cards. Safe to store: a preimage over the 256
 *  random bits of K_app. */
async function ownerCommitment(salt, kApp) {
  const buf = new Uint8Array(OWNER_COMMIT_PREFIX.length + salt.length + kApp.length);
  buf.set(OWNER_COMMIT_PREFIX, 0);
  buf.set(salt, OWNER_COMMIT_PREFIX.length);
  buf.set(kApp, OWNER_COMMIT_PREFIX.length + salt.length);
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

// The header is magic through ct_len: exactly the bytes the AEAD
// authenticates. `slot54` is the 32-byte field at offset 54 — K_app in a v1
// vault, the owner commitment in a v2 vault. `ctLen` is known before
// encrypting (padded plaintext + 16-byte tag), so the header can serve as
// the AAD and as the file's first bytes alike.
function buildHeader({ version, createdAt, k, n, setId, salt, slot54, nonce, commitments, ctLen }) {
  const header = new Uint8Array(102 + 32 * n);
  const dv = new DataView(header.buffer);
  header.set(MAGIC, 0);
  dv.setUint16(8, version, true);
  dv.setBigUint64(10, BigInt(createdAt), true);
  header[18] = k;
  header[19] = n;
  header.set(setId, 20);
  header.set(salt, 22);
  header.set(slot54, 54);
  header.set(nonce, 86);
  for (let i = 0; i < n; i++) header.set(commitments[i], 98 + 32 * i);
  dv.setUint32(98 + 32 * n, ctLen, true);
  return header;
}

/** Encrypt under `header` as AAD and lay out the file:
 *  header || ciphertext+tag || SHA-256 of both. */
async function sealVault(key, header, nonce, padded) {
  const ct = await aesGcmSeal(key, nonce, header, padded);
  if (ct.length !== padded.length + 16) {
    throw new Error("internal: unexpected ciphertext length");
  }
  const body = new Uint8Array(header.length + ct.length);
  body.set(header, 0);
  body.set(ct, header.length);
  const bytes = new Uint8Array(body.length + 32);
  bytes.set(body, 0);
  bytes.set(await sha256(body), body.length);
  return bytes;
}

/** The kit fingerprint: the first 4 bytes of the trailing digest, as hex. */
function fingerprintOf(bytes) {
  return toHex(bytes.slice(bytes.length - 32, bytes.length - 28)).toUpperCase();
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
 * Returns { bytes, cards, ownerKey, setIdHex, fingerprint, k, n, createdAt }.
 * ("cards" is the internal name for the handwritten key codes.)
 * `randomBytes(len)` supplies ALL randomness (injectable for tests);
 * `createdAt` is unix seconds. With `opts.separateOwnerKey` the vault is
 * written as format v2: K_app is NOT stored in the file — it comes back
 * as the bech32m `ownerKey` string, and recovery needs it alongside the
 * k cards. Without the option (v1) `ownerKey` is null.
 */
export async function createVault(password, k, n, randomBytes, createdAt, opts = {}) {
  const separateOwnerKey = Boolean(opts.separateOwnerKey);
  validateParams(k, n, separateOwnerKey);
  const pwBytes = passwordBytes(password);
  const padded = padPassword(pwBytes);

  // the draw order is frozen: the v1 golden vector depends on it, and v2
  // keeps it so the two modes differ only in where K_app ends up
  const kShare = randomBytes(32);
  const kApp = randomBytes(32);
  const salt = randomBytes(32);
  const nonce = randomBytes(12);
  const setId = randomBytes(2);

  const shares = split(kShare, k, n, randomBytes);
  const commitments = [];
  for (const s of shares) commitments.push(await commitment(salt, s.index, s.y));

  const version = separateOwnerKey ? FORMAT_VERSION_OWNER_KEY : FORMAT_VERSION;
  const slot54 = separateOwnerKey ? await ownerCommitment(salt, kApp) : kApp;

  const key = await deriveKey(salt, kApp, kShare);
  const header = buildHeader({
    version, createdAt, k, n, setId, salt, slot54, nonce, commitments, ctLen: padded.length + 16,
  });
  const bytes = await sealVault(key, header, nonce, padded);
  key.fill(0);
  padded.fill(0);
  pwBytes.fill(0);

  const cards = shares.map((s) => encodeCard(s.index, setId, s.y));
  const ownerKey = separateOwnerKey ? encodeOwnerKey(setId, kApp) : null;
  kShare.fill(0);
  kApp.fill(0);
  for (const s of shares) s.y.fill(0);

  return {
    bytes,
    cards,
    ownerKey,
    k,
    n,
    createdAt,
    setIdHex: toHex(setId).toUpperCase(),
    fingerprint: fingerprintOf(bytes),
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
  if (!SUPPORTED_FORMAT_VERSIONS.includes(version)) {
    throw new VaultError("BAD_VERSION", `unsupported vault version ${version}`);
  }
  const createdAt = Number(dv.getBigUint64(10, true));
  const k = bytes[18];
  const n = bytes[19];
  try {
    validateParams(k, n, version === FORMAT_VERSION_OWNER_KEY);
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
  const needsOwnerKey = version === FORMAT_VERSION_OWNER_KEY;
  return {
    version,
    needsOwnerKey,
    createdAt,
    k,
    n,
    setId: bytes.slice(20, 22),
    salt: bytes.slice(22, 54),
    // one 32-byte field, two meanings: the key half itself in v1, only a
    // commitment to it in v2 (the key half is on the separate owner key)
    kApp: needsOwnerKey ? null : bytes.slice(54, 86),
    ownerCommit: needsOwnerKey ? bytes.slice(54, 86) : null,
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
 * Validate a decoded owner key ({ setId, kApp }) against a parsed v2 vault.
 * Exported so entry fields can validate live, like checkCard for cards.
 */
export async function checkOwnerKey(vault, owner) {
  if (!vault.needsOwnerKey) {
    throw new VaultError("OWNER_NOT_NEEDED", "this kit stores its own key half; it takes no owner's key");
  }
  if (!bytesEqual(owner.setId, vault.setId)) {
    throw new VaultError(
      "OWNER_SET_MISMATCH",
      `the owner's key is from a different key set (kit expects set ${vault.setIdHex})`
    );
  }
  const actual = await ownerCommitment(vault.salt, owner.kApp);
  if (!bytesEqual(vault.ownerCommit, actual)) {
    throw new VaultError(
      "OWNER_KEY_MISMATCH",
      "the owner's key is valid text but does not belong to this vault file"
    );
  }
}

/** The K_app to derive with: the vault's own in v1, the verified owner
 *  key's in v2. Both a missing owner key (v2) and a surplus one (v1) are
 *  the caller's error — silently ignoring key material would hide bugs. */
async function resolveKApp(vault, owner) {
  if (!vault.needsOwnerKey) {
    if (owner) {
      throw new VaultError("OWNER_NOT_NEEDED", "this kit stores its own key half; it takes no owner's key");
    }
    return vault.kApp;
  }
  if (!owner) {
    throw new VaultError("NEED_OWNER_KEY", "this kit needs the owner's key as well as the keys");
  }
  await checkOwnerKey(vault, owner);
  return owner.kApp;
}

/**
 * The vault key from exactly k keys (and, for a v2 vault, the owner key):
 * each key's membership is checked before duplicates, so a foreign key
 * says "wrong set" rather than "entered twice" even when its index collides
 * with a valid one. The caller owns the returned key and must zero it.
 */
async function vaultKeyFrom(vault, keys, owner) {
  if (keys.length !== vault.k) {
    throw new VaultError("NEED_K", `exactly ${vault.k} keys are required, got ${keys.length}`);
  }
  const kApp = await resolveKApp(vault, owner);
  const seen = new Set();
  for (let i = 0; i < keys.length; i++) {
    await checkCard(vault, keys[i], i + 1);
    if (seen.has(keys[i].index)) {
      throw new VaultError("DUPLICATE", `the same key was entered twice (key ${keys[i].index})`, i + 1);
    }
    seen.add(keys[i].index);
  }
  const kShare = combine(keys.map((c) => ({ index: c.index, y: c.shareY })));
  const key = await deriveKey(vault.salt, kApp, kShare);
  kShare.fill(0);
  return key;
}

/**
 * Recover the password as UTF-8 bytes. The caller owns the array and should
 * zero it once done: bytes can be wiped, the string a decode would produce
 * cannot. `recoverPassword` below is the string form, for callers that have
 * to hand the value to something text-shaped. A v2 vault additionally needs
 * `owner`, the decoded owner key ({ setId, kApp }).
 */
export async function recoverPasswordBytes(vault, keys, owner = null) {
  const key = await vaultKeyFrom(vault, keys, owner);
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
export async function recoverPassword(vault, keys, owner = null) {
  const pw = await recoverPasswordBytes(vault, keys, owner);
  const text = new TextDecoder().decode(pw);
  pw.fill(0);
  return text;
}

/**
 * Rotation: same key set, new password. Requires k valid keys (proves
 * possession), keeps K_app/salt/set_id/commitments, draws a fresh nonce.
 * A v2 vault additionally needs `owner` — the same owner key stays valid
 * afterwards, since the vault keeps its commitment.
 */
export async function rotateVault(vault, keys, newPassword, randomBytes, createdAt, owner = null) {
  const key = await vaultKeyFrom(vault, keys, owner);
  const pwBytes = passwordBytes(newPassword);
  const padded = padPassword(pwBytes);
  const nonce = randomBytes(12);
  const header = buildHeader({
    version: vault.version,
    createdAt,
    k: vault.k,
    n: vault.n,
    setId: vault.setId,
    salt: vault.salt,
    slot54: vault.needsOwnerKey ? vault.ownerCommit : vault.kApp,
    nonce,
    commitments: vault.commitments,
    ctLen: padded.length + 16,
  });
  const bytes = await sealVault(key, header, nonce, padded);
  key.fill(0);
  padded.fill(0);
  pwBytes.fill(0);
  return {
    bytes,
    k: vault.k,
    n: vault.n,
    createdAt,
    setIdHex: vault.setIdHex,
    fingerprint: fingerprintOf(bytes),
  };
}
