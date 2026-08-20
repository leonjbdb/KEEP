// Share card encoding: bech32m (BIP-350) with HRP "psr".
//
// Card payload before 5-bit conversion:
//   version symbol (5-bit value 1, kept outside the byte payload)
//   bytes: index (1) || set_id (2) || share_y (32)  = 35 bytes
// 35 bytes -> 56 five-bit symbols exactly. Full string:
//   "psr" "1" <version:1><payload:56><checksum:6>  = 67 characters.
// The BCH checksum guarantees detection of any error touching up to 4
// characters at this length, and misses worse corruption with
// probability ~2^-30.

export const HRP = "psr";
export const CARD_VERSION = 1;
export const CARD_LENGTH = 67;
export const SHARE_LEN = 32;

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST = 0x2bc830a3;
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export class CardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CardError";
    this.code = code; // BAD_CHARSET | BAD_CHECKSUM | BAD_HRP | BAD_VERSION | BAD_LENGTH
  }
}

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= GEN[i];
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function createChecksum(hrp, data) {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ BECH32M_CONST;
  const out = [];
  for (let i = 0; i < 6; i++) out.push((mod >>> (5 * (5 - i))) & 31);
  return out;
}

function verifyChecksum(hrp, data) {
  return polymod([...hrpExpand(hrp), ...data]) === BECH32M_CONST;
}

/** General bech32m encode (exported for test vectors). */
export function bech32mEncode(hrp, data) {
  const combined = [...data, ...createChecksum(hrp, data)];
  return hrp + "1" + combined.map((d) => CHARSET.charAt(d)).join("");
}

/** General bech32m decode -> { hrp, data } (checksum stripped). Throws CardError. */
export function bech32mDecode(str) {
  const pos = str.lastIndexOf("1");
  if (pos < 1 || pos + 7 > str.length) {
    throw new CardError("BAD_LENGTH", "not a valid code: missing or misplaced separator");
  }
  const hrp = str.slice(0, pos);
  const data = [];
  for (const ch of str.slice(pos + 1)) {
    const d = CHARSET.indexOf(ch);
    if (d === -1) throw new CardError("BAD_CHARSET", `invalid character "${ch}"`);
    data.push(d);
  }
  if (!verifyChecksum(hrp, data)) {
    throw new CardError("BAD_CHECKSUM", "checksum mismatch, there is a typo somewhere");
  }
  return { hrp, data: data.slice(0, -6) };
}

/** Convert between bit group sizes (BIP-173 reference semantics). */
export function convertBits(data, from, to, pad) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) throw new CardError("BAD_CHARSET", "invalid data value");
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    throw new CardError("BAD_LENGTH", "invalid padding in data");
  }
  return out;
}

/** Encode one share card. setId: Uint8Array(2), shareY: Uint8Array(32). */
export function encodeCard(index, setId, shareY) {
  if (!Number.isInteger(index) || index < 1 || index > 255) {
    throw new RangeError("key index must be 1..255");
  }
  if (setId.length !== 2 || shareY.length !== SHARE_LEN) {
    throw new RangeError("bad setId or share length");
  }
  const payload = new Uint8Array(1 + 2 + SHARE_LEN);
  payload[0] = index;
  payload.set(setId, 1);
  payload.set(shareY, 3);
  const data = [CARD_VERSION, ...convertBits(payload, 8, 5, true)];
  const s = bech32mEncode(HRP, data);
  if (s.length !== CARD_LENGTH) throw new Error(`internal: key length ${s.length}`);
  // canonical form is uppercase — the same form the card is written in
  // (bech32m allows either case; the checksum math runs over lowercase)
  return s.toUpperCase();
}

/**
 * Normalize handwritten input: strip separators/whitespace, uppercase
 * (the canonical form). Mixed case is accepted (normalized) — friendlier
 * for hand-typed entry, and the checksum still validates the result. The
 * letter "o" is not in the bech32 charset, so any o/O typed is a misread
 * zero: map it to "0".
 */
export function normalizeCardInput(raw) {
  return raw.replace(/[\s\-.·_]/g, "").toUpperCase().replace(/O/g, "0");
}

/** Decode one card string -> { version, index, setId, shareY }. Throws CardError. */
export function decodeCard(raw) {
  const str = normalizeCardInput(raw);
  if (str.length !== CARD_LENGTH) {
    throw new CardError(
      "BAD_LENGTH",
      `a key code is exactly ${CARD_LENGTH} characters, got ${str.length}`
    );
  }
  // bech32m arithmetic is defined over the lowercase charset
  const { hrp, data } = bech32mDecode(str.toLowerCase());
  if (hrp !== HRP) throw new CardError("BAD_HRP", `expected a "${HRP}" key code`);
  if (data.length === 0 || data[0] !== CARD_VERSION) {
    throw new CardError("BAD_VERSION", "unknown key version. Is this from a newer kit?");
  }
  const payload = Uint8Array.from(convertBits(data.slice(1), 5, 8, false));
  if (payload.length !== 1 + 2 + SHARE_LEN) {
    throw new CardError("BAD_LENGTH", "key payload has the wrong size");
  }
  return {
    version: CARD_VERSION,
    index: payload[0],
    setId: payload.slice(1, 3),
    shareY: payload.slice(3),
  };
}

/**
 * Display form: "PSR1 XXXX XXXX ..." — the canonical uppercase string in
 * groups of 4 after the prefix. Uppercase removes the l/1/I lookalikes
 * when handwritten, and the charset has no O, no I and no B, so the only
 * letter-vs-digit pair left is 0 (always the digit — input maps O back
 * to 0). Decode tolerates any case and grouping.
 */
export function formatCardForDisplay(card) {
  const s = card.toUpperCase();
  const head = s.slice(0, 4);
  const rest = s.slice(4);
  const groups = [];
  for (let i = 0; i < rest.length; i += 4) groups.push(rest.slice(i, i + 4));
  return [head, ...groups].join(" ");
}
