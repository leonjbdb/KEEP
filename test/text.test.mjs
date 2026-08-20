import { test } from "node:test";
import assert from "node:assert/strict";

import { wipeableText } from "../src/text.js";

// The secret fields drive this buffer from DOM edit events: `beforeinput`
// gives a range and the text going into it, which is exactly splice(). The
// cases below mirror what the browser produces — typing, pasting, deleting
// backwards and forwards, and replacing a selection — including across
// astral characters, where a UTF-16 mistake would corrupt the secret.

const enc = new TextEncoder();

function typed(text) {
  const buf = wipeableText();
  buf.splice(0, 0, text);
  return buf;
}

test("insert, append and paste build the expected text", () => {
  const buf = wipeableText();
  assert.equal(buf.length, 0);
  assert.equal(buf.reveal(), "");

  assert.equal(buf.splice(0, 0, "hello"), 5);
  buf.splice(5, 5, " world");
  buf.splice(0, 0, ">> ");
  assert.equal(buf.reveal(), ">> hello world");
  assert.equal(buf.length, 14);
});

test("delete backwards, forwards and by selection", () => {
  const buf = typed("abcdef");

  buf.splice(5, 6, "");          // backspace at the end
  assert.equal(buf.reveal(), "abcde");

  buf.splice(0, 1, "");          // forward-delete at the start
  assert.equal(buf.reveal(), "bcde");

  buf.splice(1, 3, "");          // delete a selected run
  assert.equal(buf.reveal(), "be");

  buf.splice(0, buf.length, ""); // select all, delete
  assert.equal(buf.reveal(), "");
  assert.equal(buf.length, 0);
});

test("replacing a selection keeps the surrounding text", () => {
  const buf = typed("keep the middle out");
  buf.splice(5, 8, "");
  assert.equal(buf.reveal(), "keep the middle out".slice(0, 5) + "the middle out".slice(3));
});

test("astral characters count as one position throughout", () => {
  const buf = typed("pä🔐z");
  assert.equal(buf.length, 4, "one position per code point, not per UTF-16 unit");
  assert.equal(buf.charAt(2), "🔐");
  assert.deepEqual(buf.bytes(), enc.encode("pä🔐z"));
  assert.equal(buf.byteLength(), enc.encode("pä🔐z").length);

  // backspace over the emoji removes the whole character
  buf.splice(2, 3, "");
  assert.equal(buf.reveal(), "päz");

  // inserting at a caret position shifts the rest along
  buf.splice(1, 1, "🗝️");
  assert.equal(buf.reveal(), "p🗝️äz");

  // and replacing a selected character swaps just that one
  buf.splice(0, 1, "P");
  assert.equal(buf.reveal(), "P🗝️äz");
});

test("splice clamps ranges instead of corrupting the buffer", () => {
  const buf = typed("abc");
  buf.splice(99, 200, "!");
  assert.equal(buf.reveal(), "abc!");
  buf.splice(-5, 1, "");
  assert.equal(buf.reveal(), "bc!");
});

test("growing past the initial capacity preserves the text", () => {
  const buf = wipeableText();
  const long = "ü".repeat(500);
  for (const ch of long) buf.splice(buf.length, buf.length, ch);
  assert.equal(buf.length, 500);
  assert.equal(buf.reveal(), long);
  assert.deepEqual(buf.bytes(), enc.encode(long));
});

test("equals compares content, never identity or length alone", () => {
  const a = typed("pässwörd 🔐");
  const b = typed("pässwörd 🔐");
  const c = typed("pässwörd 🔑");
  const d = typed("pässwörd 🔐 ");
  assert.equal(a.equals(b), true);
  assert.equal(a.equals(c), false);
  assert.equal(a.equals(d), false);
  assert.equal(a.equals(typed("")), false);
});

test("setFrom replaces the whole value", () => {
  const buf = typed("first value");
  buf.setFrom("second");
  assert.equal(buf.reveal(), "second");
  assert.equal(buf.length, 6);
});

test("clear zeroes the backing store, not just the length", () => {
  const buf = typed("secret text");
  const store = buf._storage();
  assert.equal(store.some((cp) => cp !== 0), true);

  buf.clear();
  assert.equal(buf.length, 0);
  assert.equal(buf.reveal(), "");
  assert.equal(store.every((cp) => cp === 0), true, "cleared text must not survive in the array");
});

test("shortening leaves no tail of the old value behind", () => {
  const buf = typed("a long secret value");
  const store = buf._storage();
  buf.splice(1, buf.length, "");
  assert.equal(buf.reveal(), "a");
  assert.equal(store.slice(1).every((cp) => cp === 0), true, "trimmed text must be zeroed");
});

test("growing wipes the array it grew out of", () => {
  const buf = wipeableText();
  buf.splice(0, 0, "x".repeat(64)); // exactly fills the initial capacity
  const first = buf._storage();
  buf.splice(64, 64, "y");          // forces a bigger array
  assert.notEqual(buf._storage(), first);
  assert.equal(first.every((cp) => cp === 0), true, "the outgrown array still held the secret");
});
