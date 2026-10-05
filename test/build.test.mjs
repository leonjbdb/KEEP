import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseVault, recoverPassword } from "../src/vault.js";
import { decodeCard } from "../src/card.js";
import { fromBase64, toBase64, fromHex } from "../src/crypto.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// mirrors the golden vector in vault.test.mjs
const GOLDEN_PASSWORD = "CORRECT HORSE BATTERY STAPLE";
const GOLDEN_CARDS = [
  "PSR1PQ9HHR5FQDU4WDZ4685CNNPHGE6MRZFCHLWTNA29L3WL8X2CZKZ0PNGWQGHSQEP",
  "PSR1PQFHHRGJCRFC54UCLX90TMNHAH6JQNUGCPTFNW3S5YCMK05AA6EQKXVPXG7TKK6",
  "PSR1PQDHHZQ6XA63NVV6709S3NCYU8GP3XRDYG5REPTNQ47WVRWUG5LXXXCHXDNW5PY",
];

async function builtHtml() {
  execFileSync(process.execPath, [join(root, "build.mjs")], { stdio: "pipe" });
  return readFile(join(root, "dist/keep.html"), "utf8");
}

test("build: single self-contained file, lint invariants hold", async () => {
  const html = await builtHtml();
  for (const needle of ["http://", "https://", "<script src", "fetch(", "XMLHttpRequest", "WebSocket"]) {
    assert.equal(html.includes(needle), false, `must not contain ${needle}`);
  }
  assert.equal(html.includes("Content-Security-Policy"), true);
  assert.equal(html.includes('id="pkr-vault">null<'), true);
  // exactly two script elements: the vault JSON placeholder + the app
  // bundle (the manual recovery comment quotes the tag, so comments go first)
  const markup = html.replace(/<!--[\s\S]*?-->/g, "");
  assert.equal((markup.match(/<script/g) || []).length, 2);
});

test("build: manual recovery travels inside the file, in a comment, before the app", async () => {
  const html = await builtHtml();
  const spec = (await readFile(join(root, "docs/RECOVERY-SPEC.md"), "utf8")).trimEnd();
  const py = (await readFile(join(root, "tools/recover.py"), "utf8")).trimEnd();
  const start = html.indexOf("==== MANUAL RECOVERY ====");
  const end = html.indexOf("==== END OF MANUAL RECOVERY ====");
  assert.ok(start !== -1 && end > start, "manual recovery block present");
  const block = html.slice(start, end);
  assert.ok(block.includes(spec), "the full specification");
  assert.ok(block.includes(py), "the full reference program");
  // inside one comment that closes after the block, before the app script
  assert.ok(html.lastIndexOf("<!--", start) > html.lastIndexOf("-->", start));
  assert.ok(html.indexOf("-->", start) > end);
  assert.ok(end < html.lastIndexOf("<script>"), "before the app script, so kits carry it");
});

test("build: the full licence sits before the first script, so kits carry it too", async () => {
  // the app writes each RECOVERY.html from a snapshot taken while its script
  // runs; text after the script would not be parsed yet (browser.test.mjs
  // proves the real thing on a kit the app wrote)
  const html = await builtHtml();
  const license = (await readFile(join(root, "LICENSE"), "utf8")).trim();
  const at = html.indexOf(license);
  assert.notEqual(at, -1, "full licence text is in the file");
  assert.ok(at < html.indexOf("<script"), "licence comes before every script");
});

test("build: --out writes a scratch build elsewhere and leaves README alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keep-build-"));
  try {
    const readmeBefore = await readFile(join(root, "README.md"), "utf8");
    execFileSync(process.execPath, [join(root, "build.mjs"), "--out", dir], { stdio: "pipe" });
    const scratchBuild = await readFile(join(dir, "keep.html"), "utf8");
    assert.equal(scratchBuild, await builtHtml(), "same bytes as the dist build");
    assert.equal(await readFile(join(root, "README.md"), "utf8"), readmeBefore);
    assert.equal((await readdir(dir)).some((f) => f.startsWith("RECOVERY-demo-v")), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("build: deterministic output, README records its SHA-256", async () => {
  const first = await builtHtml();
  const second = await builtHtml();
  assert.equal(second, first, "rebuild must produce identical bytes");

  const digest = createHash("sha256").update(first, "utf8").digest("hex");
  const readme = await readFile(join(root, "README.md"), "utf8");
  const block = readme.match(/<!-- BEGIN BUILD-HASH -->([\s\S]*?)<!-- END BUILD-HASH -->/);
  assert.notEqual(block, null, "README must keep the BUILD-HASH markers");
  assert.equal(block[1].includes(digest), true, "README hash must match the built file");

  // --check is the CI guard: it passes only while the committed hash is current
  execFileSync(process.execPath, [join(root, "build.mjs"), "--check"], { stdio: "pipe" });
});

test("demo kit: in dist with the version in its name, alone, and it recovers", async () => {
  await builtHtml();
  // the version comes from the source declaration the upgrade probe greps;
  // the build fails if that exact shape ever changes
  const version = (await readFile(join(root, "src/app.js"), "utf8"))
    .match(/^const APP_VERSION = "KEEP (\d+\.\d+\.\d+)";$/m)[1];
  const demo = await readFile(join(root, `dist/RECOVERY-demo-v${version}.html`), "utf8");
  const b64 = demo.match(
    new RegExp('<script type="application/json" id="pkr-vault">([^<]+)</scr' + "ipt>")
  )[1];
  const vault = await parseVault(fromBase64(b64));
  assert.equal(vault.fingerprint, "0F7AB044");
  assert.equal(
    await recoverPassword(vault, GOLDEN_CARDS.map((c) => decodeCard(c))),
    GOLDEN_PASSWORD
  );
  // one demo kit at a time: the build removes stale versions
  const demos = (await readdir(join(root, "dist"))).filter((f) => f.startsWith("RECOVERY-demo-"));
  assert.deepEqual(demos, [`RECOVERY-demo-v${version}.html`]);
});

test("personalization contract: inject vault, extract, parse, recover", async () => {
  const html = await builtHtml();
  const goldenHex = (await readFile(join(root, "test/vault.test.mjs"), "utf8"))
    .match(/GOLDEN_BYTES_HEX =\n?\s*"([0-9a-f"\s+;]+)/)[1]
    .replace(/[^0-9a-f]/g, "");
  const bytes = fromHex(goldenHex);

  // same replacement the app performs on its own source snapshot
  const re = new RegExp('(<script type="application/json" id="pkr-vault">)[\\s\\S]*?(</scr' + "ipt>)");
  assert.equal(re.test(html), true, "placeholder present");
  const personalized = html.replace(re, `$1${toBase64(bytes)}$2`);
  assert.notEqual(personalized, html);
  assert.equal(personalized.includes('id="pkr-vault">null<'), false);

  // a future engineer's extraction path: pull the base64 back out
  const extracted = personalized.match(
    new RegExp('<script type="application/json" id="pkr-vault">([^<]+)</scr' + "ipt>")
  )[1];
  const vault = await parseVault(fromBase64(extracted));
  assert.equal(vault.fingerprint, "0F7AB044");
  const recovered = await recoverPassword(vault, GOLDEN_CARDS.map((c) => decodeCard(c)));
  assert.equal(recovered, GOLDEN_PASSWORD);
});
