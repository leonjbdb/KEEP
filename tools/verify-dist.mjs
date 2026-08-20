// Verify that dist/keep.html matches the SHA-256 published in README.md.
// build.mjs --check proves the source produces the README hash; this proves
// the committed artifact is that same build. It has to run before build.mjs,
// which would otherwise rebuild over a tampered or stale dist/keep.html.
//
// Run: node tools/verify-dist.mjs

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const readme = await readFile(join(root, "README.md"), "utf8");
const match = readme.match(
  /<!-- BEGIN BUILD-HASH -->[\s\S]*?\b([0-9a-f]{64})\b[\s\S]*?<!-- END BUILD-HASH -->/
);
if (!match) {
  throw new Error("README.md: no SHA-256 between the BUILD-HASH markers");
}
const published = match[1];

const kit = await readFile(join(root, "dist/keep.html"));
const actual = createHash("sha256").update(kit).digest("hex");

if (actual !== published) {
  console.error(`dist/keep.html is    ${actual}`);
  console.error(`README.md publishes  ${published}`);
  throw new Error("dist/keep.html does not match the hash published in README.md");
}
console.log(`dist/keep.html matches README.md (${published})`);
