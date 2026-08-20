// Build: concatenate the ES modules into one classic inline script and
// inline the CSS into template.html, producing dist/keep.html —
// a single self-contained file with no external references. Also stamps
// the output's SHA-256 into README.md, so the published hash people
// verify a downloaded keep.html against can never drift from the source.
//
// Run: node build.mjs           (writes dist/keep.html, updates README)
//      node build.mjs --check   (fails instead of writing a stale README)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

// concatenation order respects dependencies; app.js comes last
const MODULE_ORDER = [
  "src/gf256.js",
  "src/crypto.js",
  "src/text.js",
  "src/scrollbar.js",
  "src/card.js",
  "src/shamir.js",
  "src/vault.js",
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

for (const marker of ["/*INLINE_CSS*/", "/*INLINE_JS*/", "/*INLINE_LICENSE*/"]) {
  if (!template.includes(marker)) throw new Error(`template missing ${marker}`);
}
let html = template.replace("/*INLINE_CSS*/", () => css);
html = html.replace("/*INLINE_JS*/", () => bundle);
html = html.replace("/*INLINE_LICENSE*/", () => license.trim());

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
if (!html.includes("Content-Security-Policy")) {
  throw new Error("lint: CSP meta tag missing");
}

await mkdir(join(root, "dist"), { recursive: true });
const outPath = join(root, "dist/keep.html");
await writeFile(outPath, html);

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

if (updated === readme) {
  console.log("README.md hash already current");
} else if (process.argv.includes("--check")) {
  throw new Error(`README.md hash is stale (built ${digest}) — run \`node build.mjs\``);
} else {
  await writeFile(readmePath, updated);
  console.log("README.md hash updated");
}

console.log(`built dist/keep.html (${(html.length / 1024).toFixed(1)} KiB)`);
console.log(`sha256 ${digest}`);
