// Build: concatenate the ES modules into one classic inline script and
// inline the CSS into template.html, producing dist/keep.html —
// a single self-contained file with no external references. Also stamps
// the output's SHA-256 into README.md, so the published hash people
// verify a downloaded keep.html against can never drift from the source,
// and writes dist/RECOVERY-demo-v<version>.html — the golden vault
// wrapped in this build, for checking a personalized kit by hand.
//
// Run: node build.mjs             (writes dist/keep.html, updates README)
//      node build.mjs --check     (fails instead of writing a stale README)
//      node build.mjs --out DIR   (scratch build into DIR, README untouched:
//                                  its hash speaks for dist/keep.html only)

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseVault } from "./src/vault.js";
import { fromHex, toBase64 } from "./src/crypto.js";
import { withVault } from "./src/kitfile.js";

const root = dirname(fileURLToPath(import.meta.url));

const outFlag = process.argv.indexOf("--out");
if (outFlag !== -1 && !process.argv[outFlag + 1]) {
  throw new Error("--out needs a directory");
}
const scratch = outFlag !== -1;
const outDir = scratch ? resolve(process.argv[outFlag + 1]) : join(root, "dist");

// ---- version: pinned in source, verified against the release tag ----
// The version is read from src/app.js, never stamped in from git: a build
// must be reproducible from the source alone (a tarball has no .git, and
// the "rebuild and compare the hash" check depends on identical bytes).
// The tie to git runs the other way — when this checkout sits exactly on
// a v* tag, that tag must agree with the source, so a release can never
// ship a version string that contradicts its tag. The exact declaration
// shape is also load-bearing: other builds' upgrade screens grep
// `APP_VERSION = "KEEP x.y.z"` out of a kit file to name its version.
const appSource = await readFile(join(root, "src/app.js"), "utf8");
const versionMatch = appSource.match(/^const APP_VERSION = "KEEP (\d+\.\d+\.\d+)";$/m);
if (!versionMatch) {
  throw new Error('src/app.js: APP_VERSION must be declared exactly as: const APP_VERSION = "KEEP x.y.z";');
}
const VERSION = versionMatch[1];

function checkoutTag() {
  // CI names the ref without needing git; locally, ask git — and treat
  // "no git" or "not on a tag" as nothing to compare, not as an error.
  // A dirty tree is development on top of a tagged commit, not that tag's
  // source, so it is skipped too: only a clean checkout speaks for a tag.
  if (process.env.GITHUB_REF_TYPE === "tag") return process.env.GITHUB_REF_NAME;
  try {
    const git = (...args) => execFileSync("git", args,
      { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (git("status", "--porcelain") !== "") return null;
    return git("describe", "--exact-match", "--tags", "HEAD");
  } catch {
    return null;
  }
}
const tag = checkoutTag();
if (tag && /^v\d/.test(tag) && tag !== `v${VERSION}`) {
  throw new Error(
    `version mismatch: src/app.js says KEEP ${VERSION} but this checkout is tagged ${tag} — ` +
    "align APP_VERSION with the tag before releasing"
  );
}

// concatenation order respects dependencies; app.js comes last
const MODULE_ORDER = [
  "src/gf256.js",
  "src/crypto.js",
  "src/text.js",
  "src/scrollbar.js",
  "src/card.js",
  "src/shamir.js",
  "src/vault.js",
  "src/releases.js",
  "src/kitfile.js",
  "src/selftest.js",
  "src/app.js",
];

function stripModuleSyntax(source, name) {
  let out = source.replace(/^import\b[\s\S]*?;[ \t]*$/gm, "");
  out = out.replace(/^export\s+(?=(const|let|function|class|async))/gm, "");
  if (/^\s*export\b/m.test(out)) {
    throw new Error(`${name}: unhandled export syntax after transform`);
  }
  return `/* ===== ${name} ===== */\n${out}`;
}

const parts = [];
for (const rel of MODULE_ORDER) {
  parts.push(stripModuleSyntax(await readFile(join(root, rel), "utf8"), rel));
}
const bundle = `"use strict";\n(() => {\n${parts.join("\n")}\n})();`;

const closer = "</scr" + "ipt";
if (bundle.toLowerCase().includes(closer)) {
  throw new Error("bundle contains a literal closing script tag — it would break inlining");
}

const css = await readFile(join(root, "src/ui.css"), "utf8");
const template = await readFile(join(root, "src/template.html"), "utf8");

// The built file is what people actually pass around, so the licence has to
// travel inside it — MIT asks that the notice ship with every copy, and a
// kit on a USB stick has no repository next to it to point at.
const license = await readFile(join(root, "LICENSE"), "utf8");
if (license.includes("--")) {
  throw new Error("LICENSE contains '--', which cannot go inside an HTML comment");
}

// The manual recovery path travels inside every file too, as a comment: a
// text editor shows it, a browser never does. If JavaScript is off, or the
// self-test fails, the app points people here. The specification lets anyone
// recover with standard primitives; recover.py is the tested reference.
const spec = await readFile(join(root, "docs/RECOVERY-SPEC.md"), "utf8");
const recoverPy = await readFile(join(root, "tools/recover.py"), "utf8");
for (const [name, text] of [["docs/RECOVERY-SPEC.md", spec], ["tools/recover.py", recoverPy]]) {
  // the only sequences that could end (or nest) an HTML comment early
  for (const bad of ["-->", "--!>", "<!--", "\r"]) {
    if (text.includes(bad)) throw new Error(`${name} contains ${JSON.stringify(bad)}, which cannot go inside an HTML comment`);
  }
}
const manual = [
  "==== MANUAL RECOVERY ====",
  "",
  "How to recover the secret without a browser and without any of KEEP's",
  "code: the format specification (docs/RECOVERY-SPEC.md in the source",
  "repository), then a reference program in Python 3 that needs only its",
  "standard library (tools/recover.py). Both sit inside a comment, so a",
  "browser never shows them. To run the program, copy everything between",
  "its two markers into a file named recover.py.",
  "",
  "==== RECOVERY-SPEC.md ====",
  "",
  spec.trimEnd(),
  "",
  "==== recover.py: copy from the next line ====",
  recoverPy.trimEnd(),
  "==== recover.py: copy up to the line above ====",
  "",
  "==== END OF MANUAL RECOVERY ====",
].join("\n");

for (const marker of ["/*INLINE_CSS*/", "/*INLINE_JS*/", "/*INLINE_LICENSE*/", "/*INLINE_MANUAL*/"]) {
  if (!template.includes(marker)) throw new Error(`template missing ${marker}`);
}
let html = template.replace("/*INLINE_CSS*/", () => css);
html = html.replace("/*INLINE_JS*/", () => bundle);
html = html.replace("/*INLINE_LICENSE*/", () => license.trim());
html = html.replace("/*INLINE_MANUAL*/", () => manual);

// ---- lint: the "no network, single file" claims must be grep-provable ----
const forbidden = [
  "http://",
  "https://",
  "<script src",
  "<img ",
  "<iframe",
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "sendBeacon",
  "EventSource",
  "import(",
];
for (const needle of forbidden) {
  if (html.includes(needle)) throw new Error(`lint: output contains forbidden "${needle}"`);
}
// <link> is allowed only when it resolves inside the file itself (the favicon
// is a data: URI); anything that would hit the network is still a build error
for (const tag of html.match(/<link\b[^>]*>/g) || []) {
  if (!/href="data:/.test(tag)) throw new Error(`lint: non-data <link> in output: ${tag}`);
}
if (!html.includes('id="pkr-vault">null<')) {
  throw new Error("lint: blank vault placeholder missing");
}
// The app writes every RECOVERY.html from a snapshot of its own document,
// taken while its script runs. Whatever comes after the script has not been
// parsed yet and would silently be missing from every kit, so the licence
// has to sit before any script for it to travel into the kits as well.
const licenseAt = html.indexOf(license.trim());
if (licenseAt === -1 || licenseAt > html.indexOf("<script")) {
  throw new Error("lint: the full licence text must sit before the first script, " +
    "or the kits the app writes are left without it");
}
// That snapshot must also equal the file byte for byte, or a kit could not
// be turned back into the published keep.html to verify it (kitfile.js).
// The browser suite proves the whole property; these catch the usual ways
// to break it early. Browsers read the charset only from the first 1024
// bytes, the parser folds CRLF into LF, and everything after the closing
// script is not parsed yet when the snapshot is taken, so the serializer's
// own closing tags must be the file's last bytes.
const CHARSET = '<meta charset="utf-8">';
const charsetAt = html.indexOf(CHARSET);
if (charsetAt === -1 || Buffer.byteLength(html.slice(0, charsetAt + CHARSET.length), "utf8") > 1024) {
  throw new Error('lint: <meta charset="utf-8"> must sit within the first 1024 bytes');
}
if (html.includes("\r")) throw new Error("lint: output contains a carriage return");
// The kit swaps (kitfile.js) act on the first vault block and the first
// title. The embedded manual quotes both tags, so make sure the real ones
// come first: the vault block opens the body, the title sits in the head.
const VAULT_OPEN = '<script type="application/json" id="pkr-vault">';
if (html.indexOf(VAULT_OPEN) !== html.indexOf("<body>\n" + VAULT_OPEN) + "<body>\n".length) {
  throw new Error("lint: the first vault block must be the one opening the body");
}
if (html.indexOf("<title>") > html.indexOf("</head>")) {
  throw new Error("lint: the first title must be the one in the head");
}
if (!html.endsWith("</scr" + "ipt></body></html>")) {
  throw new Error("lint: output must end exactly with the closing script, body and html tags");
}

// ---- build digest: the one fact the file can carry about itself ----
// A file cannot contain its own hash, but it can contain the hash of itself
// with this slot left empty. The app's self-test re-empties the slot in its
// snapshot and compares, which proves this browser copies the file exactly —
// the precondition for a kit made here to verify against the published hash.
const DIGEST_SLOT = '"@@BUILD_DIGEST@@"';
if (html.split(DIGEST_SLOT).length !== 2) {
  throw new Error("build: the BUILD_DIGEST slot must appear exactly once");
}
const buildDigest = createHash("sha256").update(html, "utf8").digest("hex");
html = html.replace(DIGEST_SLOT, () => `"${buildDigest}"`);
if (!html.includes("Content-Security-Policy")) {
  throw new Error("lint: CSP meta tag missing");
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "keep.html"), html);

// ---- demo recovery kit: the golden vault wrapped in this build ----
// The same swap the app performs at save time (kitfile.js withVault),
// applied to the frozen golden vector, so every build leaves a personalized
// kit in dist/ to check by hand (fingerprint 0F7AB044; password and keys are
// published in
// test/vault.test.mjs — a demo, never a place for a real secret). The
// filename carries the version; stale demo kits are removed so dist/
// never holds two versions side by side.
const goldenHex = (await readFile(join(root, "test/vault.test.mjs"), "utf8"))
  .match(/GOLDEN_BYTES_HEX =\n?\s*"([0-9a-f"\s+;]+)/)[1]
  .replace(/[^0-9a-f]/g, "");
const goldenBytes = fromHex(goldenHex);
const demoVault = await parseVault(goldenBytes); // throws if the frozen bytes are broken
const demo = withVault(html, toBase64(goldenBytes));
if (demo === html || demo.includes('id="pkr-vault">null<')) {
  throw new Error("demo kit: vault injection failed");
}
for (const needle of forbidden) {
  if (demo.includes(needle)) throw new Error(`lint: demo kit contains forbidden "${needle}"`);
}
const demoName = `RECOVERY-demo-v${VERSION}.html`;
for (const entry of await readdir(outDir)) {
  if (/^RECOVERY-demo-v.*\.html$/.test(entry) && entry !== demoName) {
    await unlink(join(outDir, entry));
  }
}
await writeFile(join(outDir, demoName), demo);

// ---- stamp the release hash into README.md ----
// Deterministic build: same source in, same bytes out, so this digest is
// reproducible by anyone who rebuilds. Written here rather than by hand
// because a hash people trust must not be maintained by hand.
const digest = createHash("sha256").update(html, "utf8").digest("hex");

const BEGIN = "<!-- BEGIN BUILD-HASH -->";
const END = "<!-- END BUILD-HASH -->";
const readmePath = join(root, "README.md");
const readme = await readFile(readmePath, "utf8");
const start = readme.indexOf(BEGIN);
const end = readme.indexOf(END);
if (start === -1 || end === -1 || end < start) {
  throw new Error(`README.md is missing the ${BEGIN} / ${END} markers`);
}
const block = `${BEGIN}\n\n\`dist/keep.html\` — SHA-256\n\n\`\`\`\n${digest}\n\`\`\`\n\n`;
const updated = readme.slice(0, start) + block + readme.slice(end);

if (scratch) {
  console.log("scratch build: README.md left alone");
} else if (updated === readme) {
  console.log("README.md hash already current");
} else if (process.argv.includes("--check")) {
  throw new Error(`README.md hash is stale (built ${digest}) — run \`node build.mjs\``);
} else {
  await writeFile(readmePath, updated);
  console.log("README.md hash updated");
}

console.log(`built ${join(outDir, "keep.html")} (${(html.length / 1024).toFixed(1)} KiB) — KEEP ${VERSION}`);
console.log(`sha256 ${digest}`);
console.log(`built ${join(outDir, demoName)} (demo kit, fingerprint ${demoVault.fingerprint})`);
