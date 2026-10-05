// Regenerate the README screenshots (docs/screenshots/*.png) from the
// current source, the same way every time: headless Chrome at 1280×860 and
// 2× pixel density, reduced motion (so nothing is caught mid-animation and
// the home heading holds its first line), and the browser's randomness and
// clock pinned to the golden vector's seed and date. The ceremony therefore
// produces the exact demo vault — fingerprint 0F7AB044, set 6F71, the keys
// published in test/vault.test.mjs — and every picture agrees with the demo
// kit. Nothing real is ever on screen.
//
// Run: node tools/screenshots.mjs

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./browser.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs/screenshots");

// the golden vector: seededRandomBytes(0xC0FFEE) at 1755500000
// (test/helpers.mjs, test/vault.test.mjs), replayed through the browser's
// own crypto.getRandomValues — one xorshift32 word per four bytes asked for
const PINNED = `(() => {
  let s = 0xc0ffee;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
  Object.defineProperty(Crypto.prototype, "getRandomValues", { value(arr) {
    const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < u8.length; i += 4) {
      const v = next();
      for (let b = 0; b < 4 && i + b < u8.length; b++) u8[i + b] = (v >>> (8 * b)) & 0xff;
    }
    return arr;
  } });
  Date.now = () => 1755500000000;
})();`;

const PASSWORD = "CORRECT HORSE BATTERY STAPLE";
const FINGERPRINT = "0F7AB044";

const has = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;
const heading = (text) =>
  `document.querySelector("h1")?.textContent.replace(/_$/, "") === ${JSON.stringify(text)}`;
const still = (page) => page.eval("new Promise((r) => setTimeout(() => r(true), 400))");

const work = await mkdtemp(join(tmpdir(), "keep-shots-"));
const build = join(work, "build");
execFileSync(process.execPath, [join(root, "build.mjs"), "--out", build], { stdio: "pipe" });

const browser = await launch("chrome", {
  workDir: work, width: 1280, height: 860, scale: 2,
  beforeLoad: PINNED,
  media: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
const shot = async (page, name) => {
  await still(page);
  await writeFile(join(out, name), await page.screenshot());
  console.log(`docs/screenshots/${name}`);
};

try {
  // the blank tool and a ceremony that yields the golden kit
  let page = await browser.open(pathToFileURL(join(build, "keep.html")).href);
  await shot(page, "home.png");
  await page.click("Create a Recovery Kit");
  await page.click("CONTINUE");
  await page.waitFor(heading("HOW MANY KEYS WOULD YOU LIKE?"), "the parameters");
  await shot(page, "params.png");
  await page.click("CONTINUE");
  await page.typeInto("input.fieldin", PASSWORD, 0);
  await page.typeInto("input.fieldin", PASSWORD, 1);
  await page.click("CONTINUE");
  const cards = [];
  for (let i = 1; i <= 5; i++) {
    await page.waitFor(heading(`KEY ${i}`), `key ${i}`, 30_000);
    if (i === 1) await shot(page, "key.png");
    const card = await page.eval(`document.querySelector(".well.key").textContent.replace(/\\s+/g, "")`);
    cards.push(card);
    await page.click("VERIFY");
    await page.typeInto("textarea", card);
    await page.click("CONTINUE");
  }
  await page.waitFor(heading("TEST YOUR KEYS"), "the proof");
  for (const [slot, card] of [cards[0], cards[2], cards[4]].entries()) await page.typeInto("textarea", card, slot);
  await page.click("TEST THE RECOVERY");
  await page.click("CONTINUE");
  await page.waitFor(heading("SAVE YOUR KIT"), "the save step");
  if (!(await page.eval(has(FINGERPRINT)))) {
    throw new Error(`the ceremony did not produce the golden vault (fingerprint ${FINGERPRINT})`);
  }
  // taller than the window, so the file hash the README caption names is in
  // the picture too
  const hashBottom = await page.eval(`Math.ceil([...document.querySelectorAll(".well")].pop()
    .nextElementSibling.getBoundingClientRect().bottom + window.scrollY)`);
  await page.setViewport(1280, hashBottom + 40);
  await shot(page, "save-kit.png");
  await page.setViewport(1280, 860);
  await page.captureDownloads();
  await page.click("CREATE RECOVERY FILE");
  const kit = (await page.download()).text;
  await page.close();
  const kitPath = join(work, "RECOVERY.html");
  await writeFile(kitPath, kit);

  // the kit the ceremony wrote
  page = await browser.open(pathToFileURL(kitPath).href);
  await page.waitFor(heading("YOUR RECOVERY KIT"), "the kit home");
  await page.waitFor(`[...document.querySelectorAll(".well")].some((w) => /[0-9a-f]{4}/.test(w.textContent))`,
    "the file hash");
  await shot(page, "recovery-home.png");
  await page.click("Recover the Secret");
  for (const [slot, card] of [cards[0], cards[2], cards[4]].entries()) {
    await page.typeInto("textarea", card.match(/.{1,4}/g).join(" "), slot);
  }
  await page.waitFor(`document.querySelectorAll(".note-ok").length === 3`, "three accepted keys");
  // typing scrolled to the last field and left a caret in it: back to the top
  await page.eval("document.activeElement.blur(), window.scrollTo(0, 0), true");
  await shot(page, "recover.png");
  await page.click("RECOVER THE SECRET");
  await page.waitFor(heading("SECRET RECOVERED"), "the recovered screen");
  await page.eval(`document.querySelector(".btn-hold")
    .dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true })), true`);
  await shot(page, "recovered.png");
  await page.close();

  // the blank tool vouching for that kit
  page = await browser.open(pathToFileURL(join(build, "keep.html")).href);
  await page.click("Verify a Recovery Kit");
  await page.setFiles("input[type=file]", [kitPath]);
  await page.waitFor(has("Genuine."), "the verdict");
  await shot(page, "verify.png");
  await page.close();
} finally {
  await browser.close();
  await rm(work, { recursive: true, force: true, maxRetries: 5 });
}
