// Built-in self-test: known-answer tests for every primitive plus a
// full split -> encode -> decode -> combine -> decrypt round trip.
// Runs identically under node:test and behind the app's Self-test view;
// the letter tells recoverers to run it before anything else.

import { gfMul, gfInv, polyEval } from "./gf256.js";
import { split, combine } from "./shamir.js";
import {
  encodeCard,
  decodeCard,
  bech32mEncode,
  bech32mDecode,
  CARD_LENGTH,
} from "./card.js";
import {
  sha256,
  hkdfSha256,
  aesGcmSeal,
  randomBytes,
  toHex,
  fromHex,
  bytesEqual,
} from "./crypto.js";
import { createVault, parseVault, recoverPassword } from "./vault.js";

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map((c) => [head, ...c]),
    ...combinations(rest, k),
  ];
}

const CHECKS = [
  {
    name: "GF(256) Field Arithmetic",
    detail: "AES-field products and inverses match known answers",
    async run() {
      // classic AES-field products and inverses
      if (gfMul(0x53, 0xca) !== 0x01) throw new Error("0x53*0xCA != 1");
      if (gfMul(0x57, 0x83) !== 0xc1) throw new Error("0x57*0x83 != 0xC1");
      if (gfInv(0x53) !== 0xca) throw new Error("inv(0x53) != 0xCA");
      for (let a = 1; a < 256; a++) {
        if (gfMul(a, gfInv(a)) !== 1) throw new Error(`a*inv(a) != 1 for a=${a}`);
      }
      if (polyEval([5, 3, 2], 0) !== 5) throw new Error("polyEval constant term");
    },
  },
  {
    name: "SHA-256 Known Answer",
    detail: "SHA-256 of \"abc\" matches the published digest",
    async run() {
      const d = await sha256(new TextEncoder().encode("abc"));
      const want = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
      if (toHex(d) !== want) throw new Error("SHA-256(abc) mismatch");
    },
  },
  {
    name: "HKDF-SHA256 RFC 5869 Test Case 1",
    detail: "Key derivation matches the RFC test vector",
    async run() {
      const okm = await hkdfSha256(
        fromHex("0b".repeat(22)),
        fromHex("000102030405060708090a0b0c"),
        fromHex("f0f1f2f3f4f5f6f7f8f9"),
        42
      );
      const want =
        "3cb25f25faacd57a90434f64d0362f2a" +
        "2d2d0a90cf1a5a4c5db02d56ecc4c5bf" +
        "34007208d5b887185865";
      if (toHex(okm) !== want) throw new Error("HKDF OKM mismatch");
    },
  },
  {
    name: "AES-256-GCM NIST Known Answer",
    detail: "Encryption matches the NIST vector",
    async run() {
      const out = await aesGcmSeal(
        new Uint8Array(32),
        new Uint8Array(12),
        new Uint8Array(0),
        new Uint8Array(16)
      );
      const want =
        "cea7403d4d606b6e074ec5d3baf39d18" + "d0d1c8a799996bf0265b98b5d48ab919";
      if (toHex(out) !== want) throw new Error("AES-GCM vector mismatch");
    },
  },
  {
    name: "Bech32m BIP-350 Vectors",
    detail: "Reference codes round-trip; a corrupted one is rejected",
    async run() {
      const valid = [
        "a1lqfn3a",
        "abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx",
        "split1checkupstagehandshakeupstreamerranterredcaperredlc445v",
      ];
      for (const v of valid) {
        const { hrp, data } = bech32mDecode(v);
        if (bech32mEncode(hrp, data) !== v) throw new Error(`re-encode mismatch for ${v}`);
      }
      let threw = false;
      try {
        bech32mDecode("a1lqfn33"); // corrupted last char
      } catch {
        threw = true;
      }
      if (!threw) throw new Error("corrupted string accepted");
    },
  },
  {
    name: "Key Encode/Decode Round Trip",
    detail: "A key survives upper case and added spaces",
    async run() {
      const setId = Uint8Array.of(0xa7, 0xf2);
      const share = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
      const key = encodeCard(3, setId, share);
      if (key.length !== CARD_LENGTH) throw new Error(`key length ${key.length}`);
      const dec = decodeCard(key.toUpperCase().replace(/(.{4})/g, "$1 "));
      if (dec.index !== 3 || !bytesEqual(dec.setId, setId) || !bytesEqual(dec.shareY, share)) {
        throw new Error("decoded key differs");
      }
    },
  },
  {
    name: "Shamir Split/Combine (3-of-5, All 10 Combos)",
    detail: "Every three-key combination returns the secret",
    async run() {
      const secret = randomBytes(32);
      const shares = split(secret, 3, 5, randomBytes);
      for (const combo of combinations(shares, 3)) {
        if (!bytesEqual(combine(combo), secret)) throw new Error("combo failed to recover");
      }
    },
  },
  {
    name: "Full Ceremony Round Trip (Dummy Secret)",
    detail: "A sample kit recovers; any two keys are refused",
    async run() {
      const password = "self-test dummy pässword ✓";
      const { bytes, cards } = await createVault(password, 3, 5, randomBytes, 1_700_000_000);
      const vault = await parseVault(bytes);
      const decoded = cards.map((c) => decodeCard(c));
      for (const combo of combinations(decoded, 3)) {
        const got = await recoverPassword(vault, combo);
        if (got !== password) throw new Error("recovered password differs");
      }
      // k-1 keys must be refused
      let refused = false;
      try {
        await recoverPassword(vault, decoded.slice(0, 2));
      } catch {
        refused = true;
      }
      if (!refused) throw new Error("k-1 keys were not refused");
    },
  },
];

/** Names and one-line descriptions, for a UI that lists the checks
 *  before they have run. Same order as the results. */
export const SELF_TEST_CHECKS = CHECKS.map((c) => ({ name: c.name, detail: c.detail }));

/**
 * Run all checks; returns [{ name, detail, ok, error, ms }]. Never throws.
 * `onResult(result, index)` is awaited after each check, so a UI can show
 * progress while the run is still going.
 */
export async function runSelfTest(onResult) {
  const results = [];
  for (let i = 0; i < CHECKS.length; i++) {
    const check = CHECKS[i];
    const started = Date.now();
    let result;
    try {
      await check.run();
      result = { name: check.name, detail: check.detail, ok: true, error: null, ms: 0 };
    } catch (err) {
      result = {
        name: check.name,
        detail: check.detail,
        ok: false,
        error: String(err?.message ?? err),
        ms: 0,
      };
    }
    result.ms = Date.now() - started;
    results.push(result);
    if (onResult) await onResult(result, i);
  }
  return results;
}
