// ---------------------------------------------------------------------------
// Keyboard-safe layout on iPad Safari.
//
// Safari's layout viewport does not shrink when the software keyboard opens
// (and it implements neither `interactive-widget` nor navigator.virtualKeyboard),
// so we track window.visualViewport and publish two CSS custom properties:
//
//   --vvh       visible viewport height (px)
//   --kb-inset  innerHeight − visualViewport.height (px, ≥ 0)
//
// Bottom sheets and action bars sit at `bottom: var(--kb-inset)`.
// ---------------------------------------------------------------------------

export function computeViewportVars(win: Window): { vvh: number; kbInset: number } {
  const vv = win.visualViewport;
  const vvh = vv ? vv.height : win.innerHeight;
  const kbInset = vv ? Math.max(0, Math.round(win.innerHeight - vv.height)) : 0;
  return { vvh: Math.round(vvh), kbInset };
}

/** Start publishing --vvh / --kb-inset on :root. Returns a cleanup. */
export function installViewportVars(win: Window = window): () => void {
  const root = win.document.documentElement;
  const vv = win.visualViewport;
  const update = () => {
    const { vvh, kbInset } = computeViewportVars(win);
    root.style.setProperty("--vvh", `${vvh}px`);
    root.style.setProperty("--kb-inset", `${kbInset}px`);
  };
  update();
  vv?.addEventListener("resize", update);
  vv?.addEventListener("scroll", update);
  win.addEventListener("resize", update);
  win.addEventListener("orientationchange", update);
  return () => {
    vv?.removeEventListener("resize", update);
    vv?.removeEventListener("scroll", update);
    win.removeEventListener("resize", update);
    win.removeEventListener("orientationchange", update);
  };
}

/** After a text field gains focus, center it once the keyboard has settled:
 * on the next visualViewport resize or after ~300 ms, whichever comes first. */
export function scrollIntoViewWhenSettled(el: HTMLElement, win: Window = window): void {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    win.visualViewport?.removeEventListener("resize", go);
    el.scrollIntoView({ block: "center" });
  };
  win.visualViewport?.addEventListener("resize", go);
  win.setTimeout(go, 300);
}
