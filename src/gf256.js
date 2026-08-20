// GF(2^8) arithmetic over the AES field, reduction polynomial
// x^8 + x^4 + x^3 + x + 1 (0x11B). No lookup tables: the branchless
// Russian-peasant multiply below is the whole audit surface.

/** Multiply two field elements. */
export function gfMul(a, b) {
  a &= 0xff;
  b &= 0xff;
  let p = 0;
  for (let i = 0; i < 8; i++) {
    p ^= -(b & 1) & a;
    const hi = -((a >> 7) & 1);
    a = (a << 1) & 0xff;
    a ^= hi & 0x1b;
    b >>= 1;
  }
  return p & 0xff;
}

/** a^e by square-and-multiply. */
export function gfPow(a, e) {
  let r = 1;
  let base = a & 0xff;
  while (e > 0) {
    if (e & 1) r = gfMul(r, base);
    base = gfMul(base, base);
    e >>= 1;
  }
  return r;
}

/** Multiplicative inverse; a^254 = a^-1 in GF(256). Throws on 0. */
export function gfInv(a) {
  if ((a & 0xff) === 0) throw new RangeError("gfInv(0) is undefined");
  return gfPow(a, 254);
}

/** Divide a by b. */
export function gfDiv(a, b) {
  return gfMul(a, gfInv(b));
}

/**
 * Evaluate a polynomial (coefficients low-degree first) at x via Horner.
 * coeffs[0] is the constant term (the secret byte).
 */
export function polyEval(coeffs, x) {
  let y = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    y = gfMul(y, x) ^ coeffs[i];
  }
  return y & 0xff;
}

/**
 * Lagrange interpolation at x = 0 for points (xs[i], ys[i]).
 * Returns the constant term of the unique degree-(len-1) polynomial.
 * xs must be nonzero and pairwise distinct.
 */
export function interpolateAtZero(xs, ys) {
  const n = xs.length;
  let secret = 0;
  for (let i = 0; i < n; i++) {
    let num = 1;
    let den = 1;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      num = gfMul(num, xs[j]);
      den = gfMul(den, xs[j] ^ xs[i]);
    }
    secret ^= gfMul(ys[i], gfDiv(num, den));
  }
  return secret & 0xff;
}
