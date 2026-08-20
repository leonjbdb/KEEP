import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createVault,
  parseVault,
  recoverPassword,
  recoverPasswordBytes,
  rotateVault,
  VaultError,
} from "../src/vault.js";
import { decodeCard } from "../src/card.js";
import { randomBytes, fromHex, toHex, sha256 } from "../src/crypto.js";
import { seededRandomBytes, combinations } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// GOLDEN VECTOR — frozen compatibility contract for PKR format v1.
// Generated once with seededRandomBytes(0xC0FFEE), createdAt 1755500000,
// password "CORRECT HORSE BATTERY STAPLE", 3-of-5. The same worked example
// appears in docs/RECOVERY-SPEC.md. It must never change within format v1:
// if this test breaks, you broke compatibility with every existing kit.
// ---------------------------------------------------------------------------
const GOLDEN_PASSWORD = "CORRECT HORSE BATTERY STAPLE";
const GOLDEN_CARDS = [
  "PSR1PQ9HHR5FQDU4WDZ4685CNNPHGE6MRZFCHLWTNA29L3WL8X2CZKZ0PNGWQGHSQEP",
  "PSR1PQFHHRGJCRFC54UCLX90TMNHAH6JQNUGCPTFNW3S5YCMK05AA6EQKXVPXG7TKK6",
  "PSR1PQDHHZQ6XA63NVV6709S3NCYU8GP3XRDYG5REPTNQ47WVRWUG5LXXXCHXDNW5PY",
  "PSR1PQ3HHR4VP2Y5CR2ATSQTQ4RY0PRXN0P4M206P74DJLMMPXCU4ZMSPA6VWRHFZLQ",
  "PSR1PQ4HHZAYL5HAL66L2EQ56AGHW334Z67S8RSST30WXWAWM2ZAQVAK3AW6WX6VQG7",
];
const GOLDEN_BYTES_HEX =
  "89504b520d0a1a0a0100e0cda2680000000003056f71fcd0a0ed434f5a00da78f37f6e25ee0d2fb833e1b475f45035c811167e88f8cd9b57f819defd6c72952d3e57b35e14c392408150bba7f46afaaf743edffdfcdaa5e6134206612ce600149e2bfebcebe2e94a677d3b37951653658077da52db32980e9a2f51262e2d4821bb0110244927e35a9dd520ae622d68cb5c5bbfbe077d9cd8f97a0eccc3e12f17392d621b728b8f18b4a0c970119cc2f1783750d5e863a8d5c7603f7373b4eeaf8e086e525c8b3bf65bd18f30c96ec142e5e34ea2ed6afcfa2cbc03516f5b6b0c05361a63d1956c1df5176aa659e44190049a621d2443069244c8f10f1a48ec0341a9900000001a7d63501ee5ce1276e03da40028b04492e5771033ca3327ba62daa0ce603d3d59125304af87cce88ad86442a692b9a9304471e06c6fd0790f48413b98fac8546a10ce4ef6ac1bab96a306e628d276c48ae5b06ff5fcd165f045d15630ff37f1b4c1274c184c36129c1a8da743a259e7069650715f5496e4020b2f436c08a716a4302958eda8b238b1f244e327a5c4800f7ab04428ed53d5eb90a1d8c862dd487af7ea718ffef6a980fafb48dbaf46c8";

test("golden vector: deterministic regeneration matches frozen bytes", async () => {
  const rng = seededRandomBytes(0xc0ffee);
  const res = await createVault(GOLDEN_PASSWORD, 3, 5, rng, 1755500000);
  assert.equal(toHex(res.bytes), GOLDEN_BYTES_HEX);
  assert.deepEqual(res.cards, GOLDEN_CARDS);
  assert.equal(res.setIdHex, "6F71");
  assert.equal(res.fingerprint, "0F7AB044");
});

test("golden vector: recovery from frozen bytes with every 3-card combo", async () => {
  const vault = await parseVault(fromHex(GOLDEN_BYTES_HEX));
  assert.equal(vault.k, 3);
  assert.equal(vault.n, 5);
  assert.equal(vault.setIdHex, "6F71");
  assert.equal(vault.fingerprint, "0F7AB044");
  assert.equal(vault.createdAt, 1755500000);
  const decoded = GOLDEN_CARDS.map((c) => decodeCard(c));
  for (const combo of combinations(decoded, 3)) {
    assert.equal(await recoverPassword(vault, combo), GOLDEN_PASSWORD);
  }
});

test("random ceremonies: parameters, unicode, max-length password", async () => {
  const pw512 = "x".repeat(512);
  for (const [pw, k, n] of [
    ["simple", 2, 2],
    ["Pässwörd with ünïcode ✓ and spaces", 2, 3],
    // the multi-line entry mode stores its line breaks inside the ciphertext;
    // the recovery screen derives its display size from them, so they must
    // survive the round trip exactly
    ["vault password: hunter2\n\nThe 2FA seed is in the blue notebook,\nshelf above the desk.", 2, 3],
    [pw512, 4, 6],
    ["a", 9, 10],
  ]) {
    const res = await createVault(pw, k, n, randomBytes, 1755500000);
    const vault = await parseVault(res.bytes);
    const decoded = res.cards.map((c) => decodeCard(c));
    const combos = combinations(decoded, k);
    for (const combo of combos.slice(0, 12)) {
      assert.equal(await recoverPassword(vault, combo), pw);
    }
  }
  await assert.rejects(
    () => createVault("y".repeat(513), 3, 5, randomBytes, 0),
    RangeError
  );
  await assert.rejects(
    () => createVault("pw", 1, 5, randomBytes, 0),
    (e) => e instanceof VaultError && e.code === "BAD_PARAMS"
  );
  await assert.rejects(
    () => createVault("pw", 3, 11, randomBytes, 0),
    (e) => e instanceof VaultError && e.code === "BAD_PARAMS"
  );
});

test("recovery negatives: wrong count, duplicates, foreign cards", async () => {
  const a = await createVault("password-A", 3, 5, randomBytes, 1);
  const b = await createVault("password-B", 3, 5, randomBytes, 1);
  const vault = await parseVault(a.bytes);
  const cards = a.cards.map((c) => decodeCard(c));
  const foreign = decodeCard(b.cards[0]);

  await assert.rejects(
    () => recoverPassword(vault, cards.slice(0, 2)),
    (e) => e.code === "NEED_K"
  );
  await assert.rejects(
    () => recoverPassword(vault, [cards[0], cards[0], cards[1]]),
    (e) => e.code === "DUPLICATE"
  );
  await assert.rejects(
    () => recoverPassword(vault, [cards[0], cards[1], foreign]),
    (e) => e.code === "SET_MISMATCH" && e.cardSlot === 3
  );
});

test("tamper matrix: every region fails with the expected error", async () => {
  const clean = fromHex(GOLDEN_BYTES_HEX);
  const cases = [
    { name: "magic", off: 2, code: "BAD_MAGIC" },
    { name: "format_version", off: 8, code: "BAD_VERSION" },
    { name: "created_at", off: 12, code: "DIGEST_MISMATCH" },
    { name: "set_id", off: 21, code: "DIGEST_MISMATCH" },
    { name: "hkdf_salt", off: 30, code: "DIGEST_MISMATCH" },
    { name: "K_app", off: 60, code: "DIGEST_MISMATCH" },
    { name: "nonce", off: 90, code: "DIGEST_MISMATCH" },
    { name: "commitment[0]", off: 100, code: "DIGEST_MISMATCH" },
    { name: "ct_len", off: 258, code: "TRUNCATED" },
    { name: "ciphertext", off: 270, code: "DIGEST_MISMATCH" },
    { name: "digest", off: clean.length - 5, code: "DIGEST_MISMATCH" },
  ];
  for (const c of cases) {
    const bytes = clean.slice();
    bytes[c.off] ^= 0xff;
    await assert.rejects(
      () => parseVault(bytes),
      (e) => e instanceof VaultError && e.code === c.code,
      `region ${c.name} expected ${c.code}`
    );
  }
  // truncation
  await assert.rejects(
    () => parseVault(clean.slice(0, 100)),
    (e) => e.code === "TRUNCATED"
  );
});

test("malicious digest recompute is still caught by AEAD / commitments", async () => {
  const clean = fromHex(GOLDEN_BYTES_HEX);
  const decoded = GOLDEN_CARDS.map((c) => decodeCard(c));

  // attacker flips a ciphertext byte AND fixes the trailing digest
  const evil = clean.slice();
  evil[270] ^= 0x01;
  const body = evil.slice(0, evil.length - 32);
  evil.set(await sha256(body), evil.length - 32);
  const vault = await parseVault(evil); // digest passes now
  await assert.rejects(
    () => recoverPassword(vault, decoded.slice(0, 3)),
    (e) => e.code === "AEAD_FAIL"
  );

  // attacker swaps a commitment AND fixes the digest -> named card slot
  const evil2 = clean.slice();
  evil2[100] ^= 0x01;
  const body2 = evil2.slice(0, evil2.length - 32);
  evil2.set(await sha256(body2), evil2.length - 32);
  const vault2 = await parseVault(evil2);
  await assert.rejects(
    () => recoverPassword(vault2, decoded.slice(0, 3)),
    (e) => e.code === "COMMITMENT_MISMATCH" && e.cardSlot === 1
  );
});

test("rotation: new password, same cards, same set, new fingerprint", async () => {
  const vault = await parseVault(fromHex(GOLDEN_BYTES_HEX));
  const decoded = GOLDEN_CARDS.map((c) => decodeCard(c));
  const rotated = await rotateVault(
    vault,
    [decoded[0], decoded[2], decoded[4]],
    "brand-new-password",
    randomBytes,
    1760000000
  );
  assert.equal(rotated.setIdHex, "6F71");
  assert.notEqual(rotated.fingerprint, "0F7AB044");
  const v2 = await parseVault(rotated.bytes);
  assert.equal(v2.createdAt, 1760000000);
  // old cards still work, recover the NEW password
  assert.equal(
    await recoverPassword(v2, [decoded[1], decoded[3], decoded[4]]),
    "brand-new-password"
  );
});

// the app hands over UTF-8 bytes rather than a string, so the secret sits in
// storage that can be zeroed; passing bytes must be equivalent to passing the
// text, and the caller's array must come back wiped
test("password may be passed as bytes, and those bytes are wiped", async () => {
  const text = "pässwörd ✓ 1234";
  const asBytes = new TextEncoder().encode(text);

  const fromBytes = await createVault(asBytes, 3, 5, seededRandomBytes(7), 1755500000);
  const fromText = await createVault(text, 3, 5, seededRandomBytes(7), 1755500000);
  assert.deepEqual(fromBytes.bytes, fromText.bytes);
  assert.equal(asBytes.every((b) => b === 0), true, "createVault must zero the caller's bytes");

  const vault = await parseVault(fromBytes.bytes);
  const decoded = fromBytes.cards.map((c) => decodeCard(c));
  assert.equal(await recoverPassword(vault, decoded.slice(0, 3)), text);

  const newBytes = new TextEncoder().encode("nästa hemlighet");
  const rotated = await rotateVault(vault, decoded.slice(0, 3), newBytes, randomBytes, 1760000000);
  assert.equal(newBytes.every((b) => b === 0), true, "rotateVault must zero the caller's bytes");
  const v2 = await parseVault(rotated.bytes);
  assert.equal(await recoverPassword(v2, decoded.slice(1, 4)), "nästa hemlighet");
});

test("recoverPasswordBytes returns wipeable bytes of the same secret", async () => {
  const vault = await parseVault(fromHex(GOLDEN_BYTES_HEX));
  const decoded = GOLDEN_CARDS.map((c) => decodeCard(c));
  const bytes = await recoverPasswordBytes(vault, [decoded[0], decoded[1], decoded[2]]);
  assert.deepEqual(bytes, new TextEncoder().encode(GOLDEN_PASSWORD));
  bytes.fill(0);
  assert.equal(bytes.every((b) => b === 0), true);
});
