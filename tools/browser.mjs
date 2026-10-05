// Drive a real browser with no dependencies: Chrome over the DevTools
// protocol, Firefox over WebDriver BiDi, both through Node's built-in
// WebSocket. One small page API on top, so the same end-to-end flows run in
// both engines (test/browser.test.mjs) and the README screenshots can be
// regenerated (tools/screenshots.mjs).
//
//   const browser = await launch("chrome" | "firefox", { workDir });
//   const page = await browser.open(fileUrl);
//   await page.click("Create a Recovery Kit"); ...
//   await browser.close();

import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const CHROME_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
const FIREFOX_PATHS = ["/Applications/Firefox.app/Contents/MacOS/firefox"];
const FIREFOX_NAMES = ["firefox"];

/** The browser's executable, or null: env override, known paths, then PATH. */
export function findBrowser(kind) {
  const env = kind === "chrome" ? process.env.CHROME_PATH : process.env.FIREFOX_PATH;
  const paths = kind === "chrome" ? CHROME_PATHS : FIREFOX_PATHS;
  const names = kind === "chrome" ? CHROME_NAMES : FIREFOX_NAMES;
  for (const p of [env, ...paths]) if (p && existsSync(p)) return p;
  for (const name of names) {
    try {
      return execFileSync("which", [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch { /* not on PATH */ }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A JSON-over-WebSocket protocol client: numbered commands, plus events. */
async function connect(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === undefined || msg.id === null) {
      for (const fn of listeners) fn(msg);
      return;
    }
    const call = pending.get(msg.id);
    if (!call) return;
    pending.delete(msg.id);
    // CDP reports { error: { message } }, BiDi { type: "error", error, message }
    if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message ?? msg.error} ${msg.message ?? ""}`));
    else call.resolve(msg.result);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`could not open ${url}`));
  });
  return {
    send(method, params = {}, extra = {}) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params, ...extra }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
    },
    /** Resolves with the first message matching `match` (method + filter). */
    once(method, match = () => true, timeout = 20_000) {
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
}

/** Start the process and wait for the line naming its WebSocket endpoint. */
function startProcess(exe, args, pattern) {
  const proc = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
  const url = new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`${exe} did not start:\n${log}`)), 45_000);
    const onData = (chunk) => {
      log += chunk;
      const m = log.match(pattern);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`${exe} exited (${code}):\n${log}`)); });
  });
  return { proc, url };
}

async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

/**
 * The page API both engines share. `engine` supplies:
 *   evaluate(expression) -> JSON-able value (the expression is awaited)
 *   setFiles(selector, paths), type(text), screenshot() -> PNG Buffer,
 *   close(), errors (an array that fills with page errors)
 */
function pageApi(engine) {
  const page = {
    errors: engine.errors,
    eval: (expression) => engine.evaluate(expression),
    async waitFor(expression, what, timeout = 20_000) {
      const until = Date.now() + timeout;
      for (;;) {
        const value = await engine.evaluate(expression);
        if (value) return value;
        if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
        await sleep(50);
      }
    },
    /** Click the first enabled button whose text contains `text`. */
    async click(text) {
      const find = `[...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled)`;
      await page.waitFor(`Boolean(${find})`, `an enabled "${text}" button`);
      await engine.evaluate(`(${find}).click(), true`);
    },
    /** Focus the element `selector` picks (the `nth` match) and type into it
     *  through the browser's own input pipeline. */
    async typeInto(selector, text, nth = 0) {
      await page.waitFor(`Boolean(document.querySelectorAll(${JSON.stringify(selector)})[${nth}])`,
        `element ${selector} #${nth}`);
      await engine.evaluate(`(() => {
        const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
        el.focus();
        el.setSelectionRange?.(el.value.length, el.value.length);
        return true;
      })()`);
      await engine.type(text);
    },
    setFiles: (selector, paths) => engine.setFiles(selector, paths),
    text: () => engine.evaluate("document.body.innerText"),
    /** Text of every element matching `selector`, whitespace collapsed. */
    texts: (selector) => engine.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})]
      .map((n) => n.textContent.replace(/\\s+/g, " ").trim())`),
    /** Record every file the page hands the browser to download from now on:
     *  the app's downloads are Blob URLs clicked through an anchor. */
    async captureDownloads() {
      await engine.evaluate(`(() => {
        if (window.__keepDownloads) return true;
        window.__keepDownloads = [];
        const blobs = new Map();
        const create = URL.createObjectURL;
        URL.createObjectURL = function (blob) {
          const url = create.call(URL, blob);
          blobs.set(url, blob);
          return url;
        };
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download && blobs.has(this.href)) {
            window.__keepDownloads.push({ name: this.download, blob: blobs.get(this.href) });
          }
          return click.call(this);
        };
        return true;
      })()`);
    },
    /** The text of the n-th captured download (counting from the end). */
    download: (fromEnd = 1) => engine.evaluate(`(async () => {
      const d = window.__keepDownloads[window.__keepDownloads.length - ${fromEnd}];
      return d ? { name: d.name, text: await d.blob.text() } : null;
    })()`),
    downloadCount: () => engine.evaluate("window.__keepDownloads.length"),
    screenshot: () => engine.screenshot(),
    /** Resize the viewport (CSS pixels); Chrome only. */
    setViewport: (width, height) => {
      if (!engine.setViewport) throw new Error("setViewport is not supported in this engine");
      return engine.setViewport(width, height);
    },
    close: () => engine.close(),
  };
  return page;
}

async function launchChrome(exe, { workDir, width, height, scale, beforeLoad, media }) {
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${join(workDir, "chrome-profile")}`, "--remote-debugging-port=0",
  ];
  // GitHub's Linux runners cannot set up Chrome's sandbox; every page here is
  // our own local file, so running it unsandboxed there is fine
  if (process.platform === "linux") args.push("--no-sandbox");
  args.push("about:blank");
  const { proc, url } = startProcess(exe, args, /DevTools listening on (ws:\/\/\S+)/);
  const client = await connect(await url);
  const downloads = join(workDir, "downloads");
  await mkdir(downloads, { recursive: true });
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });

  return {
    kind: "chrome",
    client,
    downloads,
    async open(pageUrl) {
      const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params) => client.send(method, params, { sessionId });
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
      if (width) {
        await send("Emulation.setDeviceMetricsOverride",
          { width, height, deviceScaleFactor: scale ?? 1, mobile: false });
      }
      if (media) await send("Emulation.setEmulatedMedia", { features: media });
      if (beforeLoad) await send("Page.addScriptToEvaluateOnNewDocument", { source: beforeLoad });
      const loaded = client.once("Page.loadEventFired", (m) => m.sessionId === sessionId);
      await send("Page.navigate", { url: pageUrl });
      await loaded;
      return pageApi({
        errors,
        async evaluate(expression) {
          const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) {
            throw new Error(`in page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
          }
          return r.result.value;
        },
        async setFiles(selector, files) {
          const { root } = await send("DOM.getDocument");
          const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
          await send("DOM.setFileInputFiles", { nodeId, files });
        },
        async type(text) {
          // a line break is the Enter key, as a person types it
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]) await send("Input.insertText", { text: lines[i] });
            if (i < lines.length - 1) {
              const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
              await send("Input.dispatchKeyEvent", { type: "keyDown", ...enter, text: "\r" });
              await send("Input.dispatchKeyEvent", { type: "keyUp", ...enter });
            }
          }
        },
        async screenshot() {
          const { data } = await send("Page.captureScreenshot", { format: "png" });
          return Buffer.from(data, "base64");
        },
        setViewport: (w, h) => send("Emulation.setDeviceMetricsOverride",
          { width: w, height: h, deviceScaleFactor: scale ?? 1, mobile: false }),
        close: () => client.send("Target.closeTarget", { targetId }),
      });
    },
    async close() {
      client.close();
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill();
      await exited;
    },
  };
}

async function launchFirefox(exe, { workDir, width, height }) {
  const profile = join(workDir, "firefox-profile");
  const downloads = join(workDir, "downloads");
  await mkdir(profile, { recursive: true });
  await mkdir(downloads, { recursive: true });
  // downloads land in the work directory, never in the user's own folder
  await writeFile(join(profile, "user.js"), [
    'user_pref("browser.download.folderList", 2);',
    `user_pref("browser.download.dir", ${JSON.stringify(downloads)});`,
    'user_pref("browser.download.useDownloadDir", true);',
    'user_pref("browser.download.always_ask_before_handling_new_types", false);',
    'user_pref("browser.download.alwaysOpenPanel", false);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
  ].join("\n") + "\n");
  const port = await freePort();
  const args = ["--headless", "--no-remote", "--profile", profile, `--remote-debugging-port=${port}`];
  if (width) args.push("--width", String(width), "--height", String(height));
  args.push("about:blank");
  const { proc, url } = startProcess(exe, args, /WebDriver BiDi listening on (ws:\/\/\S+)/);
  const client = await connect(`${await url}/session`);
  await client.send("session.new", { capabilities: {} });
  await client.send("session.subscribe", { events: ["log.entryAdded"] });

  return {
    kind: "firefox",
    client,
    downloads,
    async open(pageUrl) {
      const { context } = await client.send("browsingContext.create", { type: "tab" });
      const errors = [];
      client.listen((msg) => {
        if (msg.method !== "log.entryAdded" || msg.params.source?.context !== context) return;
        if (msg.params.level === "error") errors.push(msg.params.text);
      });
      await client.send("browsingContext.navigate", { context, url: pageUrl, wait: "complete" });

      async function evaluate(expression, ownership = "none") {
        const r = await client.send("script.evaluate", {
          expression, target: { context }, awaitPromise: true, resultOwnership: ownership,
        });
        if (r.type === "exception") {
          throw new Error(`in page: ${r.exceptionDetails.text}`);
        }
        return r.result;
      }
      return pageApi({
        errors,
        async evaluate(expression) {
          // values cross as JSON so both engines hand back the same shapes
          const r = await evaluate(`(async () => JSON.stringify(await (${expression})))()`);
          return r.type === "string" ? JSON.parse(r.value) : undefined;
        },
        async setFiles(selector, files) {
          const node = await evaluate(`document.querySelector(${JSON.stringify(selector)})`, "root");
          await client.send("input.setFiles", { context, element: { sharedId: node.sharedId }, files });
        },
        async type(text) {
          const actions = [];
          for (const ch of text) {
            const key = ch === "\n" ? "\uE007" : ch; // WebDriver's Enter key
            actions.push({ type: "keyDown", value: key }, { type: "keyUp", value: key });
          }
          await client.send("input.performActions",
            { context, actions: [{ type: "key", id: "keyboard", actions }] });
        },
        async screenshot() {
          const { data } = await client.send("browsingContext.captureScreenshot", { context });
          return Buffer.from(data, "base64");
        },
        close: () => client.send("browsingContext.close", { context }),
      });
    },
    async close() {
      try { await client.send("session.end", {}); } catch { /* already gone */ }
      client.close();
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill();
      await exited;
    },
  };
}

/**
 * Start a headless browser. `workDir` holds its profile and downloads.
 * Optional `width`/`height`/`scale` set the viewport. Chrome only:
 * `beforeLoad` is a script run in every page before its own, `media` a list
 * of emulated media features ({ name, value }).
 */
export async function launch(kind, options) {
  const exe = findBrowser(kind);
  if (!exe) throw new Error(`no ${kind} found (set ${kind === "chrome" ? "CHROME_PATH" : "FIREFOX_PATH"})`);
  return kind === "chrome" ? launchChrome(exe, options) : launchFirefox(exe, options);
}
