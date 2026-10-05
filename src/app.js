// Application shell. This file is concatenated after the core modules
// by build.mjs into one inline script block, so it must not redeclare
// any name the modules export (split, combine, subtle, MAGIC, ...).
//
// IMPORTANT: no string or comment in this file may contain a literal
// script tag (opening or closing) — the opening form would break the
// build's tag-count lint, the closing form would terminate the inline
// script. Both are always assembled by concatenation below. The build
// also rejects URL-shaped and network-shaped strings, so nothing here
// may spell out a scheme or a network API.

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

// pristine source snapshot, captured before any UI mutation; used to
// regenerate personalized copies of this very file. It holds only what the
// parser has read by the time this script runs: anything placed after the
// script never reaches a RECOVERY.html, which is why the licence lives in
// the header comment. The template is laid out so this equals the file byte
// for byte (build.mjs lints it, the "Exact Copy" self-test proves it here)
const SOURCE_SNAPSHOT = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;

const APP_VERSION = "KEEP 1.1.0";
// the human form of the stamp, for the rail's bottom-left margin; the
// "KEEP x.y" form above is what other builds' upgrade probes look for
const APP_VERSION_LABEL = APP_VERSION.replace(/^KEEP /, "Version ");
// SHA-256 of this blank file with the slot below emptied again, stamped in
// by build.mjs — the one fact a file can carry about itself
const BUILD_DIGEST = "@@BUILD_DIGEST@@";
const appRoot = document.getElementById("app");
const railRoot = document.getElementById("rail");

/* ------------------------------------------------------------------ */
/* icons — 19px stroke marks, amber, never filled                      */
/* ------------------------------------------------------------------ */

const ICONS = {
  eye: ['<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/>' +
    '<circle class="i-pupil" cx="12" cy="12" r="2.6"/>', 1.8],
  shield: ['<path d="M4 5.5 12 3l8 2.5v6c0 4.7-3.3 7.9-8 9.5-4.7-1.6-8-4.8-8-9.5v-6z"/>' +
    '<path class="i-draw" pathLength="1" d="m8.8 12 2.3 2.3 4.1-4.6"/>', 1.8],
  pen: ['<g class="i-pen"><path d="M4 20.5 5 16l10.6-10.6a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8 19l-4 1.5z"/>' +
    '<path d="m14 7.5 2.5 2.5"/></g>', 1.8],
  unlock: ['<rect x="4" y="10.5" width="16" height="10" rx="1.5"/>' +
    '<path class="i-shackle" d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.3v2.6"/>', 1.9],
  wave: ['<path class="i-draw" pathLength="1" d="M3 12h4l2.5-6 5 12 2.5-6h4"/>', 1.9],
  wifi: ['<path d="M1.9 9.2a16 16 0 0 1 20.2 0"/><path d="M5.3 12.6a11 11 0 0 1 13.4 0"/>' +
    '<path d="M8.7 16a6 6 0 0 1 6.6 0"/><path d="M12 19.5h.01"/>' +
    '<path class="i-slash" pathLength="1" d="m3.5 3.5 17 17"/>', 1.9],
  printer: ['<path d="M7 9V3.6h10V9"/><rect x="3.5" y="9" width="17" height="7.5" rx="1.4"/>' +
    '<path class="i-paper" d="M7 14h10v6.4H7z"/>', 1.9],
  rotate: ['<path d="M20 12a8 8 0 0 1-13.7 5.6"/><path d="M4 12a8 8 0 0 1 13.7-5.6"/>' +
    '<path d="M17.7 3v3.5h-3.5"/><path d="M6.3 21v-3.5h3.5"/>', 1.9],
  warning: ['<path d="M12 4 2.5 20h19L12 4z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>', 2],
  info: ['<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.1"/>', 2],
  check: ['<path class="i-draw" pathLength="1" d="m4.5 12.5 5 5 10-11"/>', 2.2],
  download: ['<path d="M12 4v10.5m0 0 4.3-4.3M12 14.5 7.7 10.2"/><path d="M4.5 19.5h15"/>', 1.9],
};

function icon(name) {
  const [body, weight] = ICONS[name];
  const span = document.createElement("span");
  span.className = "icon icon-" + name;
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + weight +
    '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  return span;
}

let PARSED_VAULT = null; // parsed vault when this is a personalized file
let VAULT_LOAD_ERROR = null;

function readEmbeddedVaultB64() {
  const node = document.getElementById("pkr-vault");
  if (!node) return null;
  const text = node.textContent.trim();
  return text && text !== "null" ? text : null;
}

/** The code digest of this very tool: what a kit made here reduces to. */
let selfDigestPromise = null;
function selfDigest() {
  selfDigestPromise ??= codeDigest(SOURCE_SNAPSHOT);
  return selfDigestPromise;
}

/* ------------------------------------------------------------------ */
/* tiny DOM helpers                                                    */
/* ------------------------------------------------------------------ */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

/** Page title: mono caps, always ending in a blinking cursor. */
function title(text) {
  return el("h1", {}, [text, el("span", { class: "cur", text: "_", "aria-hidden": "true" })]);
}

function lead(text) {
  return el("p", { class: "lead", text });
}

function rule() {
  return el("div", { class: "rule" });
}

function hair() {
  return el("div", { class: "hair" });
}

const NOTE_ICON = { ok: "check", info: "info", bad: "warning" };

/**
 * Notice box. Kinds: "ok" (amber, a check), "info" (amber, a circle),
 * "bad" (orange, a triangle), "blank" (invisible, but it still reserves
 * its 52px so nothing below it jumps).
 */
function note(kind, ...children) {
  const parts = kind === "blank" ? [] : [icon(NOTE_ICON[kind])];
  return el("div", { class: `note note-${kind}` }, [...parts, el("span", {}, children)]);
}

function well(text, variant = "") {
  return el("div", { class: `well ${variant}`.trim(), text });
}

function statGrid(entries) {
  return el("div", { class: "stats" }, entries.map(([label, value]) =>
    el("div", { class: "stat" }, [
      el("div", { class: "l", text: label }),
      el("div", { class: "v", text: value }),
    ])));
}

function btn(label, onclick, extra = "") {
  return el("button", { class: `btn btn-ghost ${extra}`.trim(), type: "button", onclick, text: label });
}

/** The one amber action of a screen. Returns the button; `setOn` gates it. */
function goBtn(label, onclick, enabled = true) {
  const node = el("button", { class: "btn btn-go", type: "button", onclick }, [
    label, el("span", { class: "gocur", text: "_", "aria-hidden": "true" }),
  ]);
  if (!enabled) node.setAttribute("disabled", "");
  return node;
}

function setEnabled(node, on) {
  if (on) node.removeAttribute("disabled");
  else node.setAttribute("disabled", "");
}

function navRow(...children) {
  return el("div", { class: "btnrow" }, children);
}

/** Action row: 42px icon plate, title, subtitle, blinking cursor on hover. */
function actionRow(iconName, t, d, onclick, tall = false) {
  return el("button", { class: `row${tall ? " tall" : ""}`, type: "button", onclick }, [
    el("span", { class: "plate" }, icon(iconName)),
    el("span", { class: "body" }, [
      el("span", { class: "t" }, [t, el("span", { class: "rowcur", text: "_", "aria-hidden": "true" })]),
      el("span", { class: "d", text: d }),
    ]),
  ]);
}

function fmtDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

/** Hex string in groups of 4, easier to write down and compare. */
function groupHex(hex) {
  return hex.replace(/(.{4})/g, "$1 ").trim();
}

/** "the key" | "any one key" | "all 3 keys" | "any 3 keys" — the count
 *  phrase for a k-of-n scheme, kept grammatical down to 1-of-1. */
function keyCountPhrase(k, n) {
  if (k === 1) return n === 1 ? "the key" : "any one key";
  return k === n ? `all ${k} keys` : `any ${k} keys`;
}

/** The stat-grid / letter form of the scheme: "3 of 5 keys + owner's key". */
function schemeLabel(k, n, ownerSeparate) {
  return `${k} of ${n} ${n === 1 ? "key" : "keys"}${ownerSeparate ? " + owner's key" : ""}`;
}

/** The verify screens' wrong-set diagnosis, built fresh per call — a
 *  shared <br> node would be moved between notes, not copied. */
function wrongSetMessage(typedSetHex, kitSetHex) {
  return [
    `You have filled in a key from key set ${typedSetHex}. ` +
    `Please use the key for this key set: ${kitSetHex}`,
    el("br"),
    "Did you copy a sheet from another run?",
  ];
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/* ------------------------------------------------------------------ */
/* the key mark — teeth cut from the live parameters                   */
/* ------------------------------------------------------------------ */

/** Mean of every part's travel, so the exploded key stays centred. */
function markSpread(total) {
  let sum = -5.4;
  for (let i = 0; i < total; i++) sum += 2.4 + i * 2.6;
  return sum / (total + 1);
}

/**
 * Long tooth = a key that counts toward the threshold, short = spare.
 * The familiar tail (…short, long, long) is kept whenever the numbers
 * allow. Tooth size and pitch are fixed: more keys make the key longer,
 * not the teeth bigger.
 */
function cutKey(total, needed) {
  const pattern = [];
  let longs = needed;
  let shorts = total - needed;
  const tail = total >= 3 && longs >= 2 && shorts >= 1 ? ["s", "l", "l"] : null;
  if (tail) { shorts -= 1; longs -= 2; }
  const leadCount = total - (tail ? 3 : 0);
  let want = "s";
  for (let i = 0; i < leadCount; i++) {
    const pick = want === "s" ? (shorts > 0 ? "s" : "l") : (longs > 0 ? "l" : "s");
    pattern.push(pick);
    if (pick === "s") shorts--; else longs--;
    want = pick === "s" ? "l" : "s";
  }
  if (tail) pattern.push(...tail);
  else for (let i = pattern.length; i < total; i++) pattern.push(longs-- > 0 ? "l" : "s");

  const first = 9.6;
  const w = 2.5;
  const pitch = 2.95;
  return pattern.map((p, i) => ({
    x: +(first + i * pitch).toFixed(2),
    w,
    h: p === "l" ? 9.2 : 4.6,
    op: p === "l" ? 1 : 0.28,
    dx: (2.4 + i * 2.6 - markSpread(total)).toFixed(2) + "px",
    ed: 18 + i * 18 + "ms",
    rd: (total - 1 - i) * 18 + "ms",
  }));
}

/** The bow (the circle — the part of a key that stays in your hand) reads
 *  like the teeth do: dimmed like a spare while the owner's key half sits
 *  buried inside the kit file, full amber once it is a separate owner's key
 *  the owner actually holds. */
function markMarkup(total, needed, ownerSeparate = false) {
  const teeth = cutKey(total, needed);
  const width = Math.round((9.6 + total * 2.95 - 1.2) * (42 / 23.15));
  const box = "0.75 0 " + (9.6 + total * 2.95 - 0.75 - 0.45).toFixed(2) + " 24";
  const bowDx = (-5.4 - markSpread(total)).toFixed(2) + "px";
  const bowOp = ownerSeparate ? 1 : 0.28;
  let out =
    '<svg class="kmark" width="' + width + '" height="42" viewBox="' + box + '" aria-hidden="true">' +
    '<g class="kp" style="--dx:' + bowDx + ';--ed:0ms;--rd:' + total * 18 + 'ms">' +
    '<circle class="kb" cx="4.4" cy="10" r="3" fill="none" stroke="#ffb000" stroke-width="2.6" opacity="' + bowOp + '"></circle>' +
    "</g><g fill=\"#ffb000\">";
  for (const t of teeth) {
    out +=
      '<g class="kp" style="--dx:' + t.dx + ";--ed:" + t.ed + ";--rd:" + t.rd + '">' +
      '<rect class="kb" x="' + t.x + '" y="8.4" width="' + t.w + '" height="' + t.h +
      '" opacity="' + t.op + '"></rect></g>';
  }
  return out + "</g></svg>";
}

/**
 * Explode on enter, reassemble on leave, with a dock-style gaussian
 * falloff while the pointer is over it: parts near the cursor step
 * aside, so the one you point at stands alone.
 */
function wireMark(mark) {
  const shapes = [...mark.querySelectorAll(".kb")];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SIGMA = 11;
  const SPREAD = 14;
  const NORM = Math.exp(-0.5);
  const rest = () => shapes.forEach((s) => s.style.setProperty("--mx", "0px"));
  let raf = 0;
  let mx = 0;
  function paint() {
    raf = 0;
    const ratio = 23.15 / mark.getBoundingClientRect().width;
    for (const s of shapes) {
      const r = s.getBoundingClientRect();
      const d = mx - (r.left + r.width / 2);
      const g = Math.exp(-(d * d) / (2 * SIGMA * SIGMA));
      s.style.setProperty("--mx", (-(d / SIGMA) * g / NORM * SPREAD * ratio).toFixed(2) + "px");
    }
  }
  mark.addEventListener("pointerenter", () => {
    mark.classList.remove("is-in");
    mark.classList.add("is-out");
  });
  mark.addEventListener("pointermove", (e) => {
    if (reduce || !mark.classList.contains("is-out")) return;
    mx = e.clientX;
    if (!raf) raf = requestAnimationFrame(paint);
  }, { passive: true });
  mark.addEventListener("pointerleave", () => {
    mark.classList.remove("is-out");
    mark.classList.add("is-in");
    cancelAnimationFrame(raf);
    raf = 0;
    rest();
  });
}

/* ------------------------------------------------------------------ */
/* rail                                                                */
/* ------------------------------------------------------------------ */

let MARK_N = 5;
let MARK_K = 3;
let MARK_OWNER = false; // owner's key outside the file -> orange bow on the mark

/**
 * The rail has two moods: during the ceremony it is a numbered progress
 * list, inside a kit it is navigation. The key mark sits at the bottom
 * of both.  spec: { home, items: [{ label, state, go }] }
 */
function renderRail(spec = {}) {
  const word = spec.home
    ? el("button", { class: "kword link", type: "button", onclick: spec.home })
    : el("span", { class: "kword" });
  word.append(el("span", { text: "KEEP" }));
  // clicking the wordmark re-renders the rail under the pointer, so the new
  // one mounts already hovered and would travel to the compact spacing again.
  // It should simply arrive there: the animation belongs to the cursor moving
  // over the word, not to navigating with it.
  word.classList.add("nofx");
  setTimeout(() => word.classList.remove("nofx"), 60);

  const inner = el("div", { class: "railin" }, word);

  if (spec.items && spec.items.length) {
    inner.append(el("div", { class: "steplist" }, spec.items.map((it) => {
      const parts = [it.icon ? icon(it.icon) : null, it.label];
      return it.state === "link"
        ? el("button", { class: "navitem", type: "button", onclick: it.go }, parts)
        : el("span", { class: it.state }, parts);
    })));
  }

  const wrap = el("div", { class: "markwrap" });
  wrap.innerHTML = markMarkup(MARK_N, MARK_K, MARK_OWNER);
  inner.append(wrap);
  // the build's version, stamped in the bottom-left margin under the key
  // mark: every screen names the tool that produced it
  inner.append(el("div", { class: "railver", text: APP_VERSION_LABEL }));
  railRoot.replaceChildren(inner);
  wireMark(wrap.querySelector(".kmark"));
}

/** Rail for any screen inside a personalized kit. On the kit's own home
 *  screen the wordmark is inert: clicking it there would re-render the
 *  view you are already looking at and replay its entry animation. */
function kitRail(active, atHome = false) {
  const entries = [
    ["RECOVER SECRET", "Recover Secret", showRecover, "unlock"],
    ["CHECK THIS KIT", "Check this Kit", showCheckKit, "shield"],
    ["CHANGE SECRET", "Change Secret", showRotate, "rotate"],
    ["PRINT", "Print Instructions", () => showLetter(PARSED_VAULT, showHome, "usb"), "printer"],
    ["RUN SELF-TEST", "Run Self-Test", showSelfTest, "wave"],
  ];
  const current = entries.find(([label]) => label === active);
  return {
    home: atHome ? null : showHome,
    page: atHome ? "Recovery Home" : current && current[1],
    items: entries.map(([label, , go, ic]) => ({
      label,
      state: label === active ? "now" : "link",
      go,
      icon: ic,
    })),
  };
}

/** Rail label (mono caps) and browser-tab name for each ceremony step. */
const CEREMONY_STEPS = [
  ["01 PRECAUTIONS", "01 Precautions"],
  ["02 PARAMETERS", "02 Parameters"],
  ["03 THE SECRET", "03 The Secret"],
  ["04 KEYS", "04 Keys"],
  ["05 THE PROOF", "05 The Proof"],
  ["06 SAVE THE KIT", "06 Save the Kit"],
];

/** True from the moment the secret is handed over to be encrypted: past that
 *  point the ceremony holds keys that exist nowhere else, so leaving costs
 *  the owner real work. Before it, the precautions and the parameters are
 *  the only things on screen and the wordmark just leads home. */
let CEREMONY_LIVE = false;

/** Broken in two on purpose: what is lost, then what it costs to redo it.
 *  Built fresh per call — a shared <br> node would be moved, not copied. */
function leaveCeremonyMessage() {
  return [
    "Leaving now ends this ceremony. The keys generated so far are discarded, any " +
    "secret is cleared from memory, nothing is saved,",
    el("br"),
    "and you would have to start again from the beginning.",
  ];
}

/** The one way out of a live ceremony: confirm, then reload — which is what
 *  actually clears the secret and the keys, rather than routing around them. */
function confirmLeaveCeremony() {
  confirmModal(leaveCeremonyMessage(), "ERASE AND LEAVE", () => location.reload());
}

/** Rail for the creation ceremony: done ✓, current, pending.
 *
 *  Once the ceremony is live the way out is a confirmation and then a
 *  reload — which drops the secret and the keys from memory rather than
 *  leaving them reachable behind the home screen. */
function ceremonyRail(step, currentLabel) {
  return {
    home: CEREMONY_LIVE ? confirmLeaveCeremony : showHome,
    page: (CEREMONY_STEPS[step - 1] || [])[1],
    items: CEREMONY_STEPS.map(([label], i) => {
      const n = i + 1;
      if (n < step) return { label: `${label} ✓`, state: "done" };
      if (n > step) return { label, state: "todo" };
      return { label: currentLabel || label, state: "now" };
    }),
  };
}

/** Same rail, different tab name: screens reachable from more than one place. */
function railPage(spec, page) {
  return { ...spec, page };
}

/* ------------------------------------------------------------------ */
/* view plumbing                                                       */
/* ------------------------------------------------------------------ */

let viewTimers = [];
let viewResize = null;
let viewCleanups = [];

/** Overlay scrollbar for a box inside the current view. Mounted on the next
 *  frame: views are built before render() runs, and render is what flushes
 *  the previous view's cleanups — attaching after it keeps this one alive. */
function mountBoxScrollbar(scrollNode, host) {
  // setTimeout, not rAF: frames stall in hidden tabs, and the ordering only
  // needs to be "after the render() that mounts this view"
  setTimeout(() => {
    const sb = createEdgeScrollbar(scrollNode, host);
    viewCleanups.push(sb.destroy);
    viewInterval(sb.update, 150); // safety net for growth nothing observes
  }, 0);
}

/** A resize listener that lives only as long as the current view. */
function onViewResize(fn) {
  viewResize = fn;
  window.addEventListener("resize", fn);
}

/** setTimeout/setInterval bound to the current view; cleared on the next. */
function viewTimeout(fn, ms) {
  const id = setTimeout(fn, ms);
  viewTimers.push([id, clearTimeout]);
  return id;
}
function viewInterval(fn, ms) {
  const id = setInterval(fn, ms);
  viewTimers.push([id, clearInterval]);
  return id;
}

function render(rail, ...nodes) {
  for (const [id, clear] of viewTimers) clear(id);
  viewTimers = [];
  for (const fn of viewCleanups) fn();
  viewCleanups = [];
  if (viewResize) { window.removeEventListener("resize", viewResize); viewResize = null; }
  for (const layer of document.querySelectorAll(".modal")) layer.remove();
  // the tab follows the view: every screen names itself through its rail spec,
  // so a screen that forgets falls back to the bare wordmark rather than
  // leaving the previous screen's name behind
  document.title = rail && rail.page ? `KEEP — ${rail.page}` : "KEEP";
  renderRail(rail);
  appRoot.replaceChildren(el("div", { class: "view" }, nodes));
  window.scrollTo(0, 0);
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function downloadHtml(content, filename) {
  downloadBlob(content, filename, "text/html");
}

function downloadText(content, filename) {
  downloadBlob(content, filename, "text/plain");
}

/** Confirmation sheet over the screen, with a countdown on the action. */
function confirmModal(message, actionLabel, onConfirm, seconds = 3) {
  let left = seconds;
  const action = goBtn(`${actionLabel} (${left})`, () => {
    if (left > 0) return;
    close();
    onConfirm();
  }, false);
  const backBtn = btn("BACK", () => close());
  const layer = el("div", { class: "modal" }, el("div", { class: "msheet" }, [
    el("p", { class: "mtext" }, [].concat(message)),
    el("div", { class: "btnrow" }, [backBtn, action]),
  ]));
  const tick = setInterval(() => {
    left -= 1;
    action.firstChild.textContent = left > 0 ? `${actionLabel} (${left})` : actionLabel;
    if (left <= 0) { clearInterval(tick); setEnabled(action, true); }
  }, 1000);
  function close() {
    clearInterval(tick);
    layer.remove();
  }
  document.body.append(layer);
}

/* ------------------------------------------------------------------ */
/* fields                                                              */
/* ------------------------------------------------------------------ */

/**
 * Masked secret input: dots, with the character just typed left visible
 * for 850ms, plus a SHOW/HIDE button.
 *
 * The input is type="text" showing bullets we draw ourselves, so the
 * real value is tracked here from beforeinput events (which carry the
 * exact edit), in a wipeable buffer rather than a string. While revealed,
 * or during IME composition, the field holds the plaintext directly and
 * is synced back on input — the browser owns that copy either way.
 */
/** Unique ids so every control can be tied to its own visible label. */
let uidSeq = 0;
function uid(prefix) {
  uidSeq += 1;
  return `${prefix}${uidSeq}`;
}

function secretField(placeholder, multiline = false) {
  const real = wipeableText();
  let revealed = false;
  let composing = false;
  let peekPos = -1;
  let peekTimer = null;

  const id = uid("secret");
  const input = multiline
    ? el("textarea", {
      id,
      class: "fieldin grow", rows: "6", placeholder,
      autocomplete: "off", spellcheck: "false", autocapitalize: "none",
    })
    : el("input", {
      id,
      type: "text", class: "fieldin", placeholder,
      autocomplete: "off", spellcheck: "false", autocapitalize: "none",
    });
  const toggle = el("button", { class: "btn btn-go", type: "button", text: "SHOW" });

  /** What may enter the buffer: multi-line text keeps newlines (normalised
   *  to LF); a single-line secret never contains one, so the recovery
   *  screen can trust newline-presence as the "large secret" signal. */
  function sanitize(text) {
    return multiline ? text.replace(/\r\n?/g, "\n") : text.replace(/[\r\n]+/g, "");
  }

  function masked() {
    let out = "";
    for (let i = 0; i < real.length; i++) {
      const ch = real.charAt(i);
      out += ch === "\n" ? "\n" : i === peekPos ? ch : "•";
    }
    return out;
  }
  function refresh(caret) {
    input.value = revealed || composing ? real.reveal() : masked();
    if (caret !== undefined) input.setSelectionRange(caret, caret);
  }
  function changed() {
    input.dispatchEvent(new Event("secretchange"));
  }

  input.addEventListener("beforeinput", (e) => {
    if (revealed || composing) return; // plaintext mode, synced on input
    const t = e.inputType || "";
    if (t === "insertCompositionText") return; // handled via composition events
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    let ins = "";
    if (t === "insertLineBreak" || t === "insertParagraph") ins = "\n";
    else if (t.startsWith("insert")) ins = e.data ?? (e.dataTransfer?.getData("text") ?? "");
    ins = sanitize(ins);
    let s = start;
    let epos = end;
    if (t === "deleteContentBackward" && start === end) s = Math.max(0, start - 1);
    else if (t === "deleteContentForward" && start === end) epos = Math.min(real.length, end + 1);
    else if (!t.startsWith("insert") && !t.startsWith("delete")) {
      e.preventDefault(); // undo/history would desync the mask
      return;
    }
    e.preventDefault();
    const added = real.splice(s, epos, ins);
    clearTimeout(peekTimer);
    peekPos = added === 1 ? s : -1;
    refresh(s + added);
    if (peekPos >= 0) {
      peekTimer = setTimeout(() => {
        peekPos = -1;
        refresh(input === document.activeElement ? input.selectionStart : undefined);
      }, 850);
    }
    changed();
  });
  input.addEventListener("input", () => {
    if (revealed || composing) { real.setFrom(sanitize(input.value)); changed(); }
  });
  input.addEventListener("compositionstart", () => {
    composing = true;
    refresh(real.length);
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    real.setFrom(sanitize(input.value));
    refresh(real.length);
    changed();
  });
  toggle.addEventListener("click", () => {
    // keep the reader's place: caret and scroll survive the mask flip
    // instead of jumping to the end of the text
    const caret = input.selectionStart ?? input.value.length;
    const scroll = input.scrollTop;
    revealed = !revealed;
    toggle.textContent = revealed ? "HIDE" : "SHOW";
    clearTimeout(peekTimer);
    peekPos = -1;
    refresh(Math.min(caret, revealed ? real.reveal().length : real.length));
    input.focus();
    input.scrollTop = scroll;
  });

  let fieldNode = input;
  if (multiline) {
    // the overlay scrollbar needs a positioned wrapper riding the box edge
    fieldNode = el("div", { class: "scrollhost" }, [input]);
    mountBoxScrollbar(input, fieldNode);
  }

  return {
    node: el("div", { class: "frow" }, [fieldNode, toggle]),
    id,
    /** UTF-8 bytes of what was typed; the caller owns them and must zero
     *  them (or hand them to something that does). */
    bytes: () => real.bytes(),
    byteLength: () => real.byteLength(),
    length: () => real.length,
    isEmpty: () => real.length === 0,
    /** Compare two fields without either value becoming a string. */
    matches: (other) => other.sameAs(real),
    sameAs: (buffer) => real.equals(buffer),
    clear: () => {
      real.clear();
      peekPos = -1;
      revealed = false;
      toggle.textContent = "SHOW";
      refresh();
    },
    onChange: (fn) => input.addEventListener("secretchange", fn),
  };
}

function labelledSecret(labelText, placeholder, multiline = false) {
  const field = secretField(placeholder, multiline);
  return {
    ...field,
    block: el("div", { class: "field" }, [
      // a real label bound to the input: the caption was only visually
      // adjacent before, which left the field unlabelled to a screen reader
      el("label", { class: "flabel", for: field.id, text: labelText }),
      field.node,
    ]),
  };
}

/**
 * The enter-twice secret pair, with a size switch: a single-line box for a
 * password, a multi-line one for anything bigger — instructions to go with
 * the password, and the like. Switching sizes rebuilds both fields (wiping
 * the old buffers first: a discarded field must not keep a secret) and the
 * choice needs no header flag anywhere — a multi-line secret carries its
 * newlines inside the ciphertext, and the recovery screen sizes itself from
 * those.
 */
function secretPair(firstLabel, againLabel, onChange, onMode) {
  let multiline = false;
  let first = null;
  let again = null;
  const holder = el("div", { class: "secretfields" });

  const tabLine = el("button", { class: "tab on", type: "button", text: "SINGLE LINE" });
  const tabBlock = el("button", { class: "tab", type: "button", text: "MULTIPLE LINES" });
  // the same tab strip the print screen uses: it sits directly on the rule
  // below it, and switching swaps only what the choice concerns
  const tabs = el("div", { class: "tabs" }, [tabLine, tabBlock]);

  function build() {
    if (first) { first.clear(); again.clear(); }
    first = labelledSecret(firstLabel, "Type or paste it here", multiline);
    again = labelledSecret(againLabel, "Type it a second time", multiline);
    first.onChange(onChange);
    again.onChange(onChange);
    holder.replaceChildren(first.block, again.block);
    onChange();
  }

  function pick(wantMultiline) {
    if (wantMultiline === multiline) return;
    multiline = wantMultiline;
    tabLine.className = multiline ? "tab" : "tab on";
    tabBlock.className = multiline ? "tab on" : "tab";
    tabLine.setAttribute("aria-pressed", String(!multiline));
    tabBlock.setAttribute("aria-pressed", String(multiline));
    build();
    if (onMode) onMode(multiline);
  }
  tabLine.setAttribute("aria-pressed", "true");
  tabBlock.setAttribute("aria-pressed", "false");
  tabLine.addEventListener("click", () => pick(false));
  tabBlock.addEventListener("click", () => pick(true));
  build();

  return {
    tabs,
    fields: holder,
    // the live fields, so callers always talk to the current size
    get first() { return first; },
    get again() { return again; },
  };
}

/**
 * Live-validated key entry: `count` textareas checked against `vault`
 * on every keystroke — checksum, set, commitment, and cross-slot
 * duplicates. A slot repeating an earlier slot's key is marked invalid,
 * so the submit button never enables for duplicate keys. Nothing is
 * judged until the entry is as long as a real key.
 */
function keyEntryPanel(vault, count, onChange, placeholder = "Type a key here") {
  const slots = Array.from({ length: count }, (_, i) => {
    const id = uid("key");
    const input = el("textarea", {
      id,
      class: "fieldin", rows: "3", placeholder,
      autocomplete: "off", spellcheck: "false", autocapitalize: "none",
    });
    const noteBox = note("blank", "");
    return {
      input,
      noteBox,
      block: el("div", { class: "field" }, [
        el("label", { class: "flabel", for: id, text: `KEY ${i + 1}` }),
        input,
        noteBox,
      ]),
      decoded: null,
      ok: false,
    };
  });
  let generation = 0;

  function paint(slot, kind, content) {
    slot.noteBox.className = `note note-${kind}`;
    slot.noteBox.replaceChildren(
      ...(kind === "blank" ? [] : [icon(NOTE_ICON[kind])]),
      el("span", {}, [].concat(content))
    );
    slot.input.classList.toggle("is-ok", kind === "ok");
    slot.input.classList.toggle("is-bad", kind === "bad");
  }

  async function validateAll() {
    const gen = ++generation;
    const results = [];
    for (const slot of slots) {
      const typed = normalizeCardInput(slot.input.value);
      if (typed.length < CARD_LENGTH) {
        results.push({ decoded: null, error: null });
        continue;
      }
      let dec = null;
      try {
        dec = decodeCard(typed);
        await checkCard(vault, dec, 1);
        results.push({ decoded: dec, error: null });
      } catch (err) {
        // the note sits under its own field, so a wrong set gets the
        // full diagnosis rather than the slot-numbered error text
        results.push({
          decoded: null,
          error: err.code === "SET_MISMATCH" && dec
            ? wrongSetMessage(toHex(dec.setId).toUpperCase(), vault.setIdHex)
            : err.message,
        });
      }
    }
    if (gen !== generation) return; // superseded by newer input
    const firstSlotByIndex = new Map();
    slots.forEach((slot, i) => {
      const r = results[i];
      slot.decoded = null;
      slot.ok = false;
      if (r.decoded === null && r.error === null) { paint(slot, "blank", ""); return; }
      if (r.error !== null) { paint(slot, "bad", r.error); return; }
      const prev = firstSlotByIndex.get(r.decoded.index);
      if (prev !== undefined) {
        paint(slot, "bad", `That key is already entered, in slot ${prev + 1}.`);
        return;
      }
      firstSlotByIndex.set(r.decoded.index, i);
      slot.decoded = r.decoded;
      slot.ok = true;
      paint(slot, "ok", `Key #${r.decoded.index}`);
    });
    onChange();
  }

  for (const slot of slots) slot.input.addEventListener("input", validateAll);

  return {
    fields: slots.map((s) => s.block),
    allValid: () => slots.every((s) => s.ok),
    decoded: () => slots.map((s) => s.decoded),
    clear: () => {
      for (const s of slots) { s.input.value = ""; s.ok = false; s.decoded = null; paint(s, "blank", ""); }
    },
  };
}

/**
 * Live-validated owner's key entry for a v2 kit: checksum, set and
 * commitment checked on every keystroke, like keyEntryPanel does for the
 * holders' keys. For a v1 kit it degenerates to an empty panel that is
 * always satisfied, so callers can wire it unconditionally.
 */
function ownerEntryPanel(vault, onChange) {
  if (!vault.needsOwnerKey) {
    return { fields: [], ok: () => true, decoded: () => null, clear: () => {} };
  }
  const id = uid("owner");
  const input = el("textarea", {
    id,
    class: "fieldin", rows: "3", placeholder: "Type the owner's key here",
    autocomplete: "off", spellcheck: "false", autocapitalize: "none",
  });
  const noteBox = note("blank", "");
  let decoded = null;
  let okFlag = false;
  let generation = 0;

  function paint(kind, content) {
    noteBox.className = `note note-${kind}`;
    noteBox.replaceChildren(
      ...(kind === "blank" ? [] : [icon(NOTE_ICON[kind])]),
      el("span", {}, [].concat(content))
    );
    input.classList.toggle("is-ok", kind === "ok");
    input.classList.toggle("is-bad", kind === "bad");
  }

  async function validate() {
    const gen = ++generation;
    const typed = normalizeCardInput(input.value);
    decoded = null;
    okFlag = false;
    if (typed.length < OWNER_KEY_LENGTH) {
      paint("blank", "");
      onChange();
      return;
    }
    let dec = null;
    try {
      dec = decodeOwnerKey(typed);
      await checkOwnerKey(vault, dec);
      if (gen !== generation) return; // superseded by newer input
      decoded = dec;
      okFlag = true;
      paint("ok", "Owner's key verified");
    } catch (err) {
      if (gen !== generation) return;
      // a wrong set gets the full diagnosis, same as the verify screens
      paint("bad", err.code === "OWNER_SET_MISMATCH" && dec
        ? wrongSetMessage(toHex(dec.setId).toUpperCase(), vault.setIdHex)
        : err.message);
    }
    onChange();
  }
  input.addEventListener("input", validate);

  return {
    // the owner's key leads the entry screens; the trailing divider is
    // part of the panel so a v1 kit (empty panel) leaves no stray rule
    fields: [el("div", { class: "field" }, [
      el("label", { class: "flabel", for: id, text: "OWNER'S KEY" }),
      input,
      noteBox,
    ]), el("div", { class: "hair spaced" })],
    ok: () => okFlag,
    decoded: () => decoded,
    clear: () => { input.value = ""; decoded = null; okFlag = false; paint("blank", ""); },
  };
}

/* ------------------------------------------------------------------ */
/* home views                                                          */
/* ------------------------------------------------------------------ */

const HOME_LINES = [
  "SPLIT A SECRET AMONG PEOPLE YOU TRUST",
  "RECOVER YOUR SECRET IN NEED",
  "SECURE YOUR DIGITAL LIFE",
  "KEEP YOUR SECRETS SAFE AND RECOVERABLE",
];

/**
 * Keystroke rhythm, no typos: hand alternation is fast, same-hand and
 * same-finger sequences drag, word starts cost extra, bursts break up.
 */
function planTyping(text) {
  const LEFT = "QWERTASDFGZXCVB";
  const hand = (c) => (c === " " ? " " : LEFT.indexOf(c) >= 0 ? "L" : "R");
  const g = () => (Math.random() + Math.random() + Math.random()) / 3;
  const q = [{ wait: 260 }];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = text[i - 1] || "";
    let d = 44 + g() * 44;
    const a = hand(prev);
    const b = hand(ch);
    if (a !== " " && b !== " ") d *= a === b ? 1.25 : 0.8;
    if (prev === ch) d *= 1.35;
    if (prev === " ") d += 30;
    if (ch === " ") d *= 0.8;
    if (Math.random() < 0.05) d += 120 + g() * 170;
    q.push({ put: ch, wait: d });
  }
  // hold the finished line, then wipe it with a held backspace
  q.push({ idle: true, wait: 3200 });
  for (let i = text.length; i > 0; i--) {
    q.push({ del: true, wait: i === text.length ? 260 : 26 + Math.random() * 12 });
  }
  q.push({ wait: 420 });
  return q;
}

function typeInto(textNode, cursor) {
  let line = Math.floor(Math.random() * HOME_LINES.length);
  let queue = planTyping(HOME_LINES[line]);
  let i = 0;
  function step() {
    const s = queue[i++];
    if (!s) {
      let next = line;
      while (next === line) next = Math.floor(Math.random() * HOME_LINES.length);
      line = next;
      queue = planTyping(HOME_LINES[line]);
      i = 0;
      viewTimeout(step, 40);
      return;
    }
    if (s.del) textNode.textContent = textNode.textContent.slice(0, -1);
    else if (s.put) textNode.textContent += s.put;
    cursor.style.animation = s.idle ? "" : "none";
    viewTimeout(step, s.wait);
  }
  step();
}

function showHome() {
  if (PARSED_VAULT) return showRecoveryHome();
  CEREMONY_LIVE = false;
  MARK_N = 5;
  MARK_K = 3;
  MARK_OWNER = false;

  if (VAULT_LOAD_ERROR) {
    return render({ page: "Home" },
      title("KIT FILE DAMAGED"),
      lead("This kit file failed its integrity check. If you have a second USB stick, " +
        "open the copy on that one instead."),
      rule(),
      note("bad", VAULT_LOAD_ERROR),
      navRow(goBtn("RUN SELF-TEST", showSelfTest))
    );
  }

  const typed = document.createTextNode("");
  const cursor = el("span", { class: "cur", text: "_", "aria-hidden": "true" });
  const heading = el("h1", {}, [typed, cursor]);

  render({ page: "Home" },
    heading,
    rule(),
    actionRow("pen", "Create a Recovery Kit",
      "Encrypt your secret into multiple secure parts", showCreateWizard, true),
    hair(),
    actionRow("shield", "Verify a Recovery Kit",
      "Check which version of KEEP made a RECOVERY.html, and that its code is genuine", showVerify, true),
    hair(),
    actionRow("rotate", "Upgrade a Recovery Kit",
      "Carry an existing RECOVERY.html over to this version of the tool", showUpgrade, true),
    hair(),
    actionRow("printer", "Print Instructions",
      "Print the key holder's instructions", () => showLetter(null, showHome), true),
    hair(),
    actionRow("wave", "Run Self-Test",
      "Check this copy runs correctly in your browser", showSelfTest, true),
    hair(),
    el("p", { class: "fine wide", text:
      "This blank tool holds no secrets and is safe to pass on. The RECOVERY.html " +
      "or owner's key it produces is the file to guard." })
  );
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) typeInto(typed, cursor);
  else typed.textContent = HOME_LINES[0];
}

function showRecoveryHome() {
  const v = PARSED_VAULT;
  MARK_N = v.n;
  MARK_K = v.k;
  MARK_OWNER = v.needsOwnerKey;
  const hashBox = well("", "");
  const copyBtn = btn("COPY", () => {}, "btn-small");
  const saveBtn = btn("SAVE FILE HASH", () => {}, "btn-small");

  fileHash().then((hex) => {
    hashBox.textContent = groupHex(hex);
    copyBtn.onclick = () => copyToClipboard(groupHex(hex), copyBtn, "COPY", "COPIED");
    saveBtn.onclick = () => {
      downloadText(`${hex}  RECOVERY.html\n`, "RECOVERY-sha256.txt");
      saveBtn.textContent = "FILE HASH SAVED";
    };
  });

  render(kitRail(null, true),
    title("YOUR RECOVERY KIT"),
    lead("Kit file loaded and verified. The file is intact. Keep this file safe and secure."),
    statGrid([
      ["KIT FINGERPRINT", v.fingerprint],
      ["KEY SET", v.setIdHex],
      ["SCHEME", schemeLabel(v.k, v.n, v.needsOwnerKey)],
      ["CREATED", fmtDate(v.createdAt)],
    ]),
    rule(),
    actionRow("unlock", "Recover the Secret",
      `Enter ${keyCountPhrase(v.k, v.n)}${v.needsOwnerKey ? " and the owner's key" : ""} ` +
      "to reveal the protected secret", showRecover),
    hair(),
    actionRow("shield", "Check this Kit",
      "Compare the fingerprint against the instruction letter", showCheckKit),
    hair(),
    actionRow("printer", "Print Instructions",
      "The USB note, your own instructions, and the key holders' pages",
      () => showLetter(v, showHome, "usb")),
    hair(),
    actionRow("rotate", "Change the Protected Secret",
      "Re-encrypt the kit after a secret change; keys stay valid", showRotate),
    hair(),
    actionRow("wave", "Run Self-Test",
      "Verify the cryptography in this copy", showSelfTest),
    hair(),
    // the hash block is a new section, not a sixth row: give it room
    el("div", { class: "kicker spaced", text: "FILE HASH (SHA-256)" }),
    hashBox,
    el("div", { class: "btnrow" }, [copyBtn, el("span", { class: "right" }), saveBtn]),
    hashHelpNote()
  );
}

function hashHelpNote() {
  return note("info",
    "Verify that this file is untampered by comparing the hash with:",
    el("br"), "– Linux/Mac: ", el("code", { text: "shasum -a 256 RECOVERY.html" }),
    el("br"), "– Windows: ", el("code", { text: "Get-FileHash RECOVERY.html" })
  );
}

/** SHA-256 of this file as it stands: the snapshot with its own vault. */
async function fileHash() {
  const b64 = readEmbeddedVaultB64();
  const source = b64 === null ? SOURCE_SNAPSHOT : withVault(SOURCE_SNAPSHOT, b64);
  return toHex(await sha256(new TextEncoder().encode(source)));
}

async function copyToClipboard(text, button, idleLabel, doneLabel) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    button.textContent = "COPY FAILED";
    return;
  }
  button.textContent = doneLabel;
  viewTimeout(() => { button.textContent = idleLabel; }, 1600);
}

/* ------------------------------------------------------------------ */
/* self-test view                                                      */
/* ------------------------------------------------------------------ */

/**
 * Does this page's copy of itself reproduce the file as it was built? The
 * build stamped BUILD_DIGEST over the blank file with that slot empty: empty
 * it again in the snapshot, and only an exact copy hashes back to the stamp.
 * Every kit is written from the snapshot, so this is what makes a kit
 * written here verifiable later. Resolves to null, or to what is wrong.
 */
let exactCopyPromise = null;
function exactCopyProblem() {
  exactCopyPromise ??= (async () => {
    const unstamped = blankForm(SOURCE_SNAPSHOT)
      .replace(`"${BUILD_DIGEST}"`, () => '"@@BUILD' + '_DIGEST@@"');
    const digest = toHex(await sha256(new TextEncoder().encode(unstamped)));
    return digest === BUILD_DIGEST
      ? null
      : "This copy of the tool does not reproduce the file it was built as: either the " +
        "file was changed, or this browser copies it differently.";
  })();
  return exactCopyPromise;
}

/**
 * For every screen that writes a kit file: empty unless the kit written
 * here could not be verified later, then a warning. Writing is not
 * blocked — such a kit still recovers; only checking it against the
 * published hash would fail.
 */
function exactCopyWarning() {
  const holder = el("div", {});
  exactCopyProblem().then((problem) => {
    if (!problem) return;
    holder.replaceChildren(note("bad",
      el("strong", { text: "A kit written here cannot be verified later. " }),
      problem + " The kit would still recover the secret, but checking it against the " +
      "published hash would fail. Use another browser, or a verified copy of the tool."));
  });
  return holder;
}

/** Checks only a page can run, appended to the built-in self-test. */
const APP_CHECKS = [
  {
    name: "Exact Copy of This File",
    detail: "Kits written here match the published tool byte for byte, so they can be verified",
    async run() {
      const problem = await exactCopyProblem();
      if (problem) throw new Error(problem + " Kits written here could not be verified.");
    },
  },
];

function showSelfTest() {
  const checks = [...SELF_TEST_CHECKS, ...APP_CHECKS.map(({ name, detail }) => ({ name, detail }))];
  const rows = checks.map((c, i) => {
    const status = el("span", { class: "s wait", text: "[ ---- ]" });
    const ms = el("span", { class: "ms" });
    return {
      status,
      ms,
      node: el("div", { class: "strow" }, [
        el("span", { class: "n", text: String(i + 1).padStart(2, "0") }),
        status,
        el("div", { class: "body" }, [
          el("div", { class: "t", text: c.name }),
          el("div", { class: "d", text: c.detail }),
        ]),
        ms,
      ]),
    };
  });

  const headline = el("span", { text: `${rows.length} CHECKS · NOT YET RUN` });
  const counter = el("span", {});
  const total = el("span", { class: "ms" });
  const result = note("blank", "");
  const runBtn = goBtn("RUN SELF-TEST", () => run());
  const back = btn("BACK", showHome);

  const body = el("div", {});
  for (const r of rows) { body.append(r.node, hair()); }

  async function run() {
    setEnabled(runBtn, false);
    runBtn.firstChild.textContent = "RUNNING…";
    headline.textContent = "RUNNING";
    result.className = "note note-blank";
    result.replaceChildren();
    let elapsed = 0;
    for (const r of rows) {
      r.status.className = "s wait";
      r.status.textContent = "[ ---- ]";
      r.ms.textContent = "";
    }
    rows[0].status.className = "s run";
    rows[0].status.textContent = "[ RUN  ]";
    const results = await runSelfTest((res, i) => {
      rows[i].status.className = res.ok ? "s pass" : "s fail";
      rows[i].status.textContent = res.ok ? "[ PASS ]" : "[ FAIL ]";
      rows[i].ms.textContent = `${res.ms} ms`;
      elapsed += res.ms;
      total.textContent = `${elapsed} ms`;
      counter.textContent = `${i + 1} OF ${rows.length}`;
      if (rows[i + 1]) {
        rows[i + 1].status.className = "s run";
        rows[i + 1].status.textContent = "[ RUN  ]";
      }
      // let the browser paint between checks
      return new Promise((res2) => setTimeout(res2, 30));
    }, APP_CHECKS);
    const allOk = results.every((r) => r.ok);
    headline.textContent = allOk
      ? `ALL ${rows.length} CHECKS PASSED`
      : "A CHECK FAILED";
    counter.textContent = "";
    result.className = allOk ? "note note-ok" : "note note-bad";
    result.replaceChildren(icon(allOk ? "check" : "warning"), el("span", { text: allOk
      ? "This copy behaves correctly. Nothing you type is stored or sent anywhere."
      : results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.error}`).join(" · ") +
        " — don't trust this copy. Use the other USB stick, or open this file in a text editor " +
        "and search for MANUAL RECOVERY." }));
    runBtn.firstChild.textContent = "RUN AGAIN";
    setEnabled(runBtn, true);
  }

  render(PARSED_VAULT ? kitRail("RUN SELF-TEST") : { home: showHome, page: "Run Self-Test" },
    title("SELF-TEST"),
    lead("Runs this copy against a sample secret and checks the result comes back " +
      "intact. It confirms the tool works in your browser — nothing more."),
    el("p", { class: "fine", text:
      "A tampered copy could fake these results. If you need certainty, compare the " +
      "file against a copy you trust." }),
    el("div", { class: "strip" }, [headline, el("span", { class: "line" }), counter]),
    rule(),
    body,
    el("div", { class: "strow" }, [
      el("span", { class: "n" }),
      el("div", { class: "body" }, el("div", { class: "d", text: "TOTAL" })),
      total,
    ]),
    result,
    navRow(back, runBtn)
  );
  run();
}

/* ------------------------------------------------------------------ */
/* create ceremony                                                     */
/* ------------------------------------------------------------------ */

function showCreateWizard() {
  const ceremony = {
    k: 3,
    n: 5,
    ownerExternal: false,
    pwHash: null,
    saved: 0,
    result: null, // { bytes, cards, ownerKey, setIdHex, fingerprint, ... }
    cardStep: 0,
  };
  MARK_N = ceremony.n;
  MARK_K = ceremony.k;
  MARK_OWNER = false;

  stepPrecautions();

  function stepPrecautions() {
    const items = [
      ["eye", "Be Alone",
        "The secret and every recovery key will be visible on screen during this " +
        "process. A glance over your shoulder, a camera or a screen share is all it " +
        "takes to copy them."],
      ["wifi", "Go Offline for a Few Minutes",
        "Do you know exactly what is running on your computer right now? Probably not. " +
        "Going offline is a simple way to make sure nothing is synced elsewhere: screen " +
        "sharing, clipboard syncing to the cloud or other devices, and the like."],
      ["pen", "Pen and Paper",
        "You can copy and paste the recovery keys if you want to, but it is highly " +
        "recommended to write them down clearly and easy to read instead, so that " +
        "nothing remains on your computer or anywhere else."],
    ].map(([ic, t, d]) => el("div", { class: "prep" }, [
      el("span", { class: "plate" }, icon(ic)),
      el("div", { class: "body" }, [
        el("span", { class: "t", text: t }),
        el("span", { class: "d", text: d }),
      ]),
    ]));

    render(ceremonyRail(1),
      title("BEFORE YOU START"),
      lead("Three optional precautions worth taking, to reduce the chance of your " +
        "secret getting leaked."),
      rule(),
      exactCopyWarning(),
      ...items.flatMap((row) => [row, hair()]),
      navRow(btn("CANCEL", showHome), goBtn("CONTINUE", stepParams))
    );
  }

  function stepParams() {
    const noteBox = note("info", "");

    /** `labelId` is the caption above: a stepper is a group of buttons, not
     *  a form control, so it is named by pointing at that caption rather
     *  than by a label element, and each button says what it does. */
    function stepperFor(get, set, min, max, labelId, what) {
      const value = el("span", { class: "val", text: String(get()) });
      const minus = el("button", { type: "button", text: "−",
        "aria-label": `One fewer — ${what}` });
      const plus = el("button", { type: "button", text: "+",
        "aria-label": `One more — ${what}` });
      const box = el("div", {
        class: "stepper", role: "group", "aria-labelledby": labelId,
      }, [minus, value, plus]);
      const sync = () => {
        value.textContent = String(get());
        setEnabled(minus, get() > min());
        setEnabled(plus, get() < max());
      };
      minus.addEventListener("click", () => { set(get() - 1); syncAll(); });
      plus.addEventListener("click", () => { set(get() + 1); syncAll(); });
      return { box, sync };
    }

    const totalLabelId = uid("flabel");
    const needLabelId = uid("flabel");

    // a separate owner's key is itself a required factor, so the holders'
    // side may shrink to a single key; with K_app in the file, 2-of-2 is
    // the floor (one key alone must never open a stray file copy)
    const minN = () => (ceremony.ownerExternal ? 1 : MIN_CARDS);
    const minK = () => (ceremony.ownerExternal ? 1 : 2);

    const totalStepper = stepperFor(
      () => ceremony.n,
      (v) => {
        ceremony.n = Math.max(minN(), Math.min(MAX_CARDS, v));
        ceremony.k = Math.min(ceremony.k, ceremony.n);
      },
      minN, () => MAX_CARDS,
      totalLabelId, "total number of keys to generate"
    );
    const needStepper = stepperFor(
      () => ceremony.k,
      (v) => { ceremony.k = Math.max(minK(), Math.min(ceremony.n, v)); },
      minK, () => ceremony.n,
      needLabelId, "recovery threshold"
    );

    function syncAll() {
      totalStepper.sync();
      needStepper.sync();
      MARK_N = ceremony.n;
      MARK_K = ceremony.k;
      renderRail(ceremonyRail(2));
      const spare = ceremony.n - ceremony.k;
      let kind = "info";
      let text;
      if (ceremony.n === 1) {
        kind = "bad";
        text = "A single key. Losing it makes recovery impossible.";
      } else if (spare === 0) {
        kind = "bad";
        text = "Every single key is required. Losing one key makes recovery impossible.";
      } else if (ceremony.k === 2 && !ceremony.ownerExternal) {
        // with a separate owner's key the holders can never act alone,
        // so a low threshold stops being a collusion risk
        kind = "bad";
        text = "Any two holders together (plus your kit file) can recover. " +
          "Consider a higher threshold.";
      } else {
        text = `Any ${ceremony.k === 1 ? "one" : ceremony.k} of the ${ceremony.n} keys will recover; ` +
          `up to ${spare} ${spare === 1 ? "key" : "keys"} may be lost.`;
      }
      noteBox.className = `note note-${kind}`;
      noteBox.replaceChildren(icon(NOTE_ICON[kind]), el("span", { text }));
    }

    // one half of the encryption key always stays with you rather than the
    // holders; this choice is only about WHERE it lives — inside the kit
    // file (standard), or on a separate owner's key the ceremony adds
    const ownerLabelId = uid("flabel");
    const noteIn = note("info",
      "Your half of the decryption key is baked into the kit. Decrypting it " +
      "requires only the keys below. You need to keep the recovery file safe and " +
      "secure, yet accessible if anything were to happen to you.");
    const noteSep = note("bad",
      "You get an additional key that is REQUIRED for decryption. Losing this key " +
      "makes recovery impossible. The recovery file requires your key as well as " +
      "the keys below. You can share the recovery file, but keep your key safe and " +
      "secure, yet accessible if anything were to happen to you.");
    // both notes share one grid cell, so the taller one reserves the room
    // and toggling never pushes the divider below
    const ownerNotes = el("div", { class: "notestack" }, [noteIn, noteSep]);
    const tabInFile = el("button", { class: "tab", type: "button", text: "INSIDE THE KIT" });
    // the warn palette: selecting it is the choice that can lose the secret
    const tabSeparate = el("button", { class: "tab warn", type: "button", text: "SEPARATE OWNER'S KEY" });
    const ownerTabs = el("div", { class: "tabs", role: "group", "aria-labelledby": ownerLabelId },
      [tabInFile, tabSeparate]);

    function paintOwner() {
      const sep = ceremony.ownerExternal;
      tabInFile.className = sep ? "tab" : "tab on";
      tabSeparate.className = sep ? "tab warn on" : "tab warn";
      tabInFile.setAttribute("aria-pressed", String(!sep));
      tabSeparate.setAttribute("aria-pressed", String(sep));
      noteIn.classList.toggle("ghost", sep);
      noteSep.classList.toggle("ghost", !sep);
      // the mark answers the choice live: bright bow = the owner's part
      // of the key leaves the file
      MARK_OWNER = sep;
      // switching back to in-file restores the 2-of-2 floor
      ceremony.n = Math.max(minN(), ceremony.n);
      ceremony.k = Math.max(minK(), Math.min(ceremony.k, ceremony.n));
      syncAll();
    }
    tabInFile.addEventListener("click", () => { ceremony.ownerExternal = false; paintOwner(); });
    tabSeparate.addEventListener("click", () => { ceremony.ownerExternal = true; paintOwner(); });
    paintOwner();

    render(ceremonyRail(2),
      title("HOW MANY KEYS WOULD YOU LIKE?"),
      rule(),
      el("div", { class: "field" }, [
        el("span", { class: "flabel", id: ownerLabelId, text: "YOUR HALF OF THE KEY" }),
        el("p", { class: "fhint",
          text: "Half the encryption key never leaves you. Choose where it lives" }),
        ownerTabs,
        // inside the field, straight after the tabs: the notes answer the
        // choice, so they sit flush against it (.tabs + .notestack)
        ownerNotes,
      ]),
      el("div", { class: "hair spaced" }),
      el("div", { class: "field" }, [
        el("span", { class: "flabel", id: totalLabelId,
          text: "TOTAL NUMBER OF HOLDER'S KEYS TO GENERATE" }),
        el("p", { class: "fhint", text: "A person should only hold one key" }),
        totalStepper.box,
      ]),
      el("div", { class: "field" }, [
        el("span", { class: "flabel", id: needLabelId, text: "RECOVERY THRESHOLD" }),
        el("p", { class: "fhint", text: "Amount of keys required to decrypt the secret" }),
        needStepper.box,
      ]),
      noteBox,
      navRow(btn("BACK", stepPrecautions), goBtn("CONTINUE", stepSecret))
    );
    syncAll();
  }

  function stepSecret() {
    let pair = null; // assigned below; validate can fire during construction
    const statusBox = note("blank", "");
    const next = goBtn("CONTINUE", () => {
      go(pair.first.bytes());
    }, false);

    async function go(secretBytes) {
      // only a hash is kept for the later test-recovery comparison; the
      // plaintext leaves this step as bytes, just long enough to be
      // encrypted — createVault zeroes them when it is done
      ceremony.pwHash = toHex(await sha256(secretBytes));
      pair.first.clear();
      pair.again.clear();
      stepGenerate(secretBytes);
    }

    function validate() {
      if (!pair) return; // first call fires while the pair is still building
      // length, emptiness and equality are all answered from the buffers;
      // nothing here materialises the secret
      const first = pair.first;
      const again = pair.again;
      const hasA = !first.isEmpty();
      const hasB = !again.isEmpty();
      const bytes = first.byteLength();
      const same = first.matches(again);
      const chars = first.length();
      let kind = "blank";
      let text = "";
      let tail = "";
      let good = false;
      if (hasA && bytes > MAX_PASSWORD_BYTES) {
        kind = "bad";
        text = `Too long: ${bytes} bytes (maximum ${MAX_PASSWORD_BYTES}).`;
      } else if (hasA && hasB && !same) {
        kind = "bad";
        text = "The two entries do not match.";
      } else if (hasA && same) {
        kind = "ok";
        text = "OK";
        tail = `${chars} ${chars === 1 ? "CHARACTER" : "CHARACTERS"}`;
        good = true;
      }
      statusBox.className = `note note-${kind}`;
      statusBox.replaceChildren(
        ...(kind === "blank" ? [] : [icon(NOTE_ICON[kind])]),
        el("span", { text }),
        el("span", { class: "tail", text: tail })
      );
      setEnabled(next, good);
    }
    pair = secretPair("SECRET", "REPEAT SECRET", validate);
    validate();

    render(ceremonyRail(3),
      title("ENTER THE SECRET"),
      lead("The secret is never saved unencrypted. It is held only for the moment " +
        "it takes to encrypt it into the kit file."),
      pair.tabs,
      rule(),
      pair.fields,
      statusBox,
      navRow(btn("BACK", stepParams), next)
    );
  }

  async function stepGenerate(secret) {
    CEREMONY_LIVE = true;
    const fill = el("div", { class: "fill" });
    // the bar stands alone, centred: no heading, lead or rule — the rail
    // still says where in the ceremony this is
    render(ceremonyRail(3),
      el("div", { class: "busybox" }, el("div", { class: "progress" }, [
        fill,
        el("div", { class: "cap" }, ["GENERATING", el("span", { class: "cur", text: "_", "aria-hidden": "true" })]),
      ]))
    );
    // the bar tracks real work: it creeps while the kit is being built,
    // then lands on 100% when the bytes exist
    let pct = 6;
    fill.style.width = `${pct}%`;
    const creep = viewInterval(() => {
      pct = Math.min(92, pct + 7);
      fill.style.width = `${pct}%`;
    }, 90);
    const shownAt = Date.now();
    try {
      ceremony.result = await createVault(
        secret, ceremony.k, ceremony.n, randomBytes, nowSeconds(),
        { separateOwnerKey: ceremony.ownerExternal }
      );
    } catch (err) {
      clearInterval(creep);
      return render(ceremonyRail(3),
        title("GENERATION FAILED"),
        rule(),
        note("bad", String(err?.message ?? err)),
        navRow(btn("BACK", stepSecret))
      );
    }
    // the work itself is near-instant, which on screen reads as a glitch
    // rather than a step: keep the bar creeping for at least a second
    // before it lands, purely for presentation
    const MIN_BAR_MS = 1_000;
    viewTimeout(() => {
      clearInterval(creep);
      fill.style.width = "100%";
      ceremony.cardStep = 0;
      // the owner's key leads the sequence, as it does on the entry screens
      viewTimeout(ceremony.result.ownerKey ? stepOwnerShow : stepKeyShow, 320);
    }, Math.max(0, MIN_BAR_MS - (Date.now() - shownAt)));
  }

  /** The owner's key counts as just another key in the progress rail:
   *  a v2 run shows n+1 steps, with the owner's key as the first one. */
  function keyStepTotal() {
    return ceremony.result.ownerKey ? ceremony.n + 1 : ceremony.n;
  }

  function keyRail() {
    const step = ceremony.cardStep + (ceremony.result.ownerKey ? 2 : 1);
    return ceremonyRail(4, `04 KEYS ${step}/${keyStepTotal()}`);
  }

  function stepKeyShow() {
    const i = ceremony.cardStep;
    const r = ceremony.result;
    render(keyRail(),
      title(`KEY ${i + 1}`),
      lead("Write or copy the code exactly, including the spaces. Include the following " +
        "information alongside the key:"),
      el("p", { class: "keymeta", text:
        `Key ${i + 1} of ${r.n} · set ${r.setIdHex} · created ${fmtDate(r.createdAt)}` }),
      rule(),
      well(formatCardForDisplay(r.cards[i]), "key"),
      note("info",
        "Capital letters and digits only. After the PSR1 prefix, the characters 1, b, i and o never appear. A round character is always the digit 0."),
      navRow(
        btn("BACK", () => {
          // back past the first holder's key returns to the owner's key
          // when there is one; otherwise it is a way out of the ceremony,
          // not a step: it costs the keys and the secret, so it asks
          if (i === 0) {
            if (r.ownerKey) return stepOwnerShow();
            return confirmLeaveCeremony();
          }
          ceremony.cardStep -= 1;
          stepKeyShow();
        }),
        goBtn("VERIFY", stepKeyVerify)
      )
    );
  }

  function stepKeyVerify() {
    const i = ceremony.cardStep;
    const r = ceremony.result;
    // this screen carries no visible caption — the heading is the label — so
    // the field names itself rather than borrowing the placeholder
    const input = el("textarea", {
      class: "fieldin", rows: "4", placeholder: "Type the key back here",
      "aria-label": `Key ${i + 1}`,
      autocomplete: "off", spellcheck: "false", autocapitalize: "none",
    });
    const noteBox = note("blank", "");
    const cont = goBtn("CONTINUE", () => {
      ceremony.cardStep += 1;
      if (ceremony.cardStep < r.n) stepKeyShow();
      else stepProof();
    }, false);

    // `content` may be a string or an array of nodes (the wrong-set
    // diagnosis carries a line break)
    function paint(kind, content) {
      noteBox.className = `note note-${kind}`;
      noteBox.replaceChildren(
        ...(kind === "blank" ? [] : [icon(NOTE_ICON[kind])]),
        el("span", {}, [].concat(content))
      );
      input.classList.toggle("is-ok", kind === "ok");
      input.classList.toggle("is-bad", kind === "bad");
    }

    input.addEventListener("input", () => {
      const typed = normalizeCardInput(input.value);
      setEnabled(cont, false);
      if (typed === r.cards[i]) {
        paint("ok", "Key verified");
        setEnabled(cont, true);
        return;
      }
      if (typed.length < CARD_LENGTH) { paint("blank", ""); return; }
      try {
        const dec = decodeCard(typed);
        // set first, index second: a key from another run can collide on
        // index, and the index diagnosis only means anything within this set
        const decSetHex = toHex(dec.setId).toUpperCase();
        if (decSetHex !== r.setIdHex) {
          paint("bad", wrongSetMessage(decSetHex, r.setIdHex));
        } else if (dec.index !== i + 1) {
          paint("bad", `This reads as key ${dec.index}, not key ${i + 1}. Did you copy the wrong sheet?`);
        } else {
          paint("bad", "Valid-looking code, but it is not this key. Check your writing character by character.");
        }
      } catch (err) {
        paint("bad", err instanceof CardError && typed.length === CARD_LENGTH
          ? "There is a mistake somewhere. Compare your writing character by character."
          : err.message);
      }
    });

    render(keyRail(),
      title(`VERIFY KEY ${i + 1}`),
      lead("Write the key exactly as you have written it down or stored it."),
      rule(),
      input,
      noteBox,
      navRow(btn("SHOW THE CODE", stepKeyShow), cont)
    );
  }

  function ownerRail() {
    return ceremonyRail(4, `04 KEYS 1/${keyStepTotal()}`);
  }

  function stepOwnerShow() {
    const r = ceremony.result;
    render(ownerRail(),
      title("YOUR KEY"),
      lead("This key is yours alone. Recovery needs it together with the kit file " +
        "and the holders' keys. Write it down or store it in your password manager, " +
        "in a different place than the kit file. Never give it to a key holder."),
      el("p", { class: "keymeta", text:
        `Owner's key · set ${r.setIdHex} · created ${fmtDate(r.createdAt)}` }),
      rule(),
      well(formatCardForDisplay(r.ownerKey), "key"),
      note("bad",
        "If this key is lost, the secret is unrecoverable. No number of key holders can " +
        "replace it."),
      note("info",
        "Capital letters and digits only. After the KEEP1 prefix, the characters 1, b, i and o never appear. A round character is always the digit 0."),
      navRow(
        // the owner's key opens the sequence, so back past it is the way
        // out of the ceremony — same question, same cost
        btn("BACK", confirmLeaveCeremony),
        goBtn("VERIFY", stepOwnerVerify)
      )
    );
  }

  function stepOwnerVerify() {
    const r = ceremony.result;
    const input = el("textarea", {
      class: "fieldin", rows: "4", placeholder: "Type the owner's key back here",
      "aria-label": "Owner's key",
      autocomplete: "off", spellcheck: "false", autocapitalize: "none",
    });
    const noteBox = note("blank", "");
    const cont = goBtn("CONTINUE", () => {
      ceremony.cardStep = 0;
      stepKeyShow();
    }, false);

    function paint(kind, content) {
      noteBox.className = `note note-${kind}`;
      noteBox.replaceChildren(
        ...(kind === "blank" ? [] : [icon(NOTE_ICON[kind])]),
        el("span", {}, [].concat(content))
      );
      input.classList.toggle("is-ok", kind === "ok");
      input.classList.toggle("is-bad", kind === "bad");
    }

    input.addEventListener("input", () => {
      const typed = normalizeCardInput(input.value);
      setEnabled(cont, false);
      if (typed === r.ownerKey) {
        paint("ok", "Your key is verified");
        setEnabled(cont, true);
        return;
      }
      if (typed.length < OWNER_KEY_LENGTH) { paint("blank", ""); return; }
      try {
        // same diagnosis ladder as the holders' keys: a wrong set is
        // named before falling back to the generic typo advice
        const dec = decodeOwnerKey(typed);
        const decSetHex = toHex(dec.setId).toUpperCase();
        if (decSetHex !== r.setIdHex) {
          paint("bad", wrongSetMessage(decSetHex, r.setIdHex));
        } else {
          paint("bad", "Valid-looking code, but it is not this owner's key. Check your writing character by character.");
        }
      } catch (err) {
        // a holder's key pasted here decodes as the wrong kind — that
        // diagnosis (BAD_HRP) beats the generic typo advice
        paint("bad", err instanceof CardError && err.code !== "BAD_HRP" && typed.length === OWNER_KEY_LENGTH
          ? "There is a mistake somewhere. Compare your writing character by character."
          : err.message);
      }
    });

    render(ownerRail(),
      title("VERIFY YOUR KEY"),
      lead("Write the key exactly as you have written it down or stored it."),
      rule(),
      input,
      noteBox,
      navRow(btn("SHOW THE CODE", stepOwnerShow), cont)
    );
  }

  async function stepProof() {
    const r = ceremony.result;
    const vault = await parseVault(r.bytes);
    const resultBox = note("blank", "");
    let tested = false;
    const go = goBtn("TEST THE RECOVERY", () => runTest(), false);
    const sync = () => {
      if (!tested) setEnabled(go, panel.allValid() && owner.ok());
    };
    const panel = keyEntryPanel(vault, r.k, sync);
    const owner = ownerEntryPanel(vault, sync);

    async function runTest() {
      if (tested) return stepSave();
      try {
        // the proof only needs to know the bytes come back identical, so
        // they are hashed and wiped without ever becoming text
        const recovered = await recoverPasswordBytes(vault, panel.decoded(), owner.decoded());
        const hash = toHex(await sha256(recovered));
        recovered.fill(0);
        if (hash !== ceremony.pwHash) {
          resultBox.className = "note note-bad";
          resultBox.replaceChildren(icon("warning"), el("span", { text:
            "The recovered text doesn't match the secret. Restart the ceremony." }));
          return;
        }
        tested = true;
        resultBox.className = "note note-ok";
        resultBox.replaceChildren(icon("check"), el("span", { text:
          "Recovered. These keys bring the secret back." }));
        go.firstChild.textContent = "CONTINUE";
      } catch (err) {
        resultBox.className = "note note-bad";
        resultBox.replaceChildren(icon("warning"), el("span", { text: err.message }));
      }
    }

    const withOwner = r.ownerKey ? ", together with your owner's key." : ".";
    const proofLead = r.k === r.n
      ? (r.k === 1 ? "Fill in the key below" : `Fill in ${r.k} keys below`) + withOwner
      : (r.k === 1
        ? "Pick any one key and fill it in below"
        : `Pick any ${r.k} keys at random and fill them in below`) + withOwner;

    render(ceremonyRail(5),
      title("TEST YOUR KEYS"),
      lead(proofLead),
      rule(),
      ...owner.fields,
      ...panel.fields,
      resultBox,
      navRow(
        btn(r.ownerKey ? "RESTART FROM YOUR KEY" : "RESTART FROM KEY 1", () => {
          ceremony.cardStep = 0;
          if (r.ownerKey) stepOwnerShow();
          else stepKeyShow();
        }),
        go
      )
    );
  }

  async function stepSave() {
    const r = ceremony.result;
    const personalized = withVault(SOURCE_SNAPSHOT, toBase64(r.bytes));
    // hash of the exact bytes being saved: lets the owner detect ANY
    // later modification of the file (app code included), using the
    // OS hashing tool — see the letter and hashHelpNote()
    const hashHex = toHex(await sha256(new TextEncoder().encode(personalized)));

    const status = note("blank", "");
    const finish = goBtn("FINISH", () => {
      confirmModal(
        "Have you saved the file? Without the recovery file you will have to start " +
        "from the beginning.",
        "FINISH",
        () => location.reload()
      );
    }, ceremony.saved > 0);
    function paintSaved() {
      if (!ceremony.saved) return;
      status.className = "note note-ok";
      status.replaceChildren(icon("check"), el("span", { text: ceremony.saved >= 2
        ? "Two copies saved. Put them on two separate USB sticks."
        : "One copy saved. Save it a second time, for the second USB stick." }));
      setEnabled(finish, true);
    }
    const saveBtn = el("button", { class: "btn btn-go", type: "button", onclick: () => {
      downloadHtml(personalized, "RECOVERY.html");
      ceremony.saved += 1;
      paintSaved();
    } }, [icon("download"), "CREATE RECOVERY FILE", el("span", { class: "gocur", text: "_", "aria-hidden": "true" })]);
    paintSaved();

    const copyBtn = btn("COPY", () => copyToClipboard(groupHex(hashHex), copyBtn, "COPY", "COPIED"), "btn-small");
    const saveHashBtn = btn("SAVE FILE HASH", () => {
      downloadText(`${hashHex}  RECOVERY.html\n`, "RECOVERY-sha256.txt");
      saveHashBtn.textContent = "FILE HASH SAVED";
    }, "btn-small");

    render(ceremonyRail(6),
      title("SAVE YOUR KIT"),
      lead("Keys alone can't recover the secret without this file. Save it twice, keep " +
        "the two USB sticks in different places you control, and never give a stick to " +
        "a key holder."),
      statGrid([
        ["KIT FINGERPRINT", r.fingerprint],
        ["KEY SET", r.setIdHex],
        ["SCHEME", schemeLabel(r.k, r.n, Boolean(r.ownerKey))],
        ["CREATED", fmtDate(r.createdAt)],
      ]),
      r.ownerKey
        ? note("bad", "This kit does not contain the owner's key: recovery needs the " +
          "file, the owner's key and the holders' keys. Keep the owner's key apart " +
          "from the recovery file if you are to share the recovery file.")
        : null,
      note("info", "Tip: if you keep a password vault, consider storing a copy of the " +
        "holders' keys in it. Testing the recovery and changing the secret then needs " +
        "no key holders. It is paramount that these copies are stored safely, and " +
        "never together with the recovery file itself."),
      rule(),
      el("div", { class: "btnrow start" }, [
        saveBtn,
        btn("PRINT", () => showLetter(r, stepSave, "usb", groupHex(hashHex)), "right"),
      ]),
      status,
      el("div", { class: "kicker", text: "FILE HASH (SHA-256)" }),
      el("p", { class: "fhint", text:
        "The printed letter carries this hash and the fingerprint already. It lets " +
        "you check later that the file was not tampered with." }),
      well(groupHex(hashHex)),
      el("div", { class: "btnrow" }, [copyBtn, el("span", { class: "right" }), saveHashBtn]),
      hashHelpNote(),
      navRow(btn("BACK", stepProof), finish)
    );
  }
}

/* ------------------------------------------------------------------ */
/* recover                                                             */
/* ------------------------------------------------------------------ */

function showRecover() {
  const v = PARSED_VAULT;
  const statusBox = note("blank", "");
  const go = goBtn("RECOVER THE SECRET", async () => {
    try {
      const recovered = await recoverPasswordBytes(v, panel.decoded(), owner.decoded());
      panel.clear();
      owner.clear();
      showRecovered(recovered);
    } catch (err) {
      statusBox.className = "note note-bad";
      statusBox.replaceChildren(icon("warning"), el("span", { text: err.message }));
    }
  }, false);
  const sync = () => setEnabled(go, panel.allValid() && owner.ok());
  const panel = keyEntryPanel(v, v.k, sync);
  const owner = ownerEntryPanel(v, sync);

  render(kitRail("RECOVER SECRET"),
    title("RECOVER THE SECRET"),
    el("p", { class: "lead" }, [
      `Enter ${keyCountPhrase(v.k, v.n)} from set `,
      el("strong", { text: v.setIdHex }),
      v.needsOwnerKey ? ", together with the owner's key (KEEP1…)" : "",
      ". Type each code exactly as written; spaces do not matter.",
    ]),
    rule(),
    ...owner.fields,
    ...panel.fields,
    statusBox,
    navRow(btn("BACK", showHome), go)
  );
}

/** `secretBytes` is owned by this screen: it stays as bytes between reveals
 *  and is zeroed on the way out. A one-line secret is only readable while the
 *  button is held; a multi-line secret toggles open instead, because reading
 *  it takes scrolling and time a pinned-down pointer does not allow. */
function showRecovered(secretBytes) {
  // a secret entered in the multi-line box carries its newlines through the
  // ciphertext, so their presence is the stored size hint: line breaks mean
  // the big reading pane, their absence the one-line password well
  const multiline = secretBytes.includes(0x0a);
  // the mask mirrors the line count so revealing barely moves the layout;
  // the holder has already decrypted, so the shape of the secret is theirs
  const lineCount = multiline
    ? secretBytes.reduce((n, b) => n + (b === 0x0a ? 1 : 0), 1)
    : 1;
  const masked = Array(lineCount).fill("•".repeat(12)).join("\n");
  const out = el("div", {
    class: multiline ? "well secret prose" : "well secret",
    text: masked,
  });
  let outBlock = out;
  if (multiline) {
    outBlock = el("div", { class: "scrollhost" }, [out]);
    mountBoxScrollbar(out, outBlock);
  }
  const show = () => { out.textContent = new TextDecoder().decode(secretBytes); };
  const hide = () => { out.textContent = masked; };
  let reveal;
  let hideNow = hide;
  if (multiline) {
    // toggle, not hold: the pane must be free to grow past the viewport and
    // be scrolled while readable, neither of which a held pointer permits
    const gocur = el("span", { class: "gocur", text: "_", "aria-hidden": "true" });
    reveal = el("button", { class: "btn btn-go", type: "button" });
    let shown = false;
    const paint = () => {
      reveal.replaceChildren(icon("eye"), shown ? "HIDE THE SECRET" : "SHOW THE SECRET", gocur);
    };
    hideNow = () => { shown = false; out.classList.remove("open"); hide(); paint(); };
    reveal.addEventListener("click", () => {
      shown = !shown;
      // .open lifts the pane's height cap so the whole secret is on the page,
      // however small the window: the page scrolls, nothing is trapped inside
      out.classList.toggle("open", shown);
      if (shown) show(); else hide();
      paint();
      if (shown) out.scrollIntoView({ block: "nearest" });
    });
    paint();
  } else {
    reveal = el("button", { class: "btn btn-go btn-hold", type: "button" }, [
      icon("eye"), "HOLD TO REVEAL", el("span", { class: "gocur", text: "_", "aria-hidden": "true" }),
    ]);
    reveal.addEventListener("pointerdown", (e) => {
      // capture the pointer: revealing can reflow the page and slide the button
      // out from under a held pointer, which would otherwise fire pointerleave
      // and hide the secret mid-hold
      if (reveal.setPointerCapture) {
        try { reveal.setPointerCapture(e.pointerId); } catch { /* mouseless synth event */ }
      }
      show();
    });
    reveal.addEventListener("pointerup", hide);
    reveal.addEventListener("pointercancel", hide);
    reveal.addEventListener("pointerleave", hide);
    reveal.addEventListener("blur", hide);
  }
  const finish = () => {
    hideNow();
    secretBytes.fill(0);
    location.reload();
  };

  render(kitRail("RECOVER SECRET"),
    title("SECRET RECOVERED"),
    lead("If this was a real recovery, treat the secret as exposed: sign in, change it, " +
      "and re-encrypt this kit with “Change the protected secret”."),
    rule(),
    outBlock,
    note("bad", "Make sure that you are in a secure location before revealing the secret"),
    el("div", { class: "btnrow start" }, reveal),
    navRow(el("span"), btn("FINISH", finish, "right"))
  );
}

/* ------------------------------------------------------------------ */
/* check kit + rotate                                                  */
/* ------------------------------------------------------------------ */

function showCheckKit() {
  const v = PARSED_VAULT;
  render(kitRail("CHECK THIS KIT"),
    title("CHECK THIS KIT"),
    lead("Integrity verified when this page loaded. The file is intact."),
    rule(),
    statGrid([
      ["KIT FINGERPRINT", v.fingerprint],
      ["KEY SET", v.setIdHex],
      ["SCHEME", schemeLabel(v.k, v.n, v.needsOwnerKey)],
      ["CREATED", fmtDate(v.createdAt)],
      ["TOOL VERSION", APP_VERSION],
    ]),
    lead("Compare the fingerprint with the one written on the instruction letter. If " +
      "they differ, this stick holds an outdated or wrong kit. Find the current one."),
    el("p", { class: "fine", text:
      "The fingerprint only shows the file is identical to the one created at the " +
      "ceremony. It can't tell you whether the secret inside is still current." }),
    navRow(btn("BACK", showHome))
  );
}

function showRotate() {
  const v = PARSED_VAULT;
  let pair = null; // assigned below; sync can fire during construction
  const statusBox = note("blank", "");
  const go = goBtn("RE-ENCRYPT THE KIT", () => rotate(), false);
  const panel = keyEntryPanel(v, v.k, sync, "Type the key back here");
  const owner = ownerEntryPanel(v, sync);

  function matched() {
    return !pair.first.isEmpty() && pair.first.matches(pair.again);
  }
  function sync() {
    if (!pair) return; // first call fires while the pair is still building
    const first = pair.first;
    const again = pair.again;
    const hasA = !first.isEmpty();
    const hasB = !again.isEmpty();
    let kind = "blank";
    let text = "";
    if (hasA && first.byteLength() > MAX_PASSWORD_BYTES) {
      kind = "bad";
      text = `Too long (maximum ${MAX_PASSWORD_BYTES} bytes).`;
    } else if (hasA && hasB && !first.matches(again)) {
      kind = "bad";
      text = "The two entries do not match.";
    } else if (matched()) {
      kind = "ok";
      text = "OK";
    }
    statusBox.className = `note note-${kind}`;
    statusBox.replaceChildren(
      ...(kind === "blank" ? [] : [icon(NOTE_ICON[kind])]),
      el("span", { text })
    );
    setEnabled(go, panel.allValid() && owner.ok() && matched() && kind !== "bad");
  }
  pair = secretPair("NEW SECRET", "REPEAT NEW SECRET", sync);
  sync();

  async function rotate() {
    try {
      // bytes, not a string, and rotateVault zeroes them once encrypted
      const rotated = await rotateVault(v, panel.decoded(), pair.first.bytes(), randomBytes, nowSeconds(), owner.decoded());
      pair.first.clear();
      pair.again.clear();
      panel.clear();
      owner.clear();
      const personalized = withVault(SOURCE_SNAPSHOT, toBase64(rotated.bytes));
      const hashHex = toHex(await sha256(new TextEncoder().encode(personalized)));
      const saveBtn = el("button", { class: "btn btn-go", type: "button", onclick: () => {
        downloadHtml(personalized, "RECOVERY.html");
        saveBtn.childNodes[1].textContent = "RECOVERY FILE SAVED";
      } }, [icon("download"), "SAVE THE NEW RECOVERY FILE", el("span", { class: "gocur", text: "_", "aria-hidden": "true" })]);

      render(kitRail("CHANGE SECRET"),
        title("KIT RE-ENCRYPTED"),
        rule(),
        note("ok", `New fingerprint: ${rotated.fingerprint}. The keys are unchanged.`),
        el("div", { class: "btnrow start" }, saveBtn),
        el("div", { class: "kicker", text: "NEW FILE HASH (SHA-256)" }),
        el("p", { class: "fhint", text:
          "The file changed, so its hash and fingerprint changed with it." }),
        well(groupHex(hashHex)),
        // the letter is printed from the kit file, so it carries whatever the
        // file says: the old paper is stale, and reprinting is the fix
        note("bad", el("strong", { text: "Replace every old copy. " }),
          "Old copies still recover the old secret, and the printed letter still " +
          "shows the old fingerprint and file hash. Save the new file, then print a " +
          "fresh letter from it."),
        navRow(el("span"), btn("DONE", () => location.reload(), "right"))
      );
    } catch (err) {
      statusBox.className = "note note-bad";
      statusBox.replaceChildren(icon("warning"), el("span", { text: err.message }));
    }
  }

  render(kitRail("CHANGE SECRET"),
    title("CHANGE THE PROTECTED SECRET"),
    lead(v.needsOwnerKey
      ? `Enter ${keyCountPhrase(v.k, v.n)} and the owner's key, then the new secret. ` +
        `The ${v.k === 1 ? "key" : "keys"} and the owner's key stay valid — only the file changes.`
      : `Enter ${keyCountPhrase(v.k, v.n)}, then the new secret. The keys stay valid — only the ` +
        "file changes."),
    rule(),
    exactCopyWarning(),
    ...owner.fields,
    ...panel.fields,
    pair.tabs,
    rule(),
    pair.fields,
    statusBox,
    navRow(btn("BACK", showHome), go)
  );
}

/* ------------------------------------------------------------------ */
/* upgrade a recovery kit                                              */
/* ------------------------------------------------------------------ */

/**
 * Read a KEEP file someone picked: its SHA-256 as it sits on disk (what the
 * letter records), what its app code is, and — for a kit — the vault inside,
 * parsed and integrity-checked. Throws with a user-facing message only when
 * the file is no KEEP file at all; a damaged vault lands in `vaultError`, so
 * the verdict on the code can still be shown.
 */
async function readKeepFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const b64 = vaultPayload(text);
  const code = await identifyCode(text, await selfDigest());
  const fileHash = toHex(await sha256(bytes));
  let vault = null;
  let vaultB64 = null;
  let vaultError = null;
  if (b64 !== null) {
    try {
      let raw;
      try {
        raw = fromBase64(b64);
      } catch {
        throw new Error("The vault block inside this file is damaged (not valid base64). " +
          "Try the copy on the other USB stick.");
      }
      vault = await parseVault(raw);
      vaultB64 = toBase64(raw);
    } catch (err) {
      vaultError = err;
    }
  }
  return { fileHash, isBlank: b64 === null, code, vault, vaultB64, vaultError };
}

/** A vault that failed to load, as one sentence for the screen. */
function vaultErrorMessage(err) {
  return err?.code === "BAD_VERSION"
    ? "This kit uses a format this tool does not declare itself compatible with. " +
      "It was probably made by a newer tool — use that tool instead."
    : String(err?.message ?? err);
}

/** The made-by line for a stat grid: the version the hash proves, or the
 *  version the file merely claims. */
function madeByLabel(code) {
  if (code.kind === "self") return `${APP_VERSION} · verified`;
  if (code.kind === "release") return `KEEP ${code.release.version} · verified`;
  return `${code.claimed ?? "Unknown"} · not verified`;
}

/** The verdict on a file's app code, as a note. */
function codeVerdictNote(code) {
  if (code.kind === "self") {
    return note("ok", el("strong", { text: "Genuine. " }),
      `The app code in this file is exactly the code of this tool, ${APP_VERSION}: the ` +
      "published release, provided this keep.html matches the hash published on GitHub.");
  }
  if (code.kind === "release") {
    return note("ok", el("strong", { text: "Genuine. " }),
      `The app code in this file is exactly the published KEEP ${code.release.version}.`);
  }
  if (code.claimed && compareVersions(code.claimed, APP_VERSION) > 0) {
    return note("info", el("strong", { text: "Made by a newer tool. " }),
      `This file says it was made by ${code.claimed}, newer than this tool ` +
      `(${APP_VERSION}), which cannot know its hash. Verify it with that version ` +
      "of keep.html or a later one.");
  }
  const early = code.claimed && compareVersions(code.claimed, "KEEP 1.1.0") < 0
    ? "Kits from the first releases can only be matched if they were made in a " +
      "browser that copies the page the way Chrome does, so this one may still be " +
      "harmless. "
    : "";
  return note("bad", el("strong", { text: "Not verified. " }),
    "The app code in this file matches no published release of KEEP" +
    (code.claimed ? `, although it says it is ${code.claimed}` : "") + ". " + early +
    "It may have been changed. Do not type keys into it: upgrade it with this tool " +
    "instead, which puts this tool's code around the same vault.");
}

/**
 * Verify another KEEP file without opening it: which release its app code
 * is (by hash, against every release this build knows, and against itself),
 * and whether the vault inside is intact. Nothing is decrypted.
 */
function showVerify() {
  const results = el("div", {});
  const picker = el("input", {
    type: "file", accept: ".html,.htm", "aria-hidden": "true",
    tabindex: "-1", style: "display:none",
  });
  const pickBtn = goBtn("CHOOSE THE FILE", () => picker.click());

  picker.addEventListener("change", async () => {
    const file = picker.files && picker.files[0];
    picker.value = ""; // so re-picking the same file fires change again
    if (!file) return;
    results.replaceChildren();
    let f;
    try {
      f = await readKeepFile(file);
    } catch (err) {
      results.replaceChildren(note("bad", String(err?.message ?? err)));
      return;
    }
    const v = f.vault;
    results.replaceChildren(
      // the same grid as the upgrade screen: the kit, then the two tools
      statGrid([
        ...(v
          ? [
            ["KIT FINGERPRINT", v.fingerprint],
            ["KEY SET", v.setIdHex],
            ["SCHEME", schemeLabel(v.k, v.n, v.needsOwnerKey)],
            ["CREATED", fmtDate(v.createdAt)],
          ]
          : [["CONTENTS", f.isBlank ? "Blank tool" : "Damaged kit"]]),
        ["FILE'S TOOL", madeByLabel(f.code)],
        ["THIS TOOL", APP_VERSION],
      ]),
      codeVerdictNote(f.code),
      f.isBlank
        ? note("info", "This is a blank tool, not a kit: it holds no vault.")
        : v
          ? note("ok", `The vault inside passed its integrity check (fingerprint ${v.fingerprint}).`)
          : note("bad", vaultErrorMessage(f.vaultError)),
      el("div", { class: "kicker spaced", text: "FILE HASH (SHA-256)" }),
      el("p", { class: "fhint", text: "Compare it with the file hash on the printed letter." }),
      well(groupHex(f.fileHash))
    );
  });

  render({ home: showHome, page: "Verify a Recovery Kit" },
    title("VERIFY A RECOVERY KIT"),
    lead("Check a RECOVERY.html before you trust it: which version of KEEP made it, " +
      "and whether its code is exactly that published release. Nothing is decrypted " +
      "and no keys are needed."),
    el("p", { class: "fine", text:
      "This tool knows the published hash of every KEEP release before it. Check this " +
      "keep.html itself against the hash published on GitHub first: a tampered tool " +
      "could vouch for anything." }),
    rule(),
    el("div", { class: "btnrow start" }, pickBtn),
    picker,
    results,
    navRow(btn("BACK", showHome))
  );
}

/**
 * Re-wrap an existing kit file with this build of the tool. The vault
 * bytes are copied over verbatim — no keys are needed and nothing is
 * decrypted — so the keys, the owner's key, the secret and the kit
 * fingerprint all survive unchanged; only the app around them (and with
 * it the file hash) is new. Allowed exactly when this tool declares the
 * file's format version supported; anything else is refused.
 */
function showUpgrade() {
  const infoHolder = el("div", {});
  const statusBox = note("blank", "");
  let loaded = null; // { b64, vault, code }

  const picker = el("input", {
    type: "file", accept: ".html,.htm", "aria-hidden": "true",
    tabindex: "-1", style: "display:none",
  });
  const pickBtn = goBtn("CHOOSE THE KIT FILE", () => picker.click());
  const go = goBtn("UPGRADE THE KIT", () => save(), false);

  function paint(kind, content) {
    statusBox.className = `note note-${kind}`;
    statusBox.replaceChildren(
      ...(kind === "blank" ? [] : [icon(NOTE_ICON[kind])]),
      el("span", {}, [].concat(content))
    );
  }

  picker.addEventListener("change", async () => {
    const file = picker.files && picker.files[0];
    picker.value = ""; // so re-picking the same file fires change again
    if (!file) return;
    loaded = null;
    setEnabled(go, false);
    infoHolder.replaceChildren();
    let f;
    try {
      f = await readKeepFile(file);
      if (f.isBlank) throw new Error("This file is a blank tool. It holds no kit to upgrade.");
      if (f.vaultError) throw f.vaultError;
    } catch (err) {
      paint("bad", vaultErrorMessage(err));
      return;
    }
    loaded = { b64: f.vaultB64, vault: f.vault, code: f.code };
    const v = loaded.vault;
    infoHolder.replaceChildren(statGrid([
      ["KIT FINGERPRINT", v.fingerprint],
      ["KEY SET", v.setIdHex],
      ["SCHEME", schemeLabel(v.k, v.n, v.needsOwnerKey)],
      ["CREATED", fmtDate(v.createdAt)],
      ["FILE'S TOOL", madeByLabel(loaded.code)],
      ["THIS TOOL", APP_VERSION],
    ]));
    paint("ok", loaded.code.kind === "self"
      ? "Kit verified. The file already carries this tool version; upgrading simply re-creates it."
      : `Kit verified: format v${v.version}, which this tool declares itself compatible ` +
        "with. The keys and the secret carry over unchanged.");
    setEnabled(go, true);
  });

  async function save() {
    const v = loaded.vault;
    const personalized = withVault(SOURCE_SNAPSHOT, loaded.b64);
    const hashHex = toHex(await sha256(new TextEncoder().encode(personalized)));
    const saveBtn = el("button", { class: "btn btn-go", type: "button", onclick: () => {
      downloadHtml(personalized, "RECOVERY.html");
      saveBtn.childNodes[1].textContent = "UPGRADED FILE SAVED";
    } }, [icon("download"), "SAVE THE UPGRADED FILE", el("span", { class: "gocur", text: "_", "aria-hidden": "true" })]);
    const copyBtn = btn("COPY", () => copyToClipboard(groupHex(hashHex), copyBtn, "COPY", "COPIED"), "btn-small");
    const saveHashBtn = btn("SAVE FILE HASH", () => {
      downloadText(`${hashHex}  RECOVERY.html\n`, "RECOVERY-sha256.txt");
      saveHashBtn.textContent = "FILE HASH SAVED";
    }, "btn-small");

    render({ home: showHome, page: "Upgrade a Recovery Kit" },
      title("KIT UPGRADED"),
      rule(),
      note("ok", `The kit now carries ${APP_VERSION}. The keys and the fingerprint ` +
        `(${v.fingerprint}) are unchanged.`),
      el("div", { class: "btnrow start" }, saveBtn),
      el("div", { class: "kicker", text: "NEW FILE HASH (SHA-256)" }),
      el("p", { class: "fhint", text:
        "The app around the vault changed, so the file hash changed with it. The " +
        "vault itself did not, so the fingerprint stayed." }),
      well(groupHex(hashHex)),
      el("div", { class: "btnrow" }, [copyBtn, el("span", { class: "right" }), saveHashBtn]),
      note("bad", el("strong", { text: "Replace every old copy. " }),
        "The printed letter still shows the old file hash. Save the upgraded file to " +
        "both USB sticks, then open it and print a fresh letter."),
      navRow(el("span"), btn("DONE", () => location.reload(), "right"))
    );
  }

  render({ home: showHome, page: "Upgrade a Recovery Kit" },
    title("UPGRADE A RECOVERY KIT"),
    lead("Patch an existing RECOVERY.html. This allows new features while retaining " +
      "any keys and secrets, which will work as before."),
    el("p", { class: "fine", text:
      "You are personally responsible for your recovery kit. Don't delete the old " +
      "version until you have verified that the new version works. Once you have " +
      "verified, delete the old version as not to have two files with different " +
      "versions." }),
    rule(),
    exactCopyWarning(),
    el("div", { class: "btnrow start" }, pickBtn),
    picker,
    infoHolder,
    statusBox,
    navRow(btn("BACK", showHome), go)
  );
}

/* ------------------------------------------------------------------ */
/* printed documents                                                   */
/* ------------------------------------------------------------------ */

const A4_W = 794;      // A4 at 96dpi
const A4_H = 1123;
const SHEET_PAD = 76;  // 2cm — the same inset the printed sheet uses

const PRINT_TABS = [
  ["usb", "USB NOTE"],
  ["owner", "OWNER'S INSTRUCTIONS"],
  ["holder", "KEY HOLDER'S INSTRUCTIONS"],
];

const PRINT_LEAD = {
  usb: "The note that travels with the USB stick: what the stick is, the kit's " +
    "identity, and who holds the keys. It contains no secrets.",
  owner: "Your own reminder — where the sticks are, what to check every year, and " +
    "how to verify the file hash.",
  holder: "One page per key holder. Print one for each person, write their key on it " +
    "by hand, and hand it over sealed.",
};

function usbBlocks(d) {
  const holders = [];
  for (let i = 1; i <= d.n; i++) {
    holders.push(el("tr", {}, [
      el("td", { class: "mono", text: `Key ${i}` }),
      el("td", {}, el("span", { class: "blank" })),
      el("td", {}, el("span", { class: "blank" })),
    ]));
  }
  return [
    el("h1", { text: "Recovery Kit Instructions" }),
    el("p", { text: d.n === 1
      ? "Below there is listed one person with a decryption key. You need that key, " +
        "entered into the RECOVERY.html file to decrypt the secret. Insert the " +
        "USB-stick into any computer, then click on Recover Secret."
      : `Below there are listed ${d.n} people with a decryption key. You need ` +
        `${d.k === d.n ? `all ${d.k}` : d.k === 1 ? "any one" : `any ${d.k}`} ` +
        "of those keys, entered into the RECOVERY.html file to decrypt the secret. Fewer " +
        "than that and it will not be possible to decrypt the contents. Insert the " +
        "USB-stick into any computer, then click on Recover Secret." }),
    d.ownerExternal
      ? el("p", {}, [el("strong", { text: "This kit also requires the owner's key" }),
        " — a code starting with KEEP1, held by the owner separately from this stick. " +
        "Without it, the keys below cannot decrypt the secret."])
      : null,
    el("h2", { text: "Kit Identity" }),
    el("table", { class: "kv" }, [
      el("tr", {}, [el("th", { text: "Key Set" }),
        el("td", { class: "mono", text: d.setIdHex })]),
      el("tr", {}, [el("th", { text: "Scheme" }),
        el("td", { text: schemeLabel(d.k, d.n, d.ownerExternal) })]),
      el("tr", {}, [el("th", { text: "Kit Fingerprint" }),
        el("td", { class: "mono", text: d.fingerprint })]),
      el("tr", {}, [el("th", { text: "File Hash, SHA-256" }),
        el("td", { class: "mono", text: d.fileHash })]),
    ]),
    ...(d.ownerExternal ? [
      // one line, not two: the note is border-line for one A4 page with
      // five holders, and a saved line keeps the table on the same sheet
      el("p", {}, ["The owner's key is stored at the following location:",
        el("span", { class: "blank inline" })]),
    ] : []),
    el("h2", { text: "Key Holders" }),
    el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", { text: "Key" }), el("th", { text: "Name" }), el("th", { text: "Contact" }),
      ])),
      el("tbody", {}, holders),
    ]),
  ];
}

function ownerBlocks(d) {
  return [
    el("h1", { text: "Owner's Instructions" }),
    el("p", { text:
      "These are the instructions for the use of this app, in the case you were to " +
      "forget for one reason or another." }),
    el("p", { text:
      "Every year, you should check both USB sticks work as intended. That the SHA-256 " +
      "is unchanged, and that you are able to decrypt the contents from the USB stick " +
      "and that the secret matches. If you have saved the RECOVERY.html elsewhere and " +
      "that works is no indication that USB sticks still are functional." }),
    el("p", { text: "You have chosen to store the USB-sticks at the following locations:" }),
    el("p", {}, ["USB 1:", el("span", { class: "blank inline" })]),
    el("p", {}, ["USB 2:", el("span", { class: "blank inline" })]),
    el("p", { text:
      "Tip: if you keep a password vault, consider storing a copy of the holders' " +
      "keys in it. The yearly decryption test and any secret change then need no " +
      "key holders. It is paramount that these copies are stored safely, and never " +
      "together with the recovery file itself." }),
    ...(d.ownerExternal ? [
      el("p", {}, ["This kit uses a ", el("strong", { text: "separate owner's key" }),
        " — a code starting with KEEP1. Every recovery needs it, together with the " +
        "kit file and the holders' keys; without it, nobody can decrypt the secret, " +
        "no matter how many holders agree. The yearly check above therefore " +
        "includes confirming you can still find and read it."]),
      el("p", {}, ["Store the owner's key somewhere ", el("strong", { text: "secure, yet accessible" }),
        " if you were to forget your secret, or to your next of kin if you were " +
        "to perish or become permanently incapacitated. Never store it together " +
        "with the recovery file itself."]),
    ] : []),
    el("p", { text:
      "Included with each USB stick there is a recovery instruction set. In that " +
      "instruction set there is a file hash, make sure that the file hash matches the " +
      "following hash:" }),
    el("p", {}, el("strong", { text: "File Hash, SHA-256:" })),
    el("p", { class: "mono", text: d.fileHash }),
    el("p", { text: "To verify the file hash you may use one of the following commands:" }),
    el("ul", {}, [
      el("li", {}, ["Linux/Mac: ",
        el("span", { class: "mono", text: "shasum -a 256 RECOVERY.html" })]),
      el("li", {}, ["Windows: ",
        el("span", { class: "mono", text: "Get-FileHash RECOVERY.html" })]),
    ]),
    el("p", { text: "Follow the instructions if needed to decrypt your secret." }),
  ];
}

function holderBlocks() {
  return [
    el("h1", { text: "Key Holder's Instructions" }),
    el("p", { text:
      "You have been entrusted with one of the keys to decrypt a secret. Please do not " +
      "disclose the fact that you are one of the people with this key. Multiple keys " +
      "are required to decrypt the secret." }),
    el("p", { text:
      "Your contact information will be included with the secret to get hold of you if " +
      "needed." }),
    el("p", { text: "Only share the key under the following circumstances:" }),
    el("ul", {}, [
      el("li", { text: "The owner has requested it for any reason" }),
      el("li", {}, ["The owner has perished or is otherwise ",
        el("strong", { class: "ul", text: "permanently" }), " incapacitated"]),
    ]),
    el("p", {}, ["Below is the key itself. Please keep it safe and secure, physically ",
      el("strong", { class: "ul", text: "or" }), " digitally."]),
    el("p", { text:
      "If you store the secret digitally, please make sure to store it in a secure " +
      "password manager or in otherwise secure means, include a copy of this document's " +
      "instructions alongside the secret." }),
    el("p", { text:
      "If stored digitally. Please destroy the physical document (preferably with fire)." }),
    // written in by hand at the ceremony: the sheet head carries the print
    // date, which says nothing about when the kit itself was made
    el("p", {}, ["Date of creation:", el("span", { class: "blank inline" })]),
    el("p", { class: "fineprint", text:
      "The date at the top left is only the date this page was printed." }),
    el("p", {}, ["Set:", el("span", { class: "blank inline" })]),
    el("p", {}, el("strong", { text: "Key:" })),
    el("div", {}, [
      el("span", { class: "keyline" }),
      el("span", { class: "keyline" }),
      el("span", { class: "keyline" }),
    ]),
    el("p", { text:
      "Capital letters and digits only. After the PSR1 prefix, the characters 1, b, " +
      "i and o never appear. A round character is always the digit 0." }),
  ];
}

/**
 * Flow `blocks` into A4 sheets and number the footers truthfully. The
 * usable height is measured against the sheet's CONTENT box, which the
 * print rules reproduce exactly (a full-bleed A4 page with the same 2cm
 * padding), so what fits the preview fits the paper.
 */
function paginate(container, headText, blocks) {
  container.replaceChildren();
  const pages = [];
  let page = null;
  let limit = 0;

  function newPage() {
    // the wordmark carries the brand on paper, so the documents themselves
    // are titled by what they are; ink, not phosphor, and the key mark is
    // the plain 5-of-3 one — a printed page is not tied to one ceremony
    const head = el("div", { class: "sheethead" }, [
      el("span", { class: "sheetword", text: "KEEP" }),
      el("span", { class: "sheetdate", text: headText }),
    ]);
    const body = el("div", { class: "sheetbody" });
    const foot = el("div", { class: "sheetfoot" });
    const stamp = el("div", { class: "sheetmark" });
    stamp.innerHTML = markMarkup(5, 3);
    const sheet = el("section", { class: "sheet" }, [head, body, stamp, foot]);
    container.append(sheet);
    page = { body, foot };
    pages.push(page);
    // content box minus the header band minus the footer band and slack
    limit = A4_H - 2 * SHEET_PAD - (body.offsetTop - SHEET_PAD) - 76;
  }

  newPage();
  for (const block of blocks.filter(Boolean)) {
    page.body.append(block);
    if (page.body.offsetHeight > limit && page.body.childElementCount > 1) {
      page.body.removeChild(block);
      // a heading never stays behind alone at the foot of a page
      const last = page.body.lastElementChild;
      const orphan = last && /^H[12]$/.test(last.tagName) ? last : null;
      if (orphan && page.body.childElementCount > 1) page.body.removeChild(orphan);
      newPage();
      if (orphan) page.body.append(orphan);
      page.body.append(block);
    }
  }
  pages.forEach((p, i) => { p.foot.textContent = `Page ${i + 1} of ${pages.length}`; });
}

/** Scale the A4 sheets down to the column width, reserving the scaled
 *  footprint in flow (a transform does not affect layout). */
function fitPaper(box, fit) {
  // .paper padding both sides, read live: it is rem-scaled with the UI
  const pad = 2 * parseFloat(getComputedStyle(box).paddingLeft) || 0;
  const avail = box.clientWidth - pad;
  if (avail <= 0) return;
  // the sheet keeps physical A4 px (print geometry), so the preview may
  // scale up to the global 1.5 UI scale — what 150% zoom would show
  const k = Math.min(1.5, avail / A4_W);
  fit.style.width = `${A4_W}px`;
  fit.style.height = "";
  fit.style.transform = `scale(${k})`;
  fit.style.height = `${Math.round(fit.scrollHeight * k)}px`;
}

/**
 * The print view: three documents behind three tabs, only the chosen
 * one rendered — so it is also the only one that prints.
 * `v` is a parsed vault or a fresh ceremony result (both carry n, k,
 * setIdHex, fingerprint, createdAt), or null in the blank tool, where
 * only the key holder's page can be printed.
 */
async function showLetter(v, back, tab, knownHash) {
  const d = {
    n: v ? v.n : null,
    k: v ? v.k : null,
    setIdHex: v ? v.setIdHex : "",
    fingerprint: v ? v.fingerprint : "",
    createdAt: v ? v.createdAt : nowSeconds(),
    fileHash: knownHash || "",
    // v is a parsed vault (needsOwnerKey) or a ceremony result (ownerKey)
    ownerExternal: v ? Boolean(v.needsOwnerKey || v.ownerKey) : false,
  };
  if (v && !d.fileHash && PARSED_VAULT) d.fileHash = groupHex(await fileHash());
  let active = v ? tab || "usb" : "holder";
  const blocksFor = (key) => key === "usb" ? usbBlocks(d)
    : key === "owner" ? ownerBlocks(d)
      : holderBlocks();

  const fit = el("div", { class: "papfit" });
  const paperBox = el("div", { class: "paper" }, fit);
  const leadText = lead(PRINT_LEAD[active]);

  // a single document has nothing to switch between, so it shows no tabs
  const offered = PRINT_TABS.filter(([key]) => v || key === "holder");
  const tabButtons = offered.map(([key, label]) => el("button", {
    class: key === active ? "tab on" : "tab",
    type: "button",
    text: label,
    onclick: () => showTab(key),
  }));
  const tabs = offered.length > 1 ? el("div", { class: "tabs" }, tabButtons) : null;

  /** Switching documents changes the paper and the line above it, nothing
   *  else. Re-rendering the whole view would rebuild the rail and reset the
   *  scroll for a change that only concerns one panel — the flash was that. */
  function showTab(key) {
    if (key === active) return;
    active = key;
    offered.forEach(([k], i) => {
      tabButtons[i].className = k === active ? "tab on" : "tab";
    });
    leadText.textContent = PRINT_LEAD[active];
    paginate(fit, fmtDate(d.createdAt), blocksFor(active));
    fitPaper(paperBox, fit);
  }

  // reachable from the kit rail, from the last ceremony step, and from the
  // blank home — the rail differs each time, the tab name does not
  render(
    railPage(
      PARSED_VAULT ? kitRail("PRINT") : v ? ceremonyRail(6) : { home: showHome },
      "Print Instructions"
    ),
    el("div", { class: "noprint" }, [
      title("PRINT"),
      tabs,
      rule(),
      leadText,
      v
        ? el("div", { class: "strip" }, [
          el("span", { text: "A4 PREVIEW" }),
          el("span", { class: "line" }),
          el("span", { text:
            `SET ${d.setIdHex} · ${schemeLabel(d.k, d.n, d.ownerExternal).toUpperCase()}` }),
        ])
        : null,
    ]),
    paperBox,
    el("div", { class: "btnrow noprint" }, [
      btn("BACK", back),
      goBtn("PRINT", () => window.print()),
    ])
  );

  paginate(fit, fmtDate(d.createdAt), blocksFor(active));
  fitPaper(paperBox, fit);
  onViewResize(() => fitPaper(paperBox, fit));
}

/* ------------------------------------------------------------------ */
/* entry                                                               */
/* ------------------------------------------------------------------ */

(async function boot() {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    // data: and plain-http contexts lack WebCrypto; file and secure contexts have it
    return render({},
      title("KEEP"),
      rule(),
      note("bad",
        el("strong", { text: "This environment can't run the kit. " }),
        "The browser's built-in cryptography (WebCrypto) is unavailable here. Save the " +
        "file to disk and open it directly in Chrome, Firefox, Safari or Edge.")
    );
  }
  const b64 = readEmbeddedVaultB64();
  if (b64 !== null) {
    try {
      PARSED_VAULT = await parseVault(fromBase64(b64));
    } catch (err) {
      VAULT_LOAD_ERROR = String(err?.message ?? err);
    }
  }
  showHome();

  // the page's own overlay scrollbar: mounted once on <body> so it survives
  // every render(), with its own slow safety-net poll for content growth
  const pageBar = createEdgeScrollbar(
    document.scrollingElement || document.documentElement,
    document.body,
    { page: true }
  );
  setInterval(pageBar.update, 150);
})();
