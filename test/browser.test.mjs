// End to end in real browsers, Chrome and Firefox, driven headless through
// tools/browser.mjs (no dependencies). Everything a node test cannot reach:
// whole ceremonies through the interface, the kit files the app writes from
// its own snapshot, recovery, changing the secret, upgrading and verifying
// kits, and how each engine copies the file.
//
// Needs Chrome/Chromium and Firefox (or CHROME_PATH / FIREFOX_PATH). A
// missing browser skips its suite locally; in CI it is a failure.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { launch, findBrowser } from "../tools/browser.mjs";
import { blankForm, withVault, vaultPayload } from "../src/kitfile.js";
import { KNOWN_RELEASES } from "../src/releases.js";
import { parseVault } from "../src/vault.js";
import { fromBase64 } from "../src/crypto.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const VERSION = (await readFile(join(root, "src/app.js"), "utf8"))
  .match(/^const APP_VERSION = "KEEP (\d+\.\d+\.\d+)";$/m)[1];
const LICENSE = (await readFile(join(root, "LICENSE"), "utf8")).trim();

// the golden vault inside the demo kit (test/vault.test.mjs)
const GOLDEN_PASSWORD = "CORRECT HORSE BATTERY STAPLE";
const GOLDEN_CARDS = [
  "PSR1PQ9HHR5FQDU4WDZ4685CNNPHGE6MRZFCHLWTNA29L3WL8X2CZKZ0PNGWQGHSQEP",
  "PSR1PQFHHRGJCRFC54UCLX90TMNHAH6JQNUGCPTFNW3S5YCMK05AA6EQKXVPXG7TKK6",
  "PSR1PQDHHZQ6XA63NVV6709S3NCYU8GP3XRDYG5REPTNQ47WVRWUG5LXXXCHXDNW5PY",
];

/** The keep.html committed at a release tag, or null without git or tag. */
function publishedAt(version) {
  try {
    return execFileSync("git", ["show", `v${version}:dist/keep.html`],
      { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }).toString("utf8");
  } catch {
    return null;
  }
}

const has = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;
const heading = (text) =>
  `document.querySelector("h1")?.textContent.replace(/_$/, "") === ${JSON.stringify(text)}`;
const spaced = (code) => code.match(/.{1,4}/g).join(" ");
const settle = (page) => page.eval("new Promise((r) => setTimeout(() => r(true), 600))");

/** The code in the big key well, without its display spacing. */
const shownKey = (page) => page.eval(`document.querySelector(".well.key").textContent.replace(/\\s+/g, "")`);

/** The first well on screen that holds a full SHA-256, spaces removed. */
const shownHash = (page) => page.waitFor(`[...document.querySelectorAll(".well")]
  .map((w) => w.textContent.replace(/\\s+/g, ""))
  .find((t) => /^[0-9a-f]{64}$/.test(t))`, "a file hash on screen");

/** label -> value of the stat grid on screen. */
const stats = (page) => page.eval(`Object.fromEntries([...document.querySelectorAll(".stat")]
  .map((s) => [...s.children].map((c) => c.textContent.trim())))`);

/** Step a params stepper to `target` with its own buttons. */
async function setStepper(page, index, target, what) {
  for (let guard = 0; guard < 20; guard++) {
    const value = Number(await page.eval(`document.querySelectorAll(".stepper .val")[${index}].textContent`));
    if (value === target) return;
    const label = `${value < target ? "One more" : "One fewer"} — ${what}`;
    await page.eval(`document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)}).click(), true`);
  }
  throw new Error(`stepper ${what} never reached ${target}`);
}

/**
 * A whole ceremony through the interface, as a person would do it. Keys are
 * read off the screen and typed back (in varied spellings, which the app
 * must accept), the proof uses the last k keys, the kit is saved four times,
 * the printed documents are checked, and FINISH is confirmed.
 */
async function ceremony(page, { n, k, owner, secret, multiline }) {
  await page.click("Create a Recovery Kit");
  await page.waitFor(heading("BEFORE YOU START"), "the precautions");
  await page.click("CONTINUE");
  await page.waitFor(heading("HOW MANY KEYS WOULD YOU LIKE?"), "the parameters");
  if (owner) await page.click("SEPARATE OWNER'S KEY");
  await setStepper(page, 0, n, "total number of keys to generate");
  await setStepper(page, 1, k, "recovery threshold");
  await page.click("CONTINUE");

  await page.waitFor(heading("ENTER THE SECRET"), "the secret step");
  if (multiline) await page.click("MULTIPLE LINES");
  const field = multiline ? "textarea.fieldin" : "input.fieldin";
  await page.typeInto(field, secret, 0);
  await page.typeInto(field, secret, 1);
  await page.waitFor(has("OK"), "the two entries to match");
  await page.click("CONTINUE");

  const keys = { owner: null, cards: [] };
  if (owner) {
    await page.waitFor(heading("YOUR KEY"), "the owner's key", 30_000);
    keys.owner = await shownKey(page);
    await page.click("VERIFY");
    await page.typeInto("textarea", spaced(keys.owner).toLowerCase());
    await page.waitFor(has("Your key is verified"), "the owner's key verified");
    await page.click("CONTINUE");
  }
  for (let i = 1; i <= n; i++) {
    await page.waitFor(heading(`KEY ${i}`), `key ${i}`, 30_000);
    const card = await shownKey(page);
    keys.cards.push(card);
    await page.click("VERIFY");
    await page.typeInto("textarea", i % 2 ? spaced(card) : card.toLowerCase());
    await page.waitFor(has("Key verified"), `key ${i} verified`);
    await page.click("CONTINUE");
  }

  await page.waitFor(heading("TEST YOUR KEYS"), "the proof");
  let slot = 0;
  if (owner) await page.typeInto("textarea", keys.owner, slot++);
  // a verified slot keeps its check through later slots' input: a repaint
  // would put in a fresh icon and replay its draw-in animation
  const checkIn = (i) => `document.querySelectorAll("textarea")[${i}]
    .closest(".field").querySelector(".icon-check")`;
  const firstCard = slot;
  for (const card of keys.cards.slice(n - k).reverse()) {
    await page.typeInto("textarea", card, slot);
    await page.waitFor(`Boolean(${checkIn(slot)})`, `slot ${slot} verified`);
    if (slot === firstCard) await page.eval(`(${checkIn(slot)}).dataset.firstDraw = "1", true`);
    slot++;
  }
  assert.equal(await page.eval(`${checkIn(firstCard)}.dataset.firstDraw ?? null`), "1",
    "the first key's check was not redrawn when the others were entered");
  await page.click("TEST THE RECOVERY");
  await page.waitFor(has("Recovered. These keys bring the secret back."), "the proof to pass");
  await page.click("CONTINUE");

  await page.waitFor(heading("SAVE YOUR KIT"), "the save step");
  await page.captureDownloads();
  const hash = await shownHash(page);
  const grid = await stats(page);
  // each further save names its copy
  const confirmations = ["Recovery file saved on device", "2nd copy saved on device",
    "3rd copy saved on device", "4th copy saved on device"];
  for (const want of confirmations) {
    await page.click("CREATE RECOVERY FILE");
    await page.waitFor(`[...document.querySelectorAll(".note-ok")]
      .some((n) => n.textContent === ${JSON.stringify(want)})`, `"${want}"`);
  }
  assert.equal(await page.downloadCount(), confirmations.length);
  const saved = await page.download();
  assert.equal(saved.name, "RECOVERY.html");
  for (let i = 2; i <= confirmations.length; i++) {
    assert.equal((await page.download(i)).text, saved.text, "every copy identical");
  }

  // the printed documents carry the kit's identity
  await page.click("PRINT");
  await page.waitFor(has("USB NOTE"), "the print preview");
  const usb = await page.text();
  for (const want of [grid["KIT FINGERPRINT"], grid["KEY SET"], spaced(hash).slice(0, 19)]) {
    assert.ok(usb.includes(want), `USB note shows ${want}`);
  }
  await page.click("OWNER'S INSTRUCTIONS");
  await page.waitFor(has("Owner's Instructions"), "the owner's instructions");
  await page.click("KEY HOLDER'S INSTRUCTIONS");
  await page.waitFor(has("Key Holder's Instructions"), "the holder's page");
  await page.click("BACK");
  await page.waitFor(heading("SAVE YOUR KIT"), "back to saving");

  // FINISH asks once more, with a countdown before it may be confirmed
  await page.click("FINISH");
  const confirm = `[...document.querySelectorAll(".modal button")]
    .find((b) => b.textContent.replace(/_/g, "").trim() === "FINISH")`;
  await page.waitFor(`Boolean(${confirm})`, "the confirmation countdown", 10_000);
  await page.eval(`(${confirm}).click(), true`);
  await page.waitFor(has("Create a Recovery Kit"), "the reloaded home screen");

  return { kit: saved.text, hash, grid, keys };
}

/** Type the keys into a recover/rotate screen: owner's key first, if any. */
async function enterKeys(page, keys, cards) {
  await page.waitFor(`document.querySelectorAll("textarea").length >= ${cards.length + (keys.owner ? 1 : 0)}`,
    "the key fields");
  let slot = 0;
  if (keys.owner) await page.typeInto("textarea", keys.owner, slot++);
  for (const card of cards) await page.typeInto("textarea", card, slot++);
}

/** Recover through a kit's own interface and read the secret back. */
async function recoverFrom(page, keys, cards, secret) {
  await page.click("Recover the Secret");
  await enterKeys(page, keys, cards);
  await page.click("RECOVER THE SECRET");
  await page.waitFor(heading("SECRET RECOVERED"), "the recovered screen");
  const well = `document.querySelector(".well.secret")`;
  const masked = await page.eval(`${well}.textContent`);
  assert.ok(!masked.includes(secret.split("\n")[0]), "masked until revealed");
  if (secret.includes("\n")) {
    await page.click("SHOW THE SECRET");
    assert.equal(await page.eval(`${well}.textContent`), secret);
    await page.click("HIDE THE SECRET");
  } else {
    const hold = `document.querySelector(".btn-hold")`;
    await page.eval(`${hold}.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true })), true`);
    assert.equal(await page.eval(`${well}.textContent`), secret);
    await page.eval(`${hold}.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true })), true`);
  }
  assert.equal(await page.eval(`${well}.textContent`), masked, "masked again");
  await page.click("FINISH");
  await page.waitFor(has("YOUR RECOVERY KIT"), "the kit home after finishing");
}

/** What every kit the app writes must be, in any engine. */
async function assertKitFile(kitText, keepText, { hash, fingerprint, setId }) {
  assert.equal(sha256Hex(kitText), hash, "the hash on screen is the saved file's");
  assert.equal(blankForm(kitText), keepText, "the kit undoes to the published keep.html, byte for byte");
  assert.ok(kitText.includes(LICENSE), "carries the licence");
  assert.ok(kitText.includes("==== MANUAL RECOVERY ===="), "carries the manual recovery");
  const vault = await parseVault(fromBase64(vaultPayload(kitText)));
  if (fingerprint) assert.equal(vault.fingerprint, fingerprint);
  if (setId) assert.equal(vault.setIdHex, setId);
  return vault;
}

for (const kind of ["chrome", "firefox"]) {
  const available = Boolean(findBrowser(kind));
  if (!available && process.env.CI) {
    throw new Error(`browser suite: no ${kind} found in CI`);
  }

  describe(`in a real browser (${kind})`, { skip: available ? false : `no ${kind} found` }, () => {
    let work, build, browser, keepPath, keepText, demoPath;
    const file = async (name, text) => {
      const path = join(work, name);
      await writeFile(path, text);
      return path;
    };
    const open = (path) => browser.open(pathToFileURL(path).href);
    const kits = {};

    before(async () => {
      work = await mkdtemp(join(tmpdir(), `keep-${kind}-`));
      build = join(work, "build");
      // a scratch build of our own: the other test files rebuild dist/ in
      // parallel, and reading a file mid-write would make this suite flaky
      execFileSync(process.execPath, [join(root, "build.mjs"), "--out", build], { stdio: "pipe" });
      keepPath = join(build, "keep.html");
      keepText = await readFile(keepPath, "utf8");
      demoPath = join(build, `RECOVERY-demo-v${VERSION}.html`);
      browser = await launch(kind, { workDir: work });
    });

    after(async () => {
      if (browser) await browser.close();
      if (work) await rm(work, { recursive: true, force: true, maxRetries: 5 });
    });

    test("ceremony, standard kit (3 of 5): create, recover, change the secret, verify, upgrade",
      { timeout: 180_000 }, async () => {
        const secret = "correct horse — battery staple ✓ ünïcode 123";
        let page = await open(keepPath);
        const made = await ceremony(page, { n: 5, k: 3, owner: false, secret });
        assert.deepEqual(page.errors, []);
        await page.close();
        assert.equal(made.grid.SCHEME, "3 of 5 keys");
        await assertKitFile(made.kit, keepText,
          { hash: made.hash, fingerprint: made.grid["KIT FINGERPRINT"], setId: made.grid["KEY SET"] });
        const kitPath = await file("standard.html", made.kit);
        kits.standard = { path: kitPath, ...made };

        // the kit it wrote: identity, its own hash, self-test, recovery
        page = await open(kitPath);
        await page.waitFor(heading("YOUR RECOVERY KIT"), "the kit home");
        const home = await stats(page);
        assert.equal(home["KIT FINGERPRINT"], made.grid["KIT FINGERPRINT"]);
        assert.equal(home["KEY SET"], made.grid["KEY SET"]);
        assert.equal(await shownHash(page), made.hash, "the reopened kit names its true hash");
        await page.click("Run Self-Test");
        const verdict = await page.waitFor(`(() => { const t = document.body.innerText;
          return /ALL \\d+ CHECKS PASSED/.test(t) ? "passed" : t.includes("A CHECK FAILED") ? t : ""; })()`,
        "the self-test verdict", 60_000);
        assert.equal(verdict, "passed");
        await page.click("BACK");
        // a different set of keys than the proof used, typed as written
        await recoverFrom(page, made.keys, made.keys.cards.slice(0, 3).map(spaced), secret);

        // change the secret: same keys, new file
        const newSecret = "a new secret after rotation";
        await page.click("Change the Protected Secret");
        await enterKeys(page, made.keys, [made.keys.cards[1], made.keys.cards[3], made.keys.cards[4]]);
        await page.typeInto("input.fieldin", newSecret, 0);
        await page.typeInto("input.fieldin", newSecret, 1);
        await page.click("RE-ENCRYPT THE KIT");
        await page.waitFor(heading("KIT RE-ENCRYPTED"), "the re-encrypted screen");
        await page.captureDownloads();
        const rotatedHash = await shownHash(page);
        await page.click("SAVE THE NEW RECOVERY FILE");
        const rotated = await page.download();
        assert.deepEqual(page.errors, []);
        await page.close();
        const vault = await assertKitFile(rotated.text, keepText, { hash: rotatedHash, setId: made.grid["KEY SET"] });
        assert.notEqual(vault.fingerprint, made.grid["KIT FINGERPRINT"], "a new vault, a new fingerprint");
        const rotatedPath = await file("standard-rotated.html", rotated.text);

        page = await open(rotatedPath);
        await page.waitFor(heading("YOUR RECOVERY KIT"), "the rotated kit home");
        await recoverFrom(page, made.keys, made.keys.cards.slice(2, 5), newSecret);
        await page.close();

        // keep.html verifies both, and upgrading the rotated one rewrites it identically
        page = await open(keepPath);
        await page.click("Verify a Recovery Kit");
        for (const [path, text] of [[kitPath, made.kit], [rotatedPath, rotated.text]]) {
          await page.setFiles("input[type=file]", [path]);
          await page.waitFor(`[...document.querySelectorAll(".well")].some((w) =>
            w.textContent.replace(/\\s+/g, "") === ${JSON.stringify(sha256Hex(text))})`, "the verdict");
          const t = await page.text();
          assert.ok(t.includes("Genuine.") && t.includes(`exactly the code of this tool, KEEP ${VERSION}`));
          assert.ok(t.includes("passed its integrity check"));
        }
        await page.click("BACK");
        await page.click("Upgrade a Recovery Kit");
        await page.setFiles("input[type=file]", [rotatedPath]);
        await page.click("UPGRADE THE KIT");
        await page.captureDownloads();
        await page.click("SAVE THE UPGRADED FILE");
        assert.equal((await page.download()).text, rotated.text, "same version: the upgrade rewrites it byte for byte");
        assert.deepEqual(page.errors, []);
        await page.close();
      });

    test("ceremony, owner's key kit (2 of 3, multi-line secret): create, recover, refusals",
      { timeout: 180_000 }, async () => {
        const secret = "first line of the secret\nsecond line: pässword\nthird line";
        let page = await open(keepPath);
        const made = await ceremony(page, { n: 3, k: 2, owner: true, secret, multiline: true });
        assert.deepEqual(page.errors, []);
        await page.close();
        assert.match(made.keys.owner, /^KEEP1/);
        const vault = await assertKitFile(made.kit, keepText,
          { hash: made.hash, fingerprint: made.grid["KIT FINGERPRINT"], setId: made.grid["KEY SET"] });
        assert.equal(vault.version, 2);
        assert.equal(vault.needsOwnerKey, true);
        const kitPath = await file("owner.html", made.kit);

        page = await open(kitPath);
        await page.waitFor(heading("YOUR RECOVERY KIT"), "the kit home");
        await recoverFrom(page, made.keys, made.keys.cards.slice(0, 2), secret);

        // refusals: a duplicated key, no owner's key, a key from another kit
        const go = `[...document.querySelectorAll("button")].find((b) => b.textContent.includes("RECOVER THE SECRET"))`;
        await page.click("Recover the Secret");
        await page.waitFor(`document.querySelectorAll("textarea").length === 3`, "owner + 2 key fields");
        await page.typeInto("textarea", made.keys.owner, 0);
        await page.typeInto("textarea", made.keys.cards[0], 1);
        await page.typeInto("textarea", made.keys.cards[0], 2);
        await page.waitFor(has("That key is already entered, in slot 1."), "the duplicate diagnosis");
        assert.equal(await page.eval(`${go}.disabled`), true, "duplicates never enable recovery");
        await page.close();

        page = await open(kitPath);
        await page.click("Recover the Secret");
        await page.waitFor(`document.querySelectorAll("textarea").length === 3`, "owner + 2 key fields");
        await page.typeInto("textarea", made.keys.cards[0], 1);
        await page.typeInto("textarea", made.keys.cards[1], 2);
        await settle(page);
        assert.equal(await page.eval(`${go}.disabled`), true, "no recovery without the owner's key");
        if (kits.standard) {
          await page.eval(`(() => { const t = document.querySelectorAll("textarea")[2];
            t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
          await page.typeInto("textarea", kits.standard.keys.cards[0], 2);
          await page.waitFor(has(`You have filled in a key from key set ${kits.standard.grid["KEY SET"]}`),
            "the wrong-set diagnosis");
        }
        assert.deepEqual(page.errors, []);
        await page.close();
      });

    test("the blank tool upgrades the demo kit, and the browser saves it to disk",
      { timeout: 90_000 }, async () => {
        const page = await open(keepPath);
        await page.click("Upgrade a Recovery Kit");
        await page.setFiles("input[type=file]", [demoPath]);
        await page.click("UPGRADE THE KIT");
        const hash = await shownHash(page);
        assert.ok((await page.text()).includes("fingerprint (0F7AB044)"));
        await page.captureDownloads();
        await page.click("SAVE THE UPGRADED FILE");
        const saved = await page.download();
        assert.equal(saved.name, "RECOVERY.html");
        await assertKitFile(saved.text, keepText, { hash, fingerprint: "0F7AB044" });
        assert.equal(vaultPayload(saved.text), vaultPayload(await readFile(demoPath, "utf8")), "vault copied verbatim");
        // the browser itself writes those bytes to its download folder
        let onDisk = false;
        for (let i = 0; i < 100 && !onDisk; i++) {
          for (const f of await readdir(browser.downloads)) {
            if (!/^RECOVERY.*\.html$/.test(f)) continue;
            if (await readFile(join(browser.downloads, f), "utf8").catch(() => "") === saved.text) onDisk = true;
          }
          if (!onDisk) await new Promise((r) => setTimeout(r, 100));
        }
        assert.ok(onDisk, "the downloaded file has exactly the bytes the app produced");
        assert.deepEqual(page.errors, []);
        await page.close();
      });

    test("the driver's waitFor rides out a page reload, and still fails fast on a mistake",
      { timeout: 90_000 }, async () => {
        // a long head keeps the document parsing, still without a body, the
        // way a large kit file is while it loads
        const path = await file("reloading.html", "<!doctype html><html><head><meta charset=\"utf-8\">" +
          "<meta name=\"filler\" content=\"x\">".repeat(60_000) + "</head><body><p>loaded</p></body></html>");
        const page = await open(path);
        for (let round = 0; round < 10; round++) {
          if (round % 2) {
            // the reload starts inside the clicking evaluation, as FINISH does;
            // polling on until the new document lands there before its body
            await page.eval("window.before = true, location.reload(), true");
            await page.waitFor(`!window.before && document.body.innerText.includes("loaded")`,
              `the reloaded page (round ${round})`);
          } else {
            // an evaluation still running when its page goes away
            await page.eval("setTimeout(() => location.reload(), 10), true");
            await page.waitFor(`new Promise((r) => setTimeout(
              () => r(document.body.innerText.includes("loaded")), 150))`, `the reloaded page (round ${round})`);
          }
        }
        assert.deepEqual(page.errors, []);
        const started = Date.now();
        await assert.rejects(page.waitFor("noSuchThing.ready", "a mistake"), /ReferenceError/);
        assert.ok(Date.now() - started < 5_000, "a real error throws at once, not at the timeout");
        await page.close();
      });

    test("the demo kit: recovery with the published keys", { timeout: 90_000 }, async () => {
      const page = await open(demoPath);
      await page.waitFor(heading("YOUR RECOVERY KIT"), "the kit home");
      assert.equal(await shownHash(page), sha256Hex(await readFile(demoPath)));
      // one key typed the way people write it: lowercase, in groups of four
      await recoverFrom(page, { owner: null },
        [spaced(GOLDEN_CARDS[0]).toLowerCase(), GOLDEN_CARDS[1], GOLDEN_CARDS[2]], GOLDEN_PASSWORD);
      assert.deepEqual(page.errors, []);
      await page.close();
    });

    test("verify screen: names the code and checks the vault of each file it is given", { timeout: 90_000 }, async () => {
      const demo = await readFile(demoPath, "utf8");
      const cases = [
        { path: demoPath, expect: ["Genuine.", `exactly the code of this tool, KEEP ${VERSION}`,
          "passed its integrity check (fingerprint 0F7AB044)", `KEEP ${VERSION} · verified`] },
        { path: keepPath, expect: ["Genuine.", "blank tool, not a kit", "Blank tool"] },
        { path: await file("tampered.html", demo.replace("Recover the Secret", "Recover the Secret!")),
          expect: ["Not verified.", `although it says it is KEEP ${VERSION}`, "Do not type keys into it",
            "passed its integrity check"] },
        { path: await file("newer.html", demo.replace(`APP_VERSION = "KEEP ${VERSION}"`, 'APP_VERSION = "KEEP 99.0.0"')),
          expect: ["Made by a newer tool.", "KEEP 99.0.0", "KEEP 99.0.0 · not verified"] },
        { path: await file("damaged.html", withVault(demo, vaultPayload(demo).replace(/^..../, "AAAA"))),
          expect: ["Genuine.", "Damaged kit", "not a PKR vault"] },
        { path: await file("other.html", "<!DOCTYPE html><title>x</title><p>hello</p>"), expect: ["not a KEEP file"], noHash: true },
      ];
      const old = publishedAt("1.0.3");
      if (old) {
        cases.push({ path: await file("old-1.0.3.html", withVault(old, vaultPayload(demo))),
          expect: ["Genuine.", "exactly the published KEEP 1.0.3", "KEEP 1.0.3 · verified"] });
      } else {
        assert.ok(!process.env.CI, "CI needs the release tags (fetch-depth: 0)");
      }

      const page = await open(keepPath);
      await page.click("Verify a Recovery Kit");
      for (const c of cases) {
        await page.setFiles("input[type=file]", [c.path]);
        // wait for this file's result, not the previous one still on screen
        const marker = c.noHash ? c.expect[0] : sha256Hex(await readFile(c.path));
        await page.waitFor(c.noHash
          ? has(marker)
          : `[...document.querySelectorAll(".well")].some((w) => w.textContent.replace(/\\s+/g, "") === ${JSON.stringify(marker)})`,
        `the verdict on ${c.path}`);
        const text = (await page.text()).replace(/\s+/g, " ");
        for (const want of c.expect) assert.ok(text.includes(want), `${c.path}: expected "${want}" in: ${text}`);
      }
      assert.deepEqual(page.errors, []);
      await page.close();
    });

    test("kit-writing screens warn only when this copy is not exact; the manual never shows", { timeout: 90_000 }, async () => {
      const WARNING = "A kit written here cannot be verified later.";
      let page = await open(keepPath);
      assert.ok(!(await page.text()).includes("MANUAL RECOVERY"), "the manual is a comment, never on screen");
      await page.click("Create a Recovery Kit");
      await page.waitFor(heading("BEFORE YOU START"), "the first ceremony step");
      await settle(page);
      assert.ok(!(await page.text()).includes(WARNING));
      await page.click("CANCEL");
      await page.click("Upgrade a Recovery Kit");
      await settle(page);
      assert.ok(!(await page.text()).includes(WARNING));
      await page.close();

      page = await open(demoPath);
      await page.click("Change the Protected Secret");
      await settle(page);
      assert.ok(!(await page.text()).includes(WARNING));
      await page.close();

      // a copy whose code was changed: the ceremony warns before it starts
      const marker = "Encrypt your secret into multiple secure parts";
      assert.ok(keepText.includes(marker));
      page = await open(await file("changed-keep.html", keepText.replace(marker, marker + "!")));
      await page.click("Create a Recovery Kit");
      await page.waitFor(has(WARNING), "the exact-copy warning");
      assert.deepEqual(page.errors, []);
      await page.close();
    });

    test("known releases: this engine reproduces every listed hash, and copies this build exactly",
      { timeout: 90_000 }, async () => {
        // the same capture the app makes at boot, taken by a probe at the very
        // start of the app script and cut out again afterwards
        const MARKER = '"use strict";\n(() => {';
        const PROBE = 'window.__keepSnapshot = "<!DOCTYPE html>\\n" + document.documentElement.outerHTML;';
        const snapshotOf = async (html, name) => {
          assert.equal(html.split(MARKER).length, 2, `${name}: one app script`);
          const page = await open(await file(name, html.replace(MARKER, PROBE + MARKER)));
          const snap = await page.eval("window.__keepSnapshot");
          await page.close();
          assert.equal(snap.split(PROBE).length, 2, `${name}: probe captured once`);
          return snap.replace(PROBE, "");
        };

        assert.equal(await snapshotOf(keepText, "probe-current.html"), keepText,
          "this build: the browser's copy is the file");
        for (const r of KNOWN_RELEASES) {
          const published = publishedAt(r.version);
          if (published === null) {
            assert.ok(!process.env.CI, `CI needs the v${r.version} tag (fetch-depth: 0)`);
            continue;
          }
          const snap = await snapshotOf(published, `probe-${r.version}.html`);
          assert.equal(sha256Hex(snap), r.kit ?? r.keep, `${r.version}: kit hash as ${kind} writes it`);
        }
      });
  });
}
