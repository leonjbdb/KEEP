import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  withVault,
  blankForm,
  vaultPayload,
  claimedVersion,
  compareVersions,
  codeDigest,
  identifyCode,
  KitFileError,
  BLANK_TITLE,
  RECOVERY_TITLE,
} from "../src/kitfile.js";
import { KNOWN_RELEASES } from "../src/releases.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const B64 = "iVBLUg0KGgoBACBzh2oA";
const VERSION = (await readFile(join(root, "src/app.js"), "utf8"))
  .match(/^const APP_VERSION = "KEEP (\d+\.\d+\.\d+)";$/m)[1];

// a scratch build of our own, so the other test files' rebuilds of dist/
// can never hand this one a half-written file
let work;
let keep;
before(async () => {
  work = await mkdtemp(join(tmpdir(), "keep-kitfile-"));
  execFileSync(process.execPath, [join(root, "build.mjs"), "--out", work], { stdio: "pipe" });
  keep = await readFile(join(work, "keep.html"), "utf8");
});
after(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

test("kit round trip: a kit undone is the published keep.html, byte for byte", () => {
  assert.equal(blankForm(keep), keep, "the blank tool is its own blank form");
  const kit = withVault(keep, B64);
  assert.notEqual(kit, keep);
  assert.ok(kit.includes(`<title>${RECOVERY_TITLE}</title>`));
  assert.equal(vaultPayload(kit), B64);
  assert.equal(blankForm(kit), keep);
  assert.equal(withVault(kit, B64), kit, "re-personalizing is idempotent");
  assert.equal(blankForm(withVault(kit, "AAAA")), keep, "a rotated kit undoes to the same tool");
  // exactly two spans differ: the vault payload and the title
  const diff = kit.length - keep.length;
  assert.equal(diff, B64.length - "null".length + RECOVERY_TITLE.length - BLANK_TITLE.length);
});

test("vault payload: base64 for a kit, null for a blank tool, refusal for anything else", () => {
  assert.equal(vaultPayload(keep), null);
  assert.equal(vaultPayload(withVault(keep, ` ${B64}\n`)), B64, "surrounding whitespace is ignored");
  for (const notKeep of ["", "<html><title>x</title></html>"]) {
    assert.throws(() => vaultPayload(notKeep), (e) => e instanceof KitFileError && e.code === "NO_VAULT_BLOCK");
    assert.throws(() => blankForm(notKeep), KitFileError);
  }
});

test("claimed version: the declaration at a line start, never a lookalike", () => {
  assert.equal(claimedVersion(keep), `KEEP ${VERSION}`);
  assert.equal(claimedVersion('const APP_VERSION = "KEEP 1.0";\n'), "KEEP 1.0");
  assert.equal(claimedVersion('// const APP_VERSION = "KEEP 9.9.9";\n'), null);
  assert.equal(claimedVersion('x = \'const APP_VERSION = "KEEP 9.9.9";\'\n'), null);
  assert.equal(claimedVersion("no stamp here"), null);
});

test("version order: semver-like, two-part stamps read as .0, junk is null", () => {
  assert.equal(compareVersions("KEEP 1.0", "KEEP 1.0.0"), 0);
  assert.ok(compareVersions("KEEP 1.0.3", "KEEP 1.1.0") < 0);
  assert.ok(compareVersions("KEEP 1.10.0", "KEEP 1.9.0") > 0);
  assert.ok(compareVersions("2.0.0", "KEEP 1.99.99") > 0);
  assert.equal(compareVersions("KEEP x", "KEEP 1.0"), null);
  assert.equal(compareVersions(null, "KEEP 1.0"), null);
});

test("identify: this build, a known release by either hash, or unknown", async () => {
  const self = await codeDigest(keep);
  assert.equal(self, sha256Hex(keep), "a kit's code digest is the published file's hash");
  const kit = withVault(keep, B64);
  assert.equal((await identifyCode(kit, self)).kind, "self");

  const releases = [
    { version: "0.9.0", keep: "a".repeat(64) },
    { version: "1.0.0", keep: "b".repeat(64), kit: self },
  ];
  const byKit = await identifyCode(kit, "f".repeat(64), releases);
  assert.equal(byKit.kind, "release");
  assert.equal(byKit.release.version, "1.0.0");
  const byKeep = await identifyCode(kit, "f".repeat(64), [{ version: "1.0.0", keep: self }]);
  assert.equal(byKeep.release.version, "1.0.0");

  const tampered = kit.replace("Recover the Secret", "Recover the Secret ");
  const verdict = await identifyCode(tampered, self, releases);
  assert.equal(verdict.kind, "unknown");
  assert.equal(verdict.release, null);
  assert.equal(verdict.claimed, `KEEP ${VERSION}`, "the claim is reported, not trusted");
});

test("build digest: the stamp is the file's own hash with the slot emptied", () => {
  const stamp = keep.match(/^const BUILD_DIGEST = "([0-9a-f]{64})";$/m);
  assert.notEqual(stamp, null, "build.mjs stamps BUILD_DIGEST");
  const unstamped = keep.replace(`"${stamp[1]}"`, '"@@BUILD_DIGEST@@"');
  assert.equal(sha256Hex(unstamped), stamp[1]);
});

test("known releases: well formed, oldest first, all older than this build", () => {
  let previous = null;
  for (const r of KNOWN_RELEASES) {
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
    assert.match(r.keep, /^[0-9a-f]{64}$/);
    if ("kit" in r) assert.match(r.kit, /^[0-9a-f]{64}$/);
    if (previous) assert.ok(compareVersions(previous, r.version) < 0, `${r.version} out of order`);
    assert.ok(compareVersions(r.version, VERSION) < 0, `${r.version} is not older than ${VERSION}`);
    previous = r.version;
  }
});

// The table is only worth something if no release is missing from it. Each
// v* tag below this version must be listed, with the hash of the keep.html
// committed at that tag — the same file its README published.
function releaseTags() {
  try {
    return execFileSync("git", ["tag", "--list", "v*"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString().split("\n").filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  } catch {
    return [];
  }
}
const tags = releaseTags();
if (tags.length === 0 && process.env.CI) {
  throw new Error("kitfile test: no v* tags in CI — check out with full history (fetch-depth: 0)");
}

test("known releases: every earlier release tag is listed with its published hash",
  { skip: tags.length === 0 ? "no git tags here (not a git checkout?)" : false }, () => {
    for (const tag of tags) {
      const version = tag.slice(1);
      if (compareVersions(version, VERSION) >= 0) continue;
      const entry = KNOWN_RELEASES.find((r) => r.version === version);
      assert.ok(entry, `release ${version} is missing from src/releases.js`);
      const published = execFileSync("git", ["show", `${tag}:dist/keep.html`], { cwd: root, maxBuffer: 64 << 20 });
      assert.equal(entry.keep, sha256Hex(published), `${version}: hash differs from the file at ${tag}`);
    }
  });

test("known releases: nothing untagged is listed — only tagged releases count",
  { skip: tags.length === 0 ? "no git tags here (not a git checkout?)" : false }, () => {
    for (const r of KNOWN_RELEASES) {
      assert.ok(tags.includes(`v${r.version}`), `${r.version} is listed but has no v${r.version} tag`);
    }
  });
