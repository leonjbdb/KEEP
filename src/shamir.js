// Shamir secret sharing over GF(256), byte-wise: one independent
// degree-(k-1) polynomial per secret byte, share x-coordinate = card
// index 1..n. Any k shares interpolate the secret; k-1 shares carry
// zero information (each unknown coefficient is uniform random).

import { polyEval, interpolateAtZero } from "./gf256.js";

export const MIN_K = 2;
export const MAX_N = 255;

/**
 * Split `secret` into n shares with threshold k.
 * randomBytes(len) -> Uint8Array supplies polynomial coefficients;
 * production passes crypto.getRandomValues-backed bytes, tests may
 * pass a seeded generator (determinism for known-answer vectors).
 * Returns [{ index, y: Uint8Array }] with index 1..n.
 */
export function split(secret, k, n, randomBytes) {
  if (!(secret instanceof Uint8Array) || secret.length === 0) {
    throw new TypeError("secret must be a non-empty Uint8Array");
  }
  if (!Number.isInteger(k) || !Number.isInteger(n)) {
    throw new TypeError("k and n must be integers");
  }
  if (k < MIN_K) throw new RangeError(`threshold k must be >= ${MIN_K}`);
  if (n < k) throw new RangeError("n must be >= k");
  if (n > MAX_N) throw new RangeError(`n must be <= ${MAX_N}`);

  // coefficients a_1..a_{k-1} for every secret byte, drawn up front
  const coefBytes = randomBytes(secret.length * (k - 1));
  if (!(coefBytes instanceof Uint8Array) || coefBytes.length !== secret.length * (k - 1)) {
    throw new TypeError("randomBytes returned wrong length");
  }

  const shares = [];
  for (let x = 1; x <= n; x++) {
    shares.push({ index: x, y: new Uint8Array(secret.length) });
  }
  const coeffs = new Uint8Array(k);
  for (let b = 0; b < secret.length; b++) {
    coeffs[0] = secret[b];
    for (let c = 1; c < k; c++) {
      coeffs[c] = coefBytes[b * (k - 1) + (c - 1)];
    }
    for (const share of shares) {
      share.y[b] = polyEval(coeffs, share.index);
    }
  }
  coeffs.fill(0);
  coefBytes.fill(0);
  return shares;
}

/**
 * Combine exactly k shares [{ index, y }] back into the secret.
 * Caller is responsible for passing precisely the threshold count;
 * duplicate or out-of-range indices throw.
 */
export function combine(shares) {
  if (!Array.isArray(shares) || shares.length < MIN_K) {
    throw new RangeError(`need at least ${MIN_K} shares`);
  }
  const seen = new Set();
  const len = shares[0].y.length;
  for (const s of shares) {
    if (!Number.isInteger(s.index) || s.index < 1 || s.index > MAX_N) {
      throw new RangeError(`share index ${s.index} out of range`);
    }
    if (seen.has(s.index)) throw new RangeError(`duplicate share index ${s.index}`);
    seen.add(s.index);
    if (!(s.y instanceof Uint8Array) || s.y.length !== len) {
      throw new TypeError("shares have mismatched lengths");
    }
  }
  const xs = shares.map((s) => s.index);
  const secret = new Uint8Array(len);
  const ys = new Array(shares.length);
  for (let b = 0; b < len; b++) {
    for (let i = 0; i < shares.length; i++) ys[i] = shares[i].y[b];
    secret[b] = interpolateAtZero(xs, ys);
  }
  return secret;
}
