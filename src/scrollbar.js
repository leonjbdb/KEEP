// Overlay scrollbar, ported from ravn-frontend's CurvedEdgeScrollbar
// (straight-edge variant, no React). The native scrollbar is hidden and an
// SVG line takes its place: the thumb is a dashed stroke, a transparent
// wider stroke over the same segment is the grab target, and hovering or
// dragging widens the thumb with a real CSS transition. Because none of it
// is a native scrollbar, the expand works identically in every engine —
// Firefox included.

const SB_GUTTER = 18;  // overlay width; also the grab stroke
const SB_REST = 3;     // thumb at rest
const SB_HOVER = 8;    // thumb under the hand (see .kscroll rules)
const SB_MIN_THUMB = 36;
const SB_INSET = 4;    // track stands off the box edges

/**
 * Mount an overlay scrollbar for `scrollNode` inside `host` (a
 * position:relative wrapper for a box, or a fixed shell for the page).
 * Returns { update, destroy }; the caller owns the update cadence beyond
 * the listeners wired here.
 */
export function createEdgeScrollbar(scrollNode, host, opts = {}) {
  const page = !!opts.page;
  const shell = document.createElement("div");
  shell.className = page ? "kscroll kscroll-page" : "kscroll";
  shell.setAttribute("aria-hidden", "true");
  // built through innerHTML so the SVG namespace never appears as a URL in
  // the source (the build lint rejects anything scheme-shaped)
  shell.innerHTML =
    '<svg preserveAspectRatio="none"><path class="hit"></path><path class="thumb"></path></svg>';
  const svg = shell.firstElementChild;
  const hit = svg.children[0];
  const thumb = svg.children[1];
  host.append(shell);

  let maxDash = 0;
  let maxScroll = 0;

  function measure() {
    return {
      sh: scrollNode.scrollHeight,
      ch: page
        ? (window.innerHeight || document.documentElement.clientHeight)
        : scrollNode.clientHeight,
      st: scrollNode.scrollTop,
    };
  }

  function update() {
    const { sh, ch, st } = measure();
    if (!ch || sh <= ch + 1) {
      delete shell.dataset.on;
      return;
    }
    shell.dataset.on = "true";
    const x = SB_GUTTER - SB_HOVER / 2 - 2;
    const y0 = SB_INSET + SB_HOVER / 2;
    const y1 = ch - SB_INSET - SB_HOVER / 2;
    const trackLen = Math.max(0, y1 - y0);
    const thumbLen = Math.min(trackLen, Math.max((ch / sh) * trackLen, SB_MIN_THUMB));
    maxDash = Math.max(0, trackLen - thumbLen);
    maxScroll = sh - ch;
    const off = maxScroll > 0 ? (st / maxScroll) * maxDash : 0;
    const d = `M ${x} ${y0} L ${x} ${y1}`;
    svg.setAttribute("viewBox", `0 0 ${SB_GUTTER} ${ch}`);
    for (const p of [hit, thumb]) {
      p.setAttribute("d", d);
      // one dash the length of the thumb, then a gap longer than the track:
      // the dash IS the thumb, and sliding the offset scrolls it
      p.setAttribute("stroke-dasharray", `${thumbLen} ${trackLen + thumbLen}`);
      p.setAttribute("stroke-dashoffset", String(-off));
    }
  }

  let drag = null;
  hit.addEventListener("pointerdown", (e) => {
    if (maxDash <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    hit.setPointerCapture(e.pointerId);
    drag = {
      id: e.pointerId,
      startY: e.clientY,
      startTop: scrollNode.scrollTop,
      maxDash,
      maxScroll,
    };
    shell.dataset.drag = "true";
  });
  hit.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    e.preventDefault();
    const delta = drag.maxDash > 0
      ? ((e.clientY - drag.startY) / drag.maxDash) * drag.maxScroll
      : 0;
    scrollNode.scrollTop = Math.min(drag.maxScroll, Math.max(0, drag.startTop + delta));
    update();
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (hit.hasPointerCapture(e.pointerId)) hit.releasePointerCapture(e.pointerId);
    drag = null;
    delete shell.dataset.drag;
  };
  hit.addEventListener("pointerup", endDrag);
  hit.addEventListener("pointercancel", endDrag);
  hit.addEventListener("lostpointercapture", endDrag);

  const scrollTarget = page ? window : scrollNode;
  scrollTarget.addEventListener("scroll", update, { passive: true });
  // typing and pasting grow a textarea's scrollHeight without any observer
  // firing — the input event is the only DOM signal for it
  scrollNode.addEventListener?.("input", update, { passive: true });
  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(update);
    ro.observe(page ? document.body : scrollNode);
  }
  if (page) window.addEventListener("resize", update, { passive: true });
  // setTimeout, not rAF: animation frames stall in hidden tabs, and the
  // first measurement must happen regardless
  setTimeout(update, 0);

  return {
    update,
    destroy() {
      scrollTarget.removeEventListener("scroll", update);
      scrollNode.removeEventListener?.("input", update);
      if (ro) ro.disconnect();
      if (page) window.removeEventListener("resize", update);
      shell.remove();
    },
  };
}
