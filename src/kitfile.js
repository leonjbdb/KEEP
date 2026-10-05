// The kit file as text. A personalized RECOVERY.html is the blank tool with
// exactly two spans swapped: the vault block's payload ("null" becomes the
// base64 vault) and the <title>. Since 1.1.0 the page is written so that the
// browser's copy of it is byte-identical to the file, which makes the swap
// reversible: undo both spans and a genuine kit turns back into the exact
// published keep.html, whose hash anyone can look up. This module owns that
// round trip and the release lookup built on it — plain text in, text out,
// so node tests reach it without a browser.
//
// Like app.js, nothing here may contain a literal script tag (it would end
// the inline script), and no string or comment may spell out the version
// declaration that claimedVersion() looks for.

import { sha256, toHex } from "./crypto.js";
import { KNOWN_RELEASES } from "./releases.js";

export const BLANK_TITLE = "KEEP — Create Recovery Kit";
export const RECOVERY_TITLE = "KEEP — Recovery";

const VAULT_BLOCK = new RegExp(
  "(<scr" + 'ipt type="application/json" id="pkr-vault">)([\\s\\S]*?)(</scr' + "ipt>)"
);
const TITLE = /<title>[^<]*<\/title>/;
const VERSION_DECLARATION = /^const APP_VERSION = "(KEEP [^"]*)";$/m;

export class KitFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KitFileError";
    this.code = code;
  }
}

function swap(source, payload, title) {
  if (!VAULT_BLOCK.test(source)) {
    throw new KitFileError("NO_VAULT_BLOCK", "This file is not a KEEP file — it has no vault block inside it.");
  }
  if (!TITLE.test(source)) {
    throw new KitFileError("NO_TITLE", "This file is not a KEEP file — it has no title.");
  }
  // function replacers: a payload is inserted verbatim, never read as a
  // replacement pattern
  return source
    .replace(VAULT_BLOCK, (_, open, _old, close) => open + payload + close)
    .replace(TITLE, () => `<title>${title}</title>`);
}

/** The personalized kit: `source` (the tool, blank or a kit) carrying `b64`.
 *  Rewriting rather than appending keeps it idempotent, so a kit can
 *  regenerate itself during rotation. */
export function withVault(source, b64) {
  return swap(source, b64, RECOVERY_TITLE);
}

/** The blank tool a kit file was made from: both swaps undone. A blank
 *  tool comes back unchanged. */
export function blankForm(source) {
  return swap(source, "null", BLANK_TITLE);
}

/** The base64 vault inside a file, or null when the file is a blank tool. */
export function vaultPayload(text) {
  const m = text.match(VAULT_BLOCK);
  if (!m) {
    throw new KitFileError("NO_VAULT_BLOCK", "This file is not a KEEP file — it has no vault block inside it.");
  }
  const b64 = m[2].trim();
  return b64 && b64 !== "null" ? b64 : null;
}

/** The version a file says it is ("KEEP 1.1.0"), or null. A claim only:
 *  whoever changed the code could change this line too. Anchored to the
 *  declaration at the start of a line, the shape every build carries. */
export function claimedVersion(text) {
  const m = text.match(VERSION_DECLARATION);
  return m ? m[1] : null;
}

/** Order two "KEEP x.y[.z]" (or bare "x.y.z") stamps: negative, zero or
 *  positive like a sort comparator; null when either is unreadable. */
export function compareVersions(a, b) {
  const parts = (s) => {
    const m = /^(?:KEEP )?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(s ?? "");
    return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
  };
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** SHA-256 (hex) of a file's blank form: the identity of its app code. */
export async function codeDigest(text) {
  return toHex(await sha256(new TextEncoder().encode(blankForm(text))));
}

/**
 * Name the app code inside a KEEP file by its hash alone. `selfDigest` is
 * the running build's own code digest, since no build can list itself.
 * Returns { digest, claimed, kind, release }, where kind is
 *   "self"     the same code as the tool doing the checking
 *   "release"  a published release from `releases` (then `release` is set)
 *   "unknown"  neither: changed code, a development build, or a release
 *              newer than this tool
 */
export async function identifyCode(text, selfDigest, releases = KNOWN_RELEASES) {
  const digest = await codeDigest(text);
  const claimed = claimedVersion(text);
  if (digest === selfDigest) return { digest, claimed, kind: "self", release: null };
  const release = releases.find((r) => r.keep === digest || r.kit === digest) ?? null;
  return { digest, claimed, kind: release ? "release" : "unknown", release };
}
