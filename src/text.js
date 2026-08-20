// A text buffer that can be erased. The secret fields hold what was typed
// here rather than in a JS string: strings are immutable, so every edit
// leaves the previous value stranded in the heap until the collector gets
// to it, and nothing in the language can overwrite it in the meantime. A
// typed array can be zeroed the moment the value is no longer needed.
//
// Indices are code points throughout, which is also what the masked field
// renders one bullet per — so caret offsets coming back from the DOM line
// up with positions in here even when the text contains astral characters.

import { utf8FromCodePoints, utf8LengthFromCodePoints } from "./crypto.js";

/** Code points of `text`, as numbers — no per-character strings. */
function codePoints(text) {
  const out = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    out.push(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return out;
}

export function wipeableText() {
  let buf = new Uint32Array(64);
  let len = 0;

  function grow(needed) {
    if (needed <= buf.length) return;
    let cap = buf.length;
    while (cap < needed) cap *= 2;
    const next = new Uint32Array(cap);
    next.set(buf.subarray(0, len));
    buf.fill(0); // the old storage held the secret; don't leave it behind
    buf = next;
  }

  return {
    get length() { return len; },

    /** Replace [start, end) with `text`; returns how many code points went in. */
    splice(start, end, text) {
      const from = Math.max(0, Math.min(start, len));
      const to = Math.max(from, Math.min(end, len));
      const ins = text ? codePoints(text) : [];
      const tail = len - to;
      grow(from + ins.length + tail);
      buf.copyWithin(from + ins.length, to, len);
      for (let i = 0; i < ins.length; i++) buf[from + i] = ins[i];
      const wasLen = len;
      len = from + ins.length + tail;
      if (len < wasLen) buf.fill(0, len, wasLen);
      return ins.length;
    },

    setFrom(text) {
      this.clear();
      this.splice(0, 0, text);
    },

    /** One character, for the brief peek at what was just typed. */
    charAt(i) { return String.fromCodePoint(buf[i]); },

    /** UTF-8 bytes, encoded straight from code points so the plaintext
     *  never passes through a string on its way to the cipher. */
    bytes() { return utf8FromCodePoints(buf, len); },
    byteLength() { return utf8LengthFromCodePoints(buf, len); },

    /** Compare without materialising either value. */
    equals(other) {
      if (len !== other.length) return false;
      let diff = 0;
      for (let i = 0; i < len; i++) diff |= buf[i] ^ other.codePointAt(i);
      return diff === 0;
    },
    codePointAt(i) { return buf[i]; },

    /** Only for the SHOW toggle and IME composition, where the browser has
     *  to be handed a string anyway. */
    reveal() { return len ? String.fromCodePoint(...buf.subarray(0, len)) : ""; },

    clear() {
      buf.fill(0);
      len = 0;
    },

    /** Test seam: the backing store, to check that clearing really erases. */
    _storage() { return buf; },
  };
}
