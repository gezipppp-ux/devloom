/* global document */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

// Keep the iframe in the same DOM location: moving it into a dialog/Teleport
// would reload the sandbox and lose interactions that have not been saved yet.
export function usePreviewFullscreen(element) {
  const fullscreen = ref(false), fallback = ref(false), changing = ref(false);
  let alive = true, restore = [], trigger;
  function release() {
    for (const undo of restore.reverse()) undo();
    restore = [];
  }
  function isolate() {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    restore.push(() => { document.body.style.overflow = overflow; });
    for (let current = element.value; current?.parentElement; current = current.parentElement) {
      for (const sibling of current.parentElement.children) {
        if (sibling === current || sibling.inert) continue;
        sibling.inert = true;
        restore.push(() => { sibling.inert = false; });
      }
    }
  }
  function escapeContainment(root) {
    // Engines without a top-layer API need fixed positioning relative to the
    // viewport. Temporarily release ancestor containing blocks, then restore
    // exactly the inline declarations we changed when leaving fullscreen.
    for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = ancestor.style, computed = document.defaultView.getComputedStyle(ancestor);
      for (const [property, value] of Object.entries({ contain: "none", "container-type": "normal", transform: "none",
        filter: "none", "backdrop-filter": "none", perspective: "none", "will-change": "auto", "content-visibility": "visible" })) {
        if (!computed.getPropertyValue(property) || computed.getPropertyValue(property) === value) continue;
        const previous = style.getPropertyValue(property), priority = style.getPropertyPriority(property);
        style.setProperty(property, value, "important");
        restore.push(() => { if (previous) style.setProperty(property, previous, priority); else style.removeProperty(property); });
      }
    }
  }
  function nativeChanged() {
    const active = document.fullscreenElement === element.value || fallback.value;
    if (fullscreen.value && !active) {
      release();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
    fullscreen.value = active;
  }
  async function exit() {
    if (!fullscreen.value) return;
    const root = element.value;
    if (document.fullscreenElement === root) {
      try { await document.exitFullscreen(); } catch { /* Escape may have already exited. */ }
    }
    if (fallback.value) {
      if (root?.hidePopover && root.matches(":popover-open")) root.hidePopover();
      root?.removeAttribute("popover");
      fallback.value = false;
    }
    fullscreen.value = false;
    release();
    await nextTick();
    if (alive && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
  async function toggle() {
    if (changing.value || !alive) return;
    changing.value = true;
    try {
      if (fullscreen.value) { await exit(); return; }
      const root = element.value;
      trigger = document.activeElement;
      try {
        if (!root.requestFullscreen) throw new Error("Fullscreen unavailable");
        await root.requestFullscreen();
      } catch {
        if (!alive) return;
        fallback.value = true;
        await nextTick();
        if (!alive || !root.isConnected) return;
        // Popover's top layer escapes the conversation's scroll/containment
        // without moving the iframe. Older engines use a fixed fallback.
        if (root.showPopover) {
          root.setAttribute("popover", "manual");
          root.showPopover();
        } else escapeContainment(root);
      }
      if (!alive) {
        if (document.fullscreenElement === root) await document.exitFullscreen().catch(() => {});
        return;
      }
      isolate(); nativeChanged();
      await nextTick(); root.focus({ preventScroll: true });
    } finally { changing.value = false; }
  }
  function keydown(event) {
    if (!fullscreen.value) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void exit(); }
    if (event.key !== "Tab") return;
    const targets = [...element.value.querySelectorAll('button, input, select, textarea, a[href], iframe, [tabindex="0"]')]
      .filter(target => !target.disabled && target.getClientRects().length && !target.closest("[inert]"));
    const first = targets[0], last = targets.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && [element.value, first].includes(document.activeElement)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  onMounted(() => document.addEventListener("fullscreenchange", nativeChanged));
  onBeforeUnmount(() => {
    alive = false;
    void exit();
    release();
    document.removeEventListener("fullscreenchange", nativeChanged);
  });
  return { fullscreen, fallback, changing, toggle, exit, keydown };
}
