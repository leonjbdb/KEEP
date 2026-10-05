import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createVault,
  parseVault,
  recoverPassword,
  recoverPasswordBytes,
  rotateVault,
  VaultError,
  FORMAT_VERSION,
  FORMAT_VERSION_OWNER_KEY,
  SUPPORTED_FORMAT_VERSIONS,
} from "../src/vault.js";
import { decodeCard, decodeOwnerKey } from "../src/card.js";
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
  assert.equal(res.ownerKey, null);
});

// ---------------------------------------------------------------------------
// GOLDEN VECTOR 2 — frozen compatibility contract for PKR format v2
// (separate owner key). Generated once with seededRandomBytes(0xC0FFEE2),
// createdAt 1755600000, the same password, 3-of-5. Same freeze rules as v1.
// ---------------------------------------------------------------------------
const GOLDEN2_OWNER_KEY =
  "KEEP1PPM0M8YXPPMVR224XJRMMNUS45UU5T7XQH39GN8XKSE498D0AGC5DLTQML6JJL";
const GOLDEN2_CARDS = [
  "PSR1PQY8D77ZXGL48A0CPYKJWJRDY6G2UMJ35VF404XZMWSKPC4SZ8WS4CXAKKQF0N2",
  "PSR1PQG8D7H9Q8R6A0KSD3DGCGL60LWCPTYLQZCN2WXYRAPA8YL95XN778NYDQT7ZM0",
  "PSR1PQV8D7N7Q6JT8ZN4VALS99JP5XQGE4JSDTKEJQKE26RTTUR2J6D3U7ZRQYWG603",
  "PSR1PQS8D7SFJEKHMMACUCE5K9HT8V8FM7MTXCHDUXJ0SV27SKSMWUVV5ENASGKLTG8",
  "PSR1PQ58D75JJY8XPKCAA5TVTG6SU4FERQDYT3E8YGZJETGGUWV5GQJRKQZ6AVNFNUE",
];
const GOLDEN2_BYTES_HEX =
  "89504b520d0a1a0a02008054a4680000000003050edf0d592e734a04fbb9933637f741924e2d8275df1f95eb86dc8f267d3f79e03deec666b5e8d170a9734775a6b9e786492020a6050ce6e87b2ae069cc6d547a87b260c56f1421d3b574691de314c57ddf4e48fd429856778b14144c9260fdb91060cd7b5e293062853266ebd47d60cc2bfed617a21779aa9deb498dfe9288e5b605e118a7026d422b5e425d1f2c3286554f09772d2b3206295ff2431228f5f91d14e226dd9e0cb04890fe4d2c696579d0d9043e46866513a2397a33cd520d75eb4e8c7eec49594656030d632052d83db95d9dfd97053a1eedf016aabbb0d269b2d0da9b4fbdaf2794ca3c2f50bc900000004cbb09e472e8236198128eded5c752cf9e1a45066082af98c12e06a15be5f6c23c13119f1dced1cca8de01c5de7fd6d00c1cbaa077cf38799bb718f14f3a276d1e99465ba276a549993730dbae0975327b2dff9f62945167a8f1496d666980f418e919526cab08a8c38c4ed77ed6c51b7e10f884b57160389001072b445cef1833fbdc539e2d56a5143438da7e1ee3333a1db668a77a7a52accd06e7cb7e92d4e2d1e3ae026b6320601d4d487e4441a5";

test("golden vector v2: deterministic regeneration matches frozen bytes", async () => {
  const rng = seededRandomBytes(0xc0ffee2);
  const res = await createVault(GOLDEN_PASSWORD, 3, 5, rng, 1755600000, { separateOwnerKey: true });
  assert.equal(toHex(res.bytes), GOLDEN2_BYTES_HEX);
  assert.deepEqual(res.cards, GOLDEN2_CARDS);
  assert.equal(res.ownerKey, GOLDEN2_OWNER_KEY);
  assert.equal(res.setIdHex, "0EDF");
  assert.equal(res.fingerprint, "3A1DB668");
});

test("golden vector v2: recovery needs owner key + any 3 cards", async () => {
  const vault = await parseVault(fromHex(GOLDEN2_BYTES_HEX));
  assert.equal(vault.version, 2);
  assert.equal(vault.needsOwnerKey, true);
  assert.equal(vault.kApp, null);
  const owner = decodeOwnerKey(GOLDEN2_OWNER_KEY);
  const decoded = GOLDEN2_CARDS.map((c) => decodeCard(c));
  for (const combo of combinations(decoded, 3)) {
    assert.equal(await recoverPassword(vault, combo, owner), GOLDEN_PASSWORD);
  }
  // the same cards without the owner key must be refused before any decrypt
  await assert.rejects(
    () => recoverPassword(vault, decoded.slice(0, 3)),
    (e) => e instanceof VaultError && e.code === "NEED_OWNER_KEY"
  );
});

test("v2 negatives: foreign owner key, tampered commitment, v1/v2 confusion", async () => {
  const vault = await parseVault(fromHex(GOLDEN2_BYTES_HEX));
  const decoded = GOLDEN2_CARDS.map((c) => decodeCard(c)).slice(0, 3);

  // an owner key from another ceremony carries another set id
  const other = await createVault("x", 3, 5, randomBytes, 1, { separateOwnerKey: true });
  await assert.rejects(
    () => recoverPassword(vault, decoded, decodeOwnerKey(other.ownerKey)),
    (e) => e.code === "OWNER_SET_MISMATCH"
  );

  // same set id, wrong key bytes -> named as not belonging, before decrypt
  const forged = decodeOwnerKey(GOLDEN2_OWNER_KEY);
  forged.kApp[0] ^= 0xff;
  await assert.rejects(
    () => recoverPassword(vault, decoded, forged),
    (e) => e.code === "OWNER_KEY_MISMATCH"
  );

  // handing an owner key to a v1 vault is refused by name
  const v1 = await parseVault(fromHex(GOLDEN_BYTES_HEX));
  await assert.rejects(
    () => recoverPassword(v1, GOLDEN_CARDS.slice(0, 3).map((c) => decodeCard(c)),
      decodeOwnerKey(GOLDEN2_OWNER_KEY)),
    (e) => e.code === "OWNER_NOT_NEEDED"
  );

  // a v2 vault rewritten as v1 (digest fixed) dies on the authenticated AAD:
  // the attacker-controlled version byte cannot downgrade the format
  const evil = fromHex(GOLDEN2_BYTES_HEX);
  evil[8] = 0x01;
  const body = evil.slice(0, evil.length - 32);
  evil.set(await sha256(body), evil.length - 32);
  const downgraded = await parseVault(evil);
  assert.equal(downgraded.version, 1);
  await assert.rejects(
    () => recoverPassword(downgraded, decoded),
    (e) => e.code === "AEAD_FAIL"
  );
});

test("v2 minimal schemes: 1-of-1 and 1-of-2 allowed with the owner's key, v1 refuses them", async () => {
  for (const [k, n] of [[1, 1], [1, 2], [2, 2]]) {
    const res = await createVault(`tiny-${k}-${n}`, k, n, randomBytes, 1, { separateOwnerKey: true });
    const vault = await parseVault(res.bytes);
    const owner = decodeOwnerKey(res.ownerKey);
    const decoded = res.cards.map((c) => decodeCard(c));
    for (let i = 0; i + k <= n; i++) {
      assert.equal(
        await recoverPassword(vault, decoded.slice(i, i + k), owner),
        `tiny-${k}-${n}`
      );
    }
    // the owner's key is still required, even holding every card
    await assert.rejects(
      () => recoverPassword(vault, decoded.slice(0, k)),
      (e) => e.code === "NEED_OWNER_KEY"
    );
    // rotation works at the same minimal threshold
    const rotated = await rotateVault(vault, decoded.slice(0, k), "next", randomBytes, 2, owner);
    assert.equal(await recoverPassword(await parseVault(rotated.bytes), decoded.slice(0, k), owner), "next");
  }
  // without a separate owner's key the 2-of-2 floor stands
  await assert.rejects(
    () => createVault("x", 1, 1, randomBytes, 0),
    (e) => e instanceof VaultError && e.code === "BAD_PARAMS"
  );
  await assert.rejects(
    () => createVault("x", 1, 2, randomBytes, 0),
    (e) => e instanceof VaultError && e.code === "BAD_PARAMS"
  );
});

test("v2 rotation: owner key required, same owner key and cards stay valid", async () => {
  const vault = await parseVault(fromHex(GOLDEN2_BYTES_HEX));
  const owner = decodeOwnerKey(GOLDEN2_OWNER_KEY);
  const decoded = GOLDEN2_CARDS.map((c) => decodeCard(c));

  await assert.rejects(
    () => rotateVault(vault, decoded.slice(0, 3), "new", randomBytes, 2),
    (e) => e.code === "NEED_OWNER_KEY"
  );

  const rotated = await rotateVault(
    vault, [decoded[0], decoded[2], decoded[4]], "brand-new-password",
    randomBytes, 1760000000, owner
  );
  assert.equal(rotated.setIdHex, "0EDF");
  assert.notEqual(rotated.fingerprint, "3A1DB668");
  const v2 = await parseVault(rotated.bytes);
  assert.equal(v2.version, 2);
  assert.equal(v2.needsOwnerKey, true);
  assert.equal(
    await recoverPassword(v2, [decoded[1], decoded[3], decoded[4]], owner),
    "brand-new-password"
  );
});

test("compatibility declaration: exactly the frozen formats; a newer one is refused up front", async () => {
  // the upgrade path acts on this list — growing it is a deliberate,
  // reviewed decision, never a side effect
  assert.deepEqual(SUPPORTED_FORMAT_VERSIONS, [FORMAT_VERSION, FORMAT_VERSION_OWNER_KEY]);
  assert.deepEqual(SUPPORTED_FORMAT_VERSIONS, [1, 2]);
  // a version this build does not declare is refused before any other
  // check, so the upgrade screen can name the problem precisely
  const future = fromHex(GOLDEN_BYTES_HEX);
  future[8] = 3;
  await assert.rejects(
    () => parseVault(future),
    (e) => e instanceof VaultError && e.code === "BAD_VERSION"
  );
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
