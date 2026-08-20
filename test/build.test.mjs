import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  // exactly two script blocks: the vault JSON placeholder + the app bundle
  assert.equal((html.match(/<script/g) || []).length, 2);
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
