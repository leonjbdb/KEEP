// Deterministic byte stream for known-answer tests. xorshift32 is
// platform-stable in JS (all ops are exact 32-bit); NEVER use outside
// tests — production randomness is crypto.getRandomValues only.

export function seededRandomBytes(seed) {
  let s = seed >>> 0;
  if (s === 0) s = 0xdeadbeef;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
  return (len) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i += 4) {
      const v = next();
      out[i] = v & 0xff;
      if (i + 1 < len) out[i + 1] = (v >>> 8) & 0xff;
      if (i + 2 < len) out[i + 2] = (v >>> 16) & 0xff;
      if (i + 3 < len) out[i + 3] = (v >>> 24) & 0xff;
    }
    return out;
  };
}

export function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map((c) => [head, ...c]),
    ...combinations(rest, k),
  ];
}
