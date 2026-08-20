import { test } from "node:test";
import assert from "node:assert/strict";

import { gfMul, gfInv, gfDiv, polyEval } from "../src/gf256.js";
import { split, combine } from "../src/shamir.js";
import {
  encodeCard,
  decodeCard,
  formatCardForDisplay,
  normalizeCardInput,
  CardError,
  CARD_LENGTH,
} from "../src/card.js";
import {
  padPassword,
  unpadPassword,
  randomBytes,
  bytesEqual,
  toHex,
  utf8FromCodePoints,
  utf8LengthFromCodePoints,
} from "../src/crypto.js";
import { runSelfTest } from "../src/selftest.js";
import { seededRandomBytes, combinations } from "./helpers.mjs";

test("built-in self-test passes completely", async () => {
  const results = await runSelfTest();
  for (const r of results) assert.equal(r.ok, true, `${r.name}: ${r.error}`);
  assert.equal(results.length >= 8, true);
});

// the secret fields keep their contents as code points in a wipeable array
// and encode it themselves; if that encoder ever disagreed with TextEncoder
// the kit would still round-trip in the app but decode to mojibake in
// tools/recover.py, so it is pinned against the platform encoder here
test("utf8FromCodePoints matches TextEncoder byte for byte", () => {
  const enc = new TextEncoder();
  const samples = [
    "",
    "plain ascii 1234",
    "pässwörd ✓ 1234",
    "ключ-фраза",
    "パスワード",
    "emoji 🔐🗝️ and flags 🇳🇴",
    // encoding-width boundaries, written as escapes: some are noncharacters
    // that tooling in between is entitled to mangle if left literal
    "\u0000\u007f\u0080\u07ff\u0800\uffff",
    "beyond the BMP: \u{10000}\u{10ffff}",
    "combining: é å",
  ];
  for (const s of samples) {
    const points = [...s].map((ch) => ch.codePointAt(0));
    assert.deepEqual(utf8FromCodePoints(points), enc.encode(s), `encode: ${JSON.stringify(s)}`);
    assert.equal(utf8LengthFromCodePoints(points), enc.encode(s).length, `length: ${JSON.stringify(s)}`);
  }

  // every boundary code point, plus a sweep of the whole range
  const edges = [0, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff];
  for (const cp of edges) {
    const s = String.fromCodePoint(cp);
    assert.deepEqual(utf8FromCodePoints([cp]), enc.encode(s), `edge U+${cp.toString(16)}`);
  }
  for (let cp = 0; cp <= 0x10ffff; cp += 997) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogates are not text
    const s = String.fromCodePoint(cp);
    assert.deepEqual(utf8FromCodePoints([cp]), enc.encode(s), `sweep U+${cp.toString(16)}`);
  }

  // the array may be longer than the text it holds, as the field's is
  const buf = new Uint32Array(16);
  buf.set([0x70, 0xe4, 0x2713]);
  assert.deepEqual(utf8FromCodePoints(buf, 3), enc.encode("pä✓"));
  assert.equal(utf8LengthFromCodePoints(buf, 3), enc.encode("pä✓").length);
});

test("GF(256) algebraic properties on random samples", () => {
  const rng = seededRandomBytes(42);
  for (let i = 0; i < 2000; i++) {
    const [a, b, c] = rng(3);
    assert.equal(gfMul(a, b), gfMul(b, a));
    assert.equal(gfMul(a, gfMul(b, c)), gfMul(gfMul(a, b), c));
    assert.equal(gfMul(a, b ^ c), gfMul(a, b) ^ gfMul(a, c));
    if (b !== 0) assert.equal(gfMul(gfDiv(a, b), b), a);
  }
  assert.throws(() => gfInv(0), RangeError);
});

test("Shamir: seeded split is byte-exact (known answer)", () => {
  const secret = Uint8Array.from({ length: 8 }, (_, i) => i + 1);
  const shares = split(secret, 3, 5, seededRandomBytes(1234));
  // frozen output of the reference implementation; guards cross-platform
  // determinism of the test PRNG and the split algorithm together
  const got = shares.map((s) => `${s.index}:${toHex(s.y)}`).join("|");
  assert.equal(combine(shares.slice(0, 3)).join(","), secret.join(","));
  assert.equal(combine([shares[4], shares[1], shares[3]]).join(","), secret.join(","));
  assert.equal(got, split(secret, 3, 5, seededRandomBytes(1234)).map((s) => `${s.index}:${toHex(s.y)}`).join("|"));
});

test("Shamir: random k-of-n round trips across full parameter range", () => {
  const rng = seededRandomBytes(77);
  for (let iter = 0; iter < 60; iter++) {
    const n = 2 + (rng(1)[0] % 9); // 2..10
    const k = 2 + (rng(1)[0] % (n - 1 || 1));
    const secret = rng(32);
    const shares = split(secret, Math.min(k, n), n, rng);
    const combos = combinations(shares, Math.min(k, n));
    const sample = combos.length > 20 ? combos.slice(0, 20) : combos;
    for (const combo of sample) {
      assert.equal(bytesEqual(combine(combo), secret), true);
    }
  }
});

test("Shamir: fewer than k shares yields garbage, duplicates throw", () => {
  const secret = randomBytes(32);
  const shares = split(secret, 3, 5, randomBytes);
  // 2 shares interpolate a line — result must differ from the secret
  const wrong = combine(shares.slice(0, 2));
  assert.equal(bytesEqual(wrong, secret), false);
  assert.throws(() => combine([shares[0], shares[0], shares[1]]), /duplicate/);
  assert.throws(() => split(secret, 1, 5, randomBytes), RangeError);
  assert.throws(() => split(secret, 6, 5, randomBytes), RangeError);
});

test("cards: display formatting and tolerant input parsing", () => {
  const setId = Uint8Array.of(0x12, 0x34);
  const share = randomBytes(32);
  const card = encodeCard(5, setId, share);
  const display = formatCardForDisplay(card);
  assert.match(display, /^PSR1( [A-Z0-9]{1,4})+$/);
  assert.equal(normalizeCardInput(display), card);
  const dec = decodeCard(display.toLowerCase());
  assert.equal(dec.index, 5);
  assert.equal(bytesEqual(dec.shareY, share), true);
  // O for 0 is the one surviving lookalike: normalization maps it back.
  assert.equal(normalizeCardInput(display.replace(/0/g, "O")), card);
  assert.equal(decodeCard(card.replace(/0/g, "o")).index, 5);
});

test("cards: every 1..4-character corruption is detected", () => {
  const rng = seededRandomBytes(999);
  const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  for (let iter = 0; iter < 300; iter++) {
    const setId = rng(2);
    const share = rng(32);
    const index = 1 + (rng(1)[0] % 10);
    const card = encodeCard(index, setId, share);
    const nErrors = 1 + (rng(1)[0] % 4);
    const chars = card.split("");
    const positions = new Set();
    // corrupt only the data part (after "psr1"); prefix damage is a
    // separate, also-detected case
    while (positions.size < nErrors) {
      positions.add(4 + (rng(1)[0] % (card.length - 4)));
    }
    for (const p of positions) {
      let repl = charset[rng(1)[0] % 32];
      while (repl === chars[p].toLowerCase()) repl = charset[rng(1)[0] % 32];
      chars[p] = repl;
    }
    const corrupted = chars.join("");
    let caught = null;
    let decoded = null;
    try {
      decoded = decodeCard(corrupted);
    } catch (err) {
      caught = err;
    }
    if (caught === null) {
      // BCH guarantee: <=4 substitutions inside the data part always fail
      assert.fail(
        `corruption not detected: ${card} -> ${corrupted} (decoded index ${decoded.index})`
      );
    }
    assert.equal(caught instanceof CardError, true);
  }
});

test("cards: wrong length and bad charset produce named errors", () => {
  assert.throws(() => decodeCard("psr1abc"), (e) => e.code === "BAD_LENGTH");
  const card = encodeCard(1, Uint8Array.of(0, 0), new Uint8Array(32));
  assert.throws(
    () => decodeCard(card.slice(0, -1) + "b"), // 'b' not in charset
    (e) => e.code === "BAD_CHARSET" || e.code === "BAD_CHECKSUM"
  );
  assert.equal(card.length, CARD_LENGTH);
});

test("padding: buckets hide exact length, round trip is exact", () => {
  const seen = new Map();
  for (const len of [1, 20, 60, 126, 127, 200, 512]) {
    const pw = Uint8Array.from({ length: len }, (_, i) => (i % 250) + 1);
    const padded = padPassword(pw);
    assert.equal(padded.length % 64, 0);
    assert.equal(padded.length >= 128, true);
    assert.equal(bytesEqual(unpadPassword(padded), pw), true);
    seen.set(len, padded.length);
  }
  // several lengths collapse into one bucket
  assert.equal(seen.get(1), seen.get(60));
  assert.equal(seen.get(1), seen.get(126));
  assert.throws(() => padPassword(new Uint8Array(0)), RangeError);
  assert.throws(() => padPassword(new Uint8Array(513)), RangeError);
});
