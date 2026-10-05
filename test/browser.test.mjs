// End to end in a real browser. Headless Chrome is driven over the DevTools
// protocol with Node's built-in WebSocket (no dependencies), through what a
// node test cannot reach: the app's snapshot of its own source, a kit file
// the app writes from it, and a recovery through the actual interface.
//
// Needs Chrome or Chromium (or CHROME_PATH). Without one the suite reports
// itself skipped; in CI a missing browser is a failure instead.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { blankForm, withVault } from "../src/kitfile.js";
import { KNOWN_RELEASES } from "../src/releases.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// mirrors the golden vector in vault.test.mjs (the vault inside the demo kit)
const GOLDEN_PASSWORD = "CORRECT HORSE BATTERY STAPLE";
const GOLDEN_FINGERPRINT = "0F7AB044";
const GOLDEN_CARDS = [
  "PSR1PQ9HHR5FQDU4WDZ4685CNNPHGE6MRZFCHLWTNA29L3WL8X2CZKZ0PNGWQGHSQEP",
  "PSR1PQFHHRGJCRFC54UCLX90TMNHAH6JQNUGCPTFNW3S5YCMK05AA6EQKXVPXG7TKK6",
  "PSR1PQDHHZQ6XA63NVV6709S3NCYU8GP3XRDYG5REPTNQ47WVRWUG5LXXXCHXDNW5PY",
];

function findChrome() {
  const paths = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const p of paths) if (p && existsSync(p)) return p;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch { /* not on PATH */ }
  }
  return null;
}

const CHROME = findChrome();
if (!CHROME && process.env.CI) {
  throw new Error("browser suite: no Chrome or Chromium found in CI (set CHROME_PATH)");
}

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const VERSION = (await readFile(join(root, "src/app.js"), "utf8"))
  .match(/^const APP_VERSION = "KEEP (\d+\.\d+\.\d+)";$/m)[1];

/** The keep.html committed at a release tag, or null without git or tag. */
function publishedAt(version) {
  try {
    return execFileSync("git", ["show", `v${version}:dist/keep.html`],
      { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }).toString("utf8");
  } catch {
    return null;
  }
}
const vaultB64 = (html) => html.match(
  new RegExp('<script type="application/json" id="pkr-vault">([^<]*)</scr' + "ipt>")
)[1];

/** Start Chrome with a throwaway profile; resolves to its DevTools socket URL. */
async function launch(profileDir) {
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profileDir}`, "--remote-debugging-port=0",
  ];
  // GitHub's Linux runners cannot set up Chrome's sandbox; the page under
  // test is our own local file, so running it unsandboxed there is fine
  if (process.platform === "linux") args.push("--no-sandbox");
  args.push("about:blank");
  const proc = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${log}`)), 30_000);
    proc.stderr.on("data", (chunk) => {
      log += chunk;
      const m = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}):\n${log}`)); });
  });
  return { proc, wsUrl };
}

/** Minimal DevTools protocol client: commands, plus a feed of events. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === undefined) {
      for (const fn of listeners) fn(msg);
      return;
    }
    const call = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
    else call.resolve(msg.result);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("could not open the DevTools socket"));
  });
  const client = {
    send(method, params = {}, sessionId) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params, sessionId }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
    },
    /** Resolves with the params of the first matching event. */
    once(method, match = () => true, timeout = 15_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(fn); reject(new Error(`no ${method} event`)); }, timeout);
        const fn = (msg) => {
          if (msg.method !== method || !match(msg)) return;
          clearTimeout(timer);
          listeners.delete(fn);
          resolve(msg.params);
        };
        listeners.add(fn);
      });
    },
    listen(fn) { listeners.add(fn); },
    close() { ws.close(); },
  };
  return client;
}

/** Open `url` in a new tab; collects page errors and offers DOM helpers. */
async function openPage(client, url) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => client.send(method, params, sessionId);
  const errors = [];
  client.listen((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push(d.exception?.description ?? d.text);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      errors.push(msg.params.entry.text);
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  const loaded = client.once("Page.loadEventFired", (m) => m.sessionId === sessionId);
  await send("Page.navigate", { url });
  await loaded;

  const page = {
    errors,
    send,
    async eval(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(`in page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      }
      return r.result.value;
    },
    async waitFor(expression, what, timeout = 15_000) {
      const until = Date.now() + timeout;
      for (;;) {
        const value = await page.eval(expression);
        if (value) return value;
        if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    /** Click the first button whose text contains `text`, once it is enabled. */
    async click(text) {
      const find = `[...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled)`;
      await page.waitFor(`Boolean(${find})`, `an enabled "${text}" button`);
      await page.eval(`${find}.click()`);
    },
    /** The text of the first .well holding a full SHA-256, spaces removed. */
    shownHash() {
      return page.waitFor(`[...document.querySelectorAll(".well")]
        .map((w) => w.textContent.replace(/\\s+/g, ""))
        .find((t) => /^[0-9a-f]{64}$/.test(t))`, "a file hash on screen");
    },
    text: () => page.eval("document.body.innerText"),
    close: () => client.send("Target.closeTarget", { targetId }),
  };
  return page;
}

describe("in a real browser (headless Chrome)", { skip: CHROME ? false : "no Chrome or Chromium found (set CHROME_PATH)" }, () => {
  let work, chrome, client, build, downloads, kitPath;

  before(async () => {
    work = await mkdtemp(join(tmpdir(), "keep-browser-"));
    build = join(work, "build");
    downloads = join(work, "downloads");
    await mkdir(downloads);
    // a scratch build of our own: the other test files rebuild dist/ in
    // parallel, and reading a file mid-write would make this suite flaky
    execFileSync(process.execPath, [join(root, "build.mjs"), "--out", build], { stdio: "pipe" });
    chrome = await launch(join(work, "profile"));
    client = await connect(chrome.wsUrl);
    await client.send("Browser.setDownloadBehavior",
      { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  });

  after(async () => {
    client?.close();
    if (chrome) {
      const exited = new Promise((r) => chrome.proc.once("exit", r));
      chrome.proc.kill();
      await exited;
    }
    if (work) await rm(work, { recursive: true, force: true, maxRetries: 5 });
  });

  test("blank tool upgrades the demo kit into a kit file that carries the licence", { timeout: 60_000 }, async () => {
    const version = VERSION;
    const demoPath = join(build, `RECOVERY-demo-v${version}.html`);
    const page = await openPage(client, pathToFileURL(join(build, "keep.html")).href);

    await page.click("Upgrade a Recovery Kit");
    await page.waitFor(`Boolean(document.querySelector("input[type=file]"))`, "the file picker");
    const { root: doc } = await page.send("DOM.getDocument");
    const { nodeId } = await page.send("DOM.querySelector",
      { nodeId: doc.nodeId, selector: "input[type=file]" });
    await page.send("DOM.setFileInputFiles", { nodeId, files: [demoPath] });

    await page.click("UPGRADE THE KIT");
    const shown = await page.shownHash(); // only the finished screen shows a hash
    assert.match(await page.text(), new RegExp(`fingerprint \\(${GOLDEN_FINGERPRINT}\\)`, "i"));

    const begun = client.once("Browser.downloadWillBegin");
    const done = client.once("Browser.downloadProgress", (m) => m.params.state === "completed");
    await page.click("SAVE THE UPGRADED FILE");
    const { suggestedFilename } = await begun;
    await done;
    assert.equal(suggestedFilename, "RECOVERY.html");

    kitPath = join(downloads, suggestedFilename);
    const kitBytes = await readFile(kitPath);
    const kit = kitBytes.toString("utf8");
    const license = (await readFile(join(root, "LICENSE"), "utf8")).trim();
    assert.ok(kit.includes(license), "the kit the app wrote carries the full licence");
    assert.equal(vaultB64(kit), vaultB64(await readFile(demoPath, "utf8")), "vault copied verbatim");
    assert.ok(kit.includes("<title>KEEP — Recovery</title>"));
    assert.ok(kit.includes(`APP_VERSION = "KEEP ${version}"`));
    assert.equal(shown, sha256Hex(kitBytes), "the hash the app shows is the saved file's");
    // the kit is the tool with its two spans swapped, nothing else: undone,
    // it is the exact keep.html this build published
    const keepText = await readFile(join(build, "keep.html"), "utf8");
    assert.equal(blankForm(kit), keepText, "kit undoes to the published file byte for byte");
    assert.equal(kit, withVault(keepText, vaultB64(kit)));
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test("the kit it wrote: own hash, self-test, recovery through the interface", { timeout: 60_000 }, async () => {
    assert.ok(kitPath, "needs the kit file from the previous test");
    const kitBytes = await readFile(kitPath);
    const page = await openPage(client, pathToFileURL(kitPath).href);

    await page.waitFor(`document.body.innerText.includes("YOUR RECOVERY KIT")`, "the kit home");
    assert.ok((await page.text()).includes(GOLDEN_FINGERPRINT));
    assert.equal(await page.shownHash(), sha256Hex(kitBytes), "reopened kit names its true hash");

    await page.click("Run Self-Test");
    const verdict = await page.waitFor(`(() => {
      const t = document.body.innerText;
      return /ALL \\d+ CHECKS PASSED/.test(t) ? "passed" : t.includes("A CHECK FAILED") ? t : "";
    })()`, "the self-test verdict", 30_000);
    assert.equal(verdict, "passed", "self-test failed in the browser");

    await page.click("BACK");
    await page.click("Recover the Secret");
    await page.waitFor(`document.querySelectorAll("textarea").length === 3`, "three key fields");
    // one key typed the way people write it: lowercase, in groups of four
    const typed = [GOLDEN_CARDS[0].toLowerCase().match(/.{1,4}/g).join(" "), ...GOLDEN_CARDS.slice(1)];
    await page.eval(`(() => {
      const values = ${JSON.stringify(typed)};
      document.querySelectorAll("textarea").forEach((t, i) => {
        t.value = values[i];
        t.dispatchEvent(new Event("input", { bubbles: true }));
      });
    })()`);
    await page.click("RECOVER THE SECRET");
    await page.waitFor(`document.body.innerText.includes("SECRET RECOVERED")`, "the recovered screen");

    const well = `document.querySelector(".well.secret")`;
    assert.equal(await page.eval(`${well}.textContent`), "•".repeat(12), "masked until held");
    await page.eval(`document.querySelector(".btn-hold")
      .dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true }))`);
    assert.equal(await page.eval(`${well}.textContent`), GOLDEN_PASSWORD);
    await page.eval(`document.querySelector(".btn-hold")
      .dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }))`);
    assert.equal(await page.eval(`${well}.textContent`), "•".repeat(12), "masked again on release");
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test("verify screen: names the code and checks the vault of each file it is given", { timeout: 90_000 }, async () => {
    assert.ok(kitPath, "needs the kit file from the first test");
    const keepPath = join(build, "keep.html");
    const kit = await readFile(kitPath, "utf8");
    const dir = join(work, "verify");
    await mkdir(dir);
    const file = async (name, text) => {
      const path = join(dir, name);
      await writeFile(path, text);
      return path;
    };

    const cases = [
      { path: kitPath, expect: ["Genuine.", `exactly the code of this tool, KEEP ${VERSION}`,
        "passed its integrity check (fingerprint 0F7AB044)", `KEEP ${VERSION} · verified`] },
      { path: keepPath, expect: ["Genuine.", "blank tool, not a kit", "Blank tool"] },
      { path: await file("tampered.html", kit.replace("Recover the Secret", "Recover the Secret!")),
        expect: ["Not verified.", `although it says it is KEEP ${VERSION}`, "Do not type keys into it",
          "passed its integrity check"] },
      { path: await file("newer.html", kit.replace(`APP_VERSION = "KEEP ${VERSION}"`, 'APP_VERSION = "KEEP 99.0.0"')),
        expect: ["Made by a newer tool.", "KEEP 99.0.0", "KEEP 99.0.0 · not verified"] },
      { path: await file("damaged.html", withVault(kit, vaultB64(kit).replace(/^..../, "AAAA"))),
        expect: ["Genuine.", "Damaged kit", "not a PKR vault"] },
      { path: await file("other.html", "<!DOCTYPE html><title>x</title><p>hello</p>"), expect: ["not a KEEP file"], noHash: true },
    ];
    // a kit written by the last 1.0.x release, as published: the table names it
    const old = publishedAt("1.0.3");
    if (old) {
      cases.push({ path: await file("old-1.0.3.html", withVault(old, vaultB64(kit))),
        expect: ["Genuine.", "exactly the published KEEP 1.0.3", "KEEP 1.0.3 · verified"] });
    } else {
      assert.ok(!process.env.CI, "CI needs the release tags (fetch-depth: 0)");
    }

    const page = await openPage(client, pathToFileURL(keepPath).href);
    await page.click("Verify a Recovery Kit");
    for (const c of cases) {
      const { root: doc } = await page.send("DOM.getDocument");
      const { nodeId } = await page.send("DOM.querySelector",
        { nodeId: doc.nodeId, selector: "input[type=file]" });
      await page.send("DOM.setFileInputFiles", { nodeId, files: [c.path] });
      // wait for this file's result, not the previous one still on screen
      const marker = c.noHash ? c.expect[0] : sha256Hex(await readFile(c.path));
      await page.waitFor(c.noHash
        ? `document.body.innerText.includes(${JSON.stringify(marker)})`
        : `[...document.querySelectorAll(".well")].some((w) => w.textContent.replace(/\\s+/g, "") === ${JSON.stringify(marker)})`,
        `the verdict on ${c.path}`);
      const text = (await page.text()).replace(/\s+/g, " ");
      for (const want of c.expect) assert.ok(text.includes(want), `${c.path}: expected "${want}" in: ${text}`);
    }
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test("kit-writing screens warn only when this copy is not exact; the manual never shows", { timeout: 60_000 }, async () => {
    assert.ok(kitPath, "needs the kit file from the first test");
    const WARNING = "A kit written here cannot be verified later.";
    const settle = (page) => page.eval("new Promise((r) => setTimeout(() => r(true), 600))");
    const keepText = await readFile(join(build, "keep.html"), "utf8");
    assert.ok((await readFile(kitPath, "utf8")).includes("==== MANUAL RECOVERY ===="), "the kit carries the manual");

    // the genuine tool: create and upgrade start without a warning
    let page = await openPage(client, pathToFileURL(join(build, "keep.html")).href);
    assert.ok(!(await page.text()).includes("MANUAL RECOVERY"), "the manual is a comment, never on screen");
    await page.click("Create a Recovery Kit");
    await page.waitFor(`document.body.innerText.includes("BEFORE YOU START")`, "the first ceremony step");
    await settle(page);
    assert.ok(!(await page.text()).includes(WARNING));
    await page.click("CANCEL");
    await page.click("Upgrade a Recovery Kit");
    await settle(page);
    assert.ok(!(await page.text()).includes(WARNING));
    await page.close();

    // the kit's own rotation screen, likewise
    page = await openPage(client, pathToFileURL(kitPath).href);
    await page.click("Change the Protected Secret");
    await settle(page);
    assert.ok(!(await page.text()).includes(WARNING));
    await page.close();

    // a copy whose code was changed: the ceremony warns before it starts
    const changed = join(work, "changed-keep.html");
    const marker = "Encrypt your secret into multiple secure parts";
    assert.ok(keepText.includes(marker));
    await writeFile(changed, keepText.replace(marker, marker + "!"));
    page = await openPage(client, pathToFileURL(changed).href);
    await page.click("Create a Recovery Kit");
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(WARNING)})`, "the exact-copy warning");
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test("known releases: Chrome reproduces every listed hash, and copies this build exactly", { timeout: 90_000 }, async () => {
    // the same capture the app makes at boot, taken by a probe at the very
    // start of the app script and cut out again afterwards
    const MARKER = '"use strict";\n(() => {';
    const PROBE = 'window.__keepSnapshot = "<!DOCTYPE html>\\n" + document.documentElement.outerHTML;';
    const snapshotOf = async (html, name) => {
      assert.equal(html.split(MARKER).length, 2, `${name}: one app script`);
      const path = join(work, name);
      await writeFile(path, html.replace(MARKER, PROBE + MARKER));
      const page = await openPage(client, pathToFileURL(path).href);
      const snap = await page.eval("window.__keepSnapshot");
      await page.close();
      assert.equal(snap.split(PROBE).length, 2, `${name}: probe captured once`);
      return snap.replace(PROBE, "");
    };

    const keepText = await readFile(join(build, "keep.html"), "utf8");
    assert.equal(await snapshotOf(keepText, "probe-current.html"), keepText,
      "this build: the browser's copy is the file");
    for (const r of KNOWN_RELEASES) {
      const published = publishedAt(r.version);
      if (published === null) {
        assert.ok(!process.env.CI, `CI needs the v${r.version} tag (fetch-depth: 0)`);
        continue;
      }
      const snap = await snapshotOf(published, `probe-${r.version}.html`);
      assert.equal(sha256Hex(snap), r.kit ?? r.keep, `${r.version}: kit hash as Chrome writes it`);
    }
  });
});
