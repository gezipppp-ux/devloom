/* global window, document, location, MutationObserver, ResizeObserver, CustomEvent, TextEncoder */
// Runs only inside the opaque-origin preview sandbox. No app credentials or
// direct APIs are available here; the parent validates every bridge packet.
(() => {
  const channel = "devloom-preview-v1";
  const token = location.hash.slice(1);
  const initial = JSON.parse(document.getElementById("devloom-preview-state").textContent);
  let state = initial.state, writable = false, instances = 0, ready = false;
  const bindings = new Map();
  const copy = value => JSON.parse(JSON.stringify(value));
  const send = (type, data = {}) => window.parent.postMessage({ channel, token, type, ...data }, "*");
  window.addEventListener("error", event => { if (event.message) send("error", { error: "runtime" }); });
  window.addEventListener("unhandledrejection", () => send("error", { error: "runtime" }));
  function snapshot() {
    if (writable) send("state", { state: copy(state) });
  }
  function controls() {
    if (!ready) return;
    send("controls", { controls: [...bindings.values()].map(binding => ({ ...binding.descriptor,
      value: binding.object[binding.property], hidden: Boolean(binding.container?.closest('[data-variant][hidden]')) })) });
  }
  function valid(binding, value) {
    const d = binding.descriptor;
    if (d.kind === "slider") return typeof value === "number" && Number.isFinite(value) && value >= d.min && value <= d.max;
    if (d.kind === "toggle") return typeof value === "boolean";
    if (d.kind === "color") return typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value);
    return d.options.some(option => option.value === value);
  }
  function apply(values, persist) {
    const callbacks = new Set();
    for (const [id, value] of Object.entries(values || {})) {
      const binding = bindings.get(id);
      if (!binding || !valid(binding, value)) continue;
      binding.object[binding.property] = value;
      if (persist) state.controls[id] = value;
      callbacks.add(binding.onChange);
    }
    for (const callback of callbacks) callback?.();
    controls();
    if (persist) snapshot();
  }
  class Tweak {
    constructor({ container, onChange } = {}) {
      this.container = container;
      this.onChange = onChange;
      this.id = ++instances;
      this.ids = [];
      this.supported = true;
    }
    add(kind, object, property, options = {}) {
      if (this.ids.length >= 12 || bindings.size >= 144) return this;
      const group = this.container?.getAttribute("aria-label") || "Preview";
      const id = `${this.id}:${group.slice(0, 80)}:${String(property).slice(0, 80)}`;
      const descriptor = { id, group: group.slice(0, 120), kind,
        label: String(options.label || property).slice(0, 120),
        reference: String(options.reference || property).slice(0, 120),
        initial: object[property], unit: String(options.unit || "").slice(0, 12) };
      if (kind === "slider") Object.assign(descriptor, { min: Number(options.min ?? 0), max: Number(options.max ?? 100), step: Number(options.step ?? 1) });
      if (kind === "select") descriptor.options = (options.options || []).slice(0, 12).map(option =>
        typeof option === "string" ? { label: option, value: option } : { label: String(option.label), value: String(option.value) });
      const binding = { descriptor, object, property, onChange: this.onChange, container: this.container };
      bindings.set(id, binding);
      this.ids.push(id);
      const restored = state.controls?.[id];
      if (restored !== undefined && valid(binding, restored)) { object[property] = restored; this.onChange?.(); }
      controls();
      return this;
    }
    addSlider(object, property, options) { return this.add("slider", object, property, options); }
    addColorPicker(object, property, options) { return this.add("color", object, property, options); }
    addToggle(object, property, options) { return this.add("toggle", object, property, options); }
    addSelect(object, property, options) { return this.add("select", object, property, options); }
    dispose() { for (const id of this.ids) bindings.delete(id); this.ids = []; controls(); }
  }
  window.Tweak = Tweak;
  window.openai = {
    widgetState: copy(state.widget),
    setWidgetState(value) {
      if (!value || typeof value !== "object" || Array.isArray(value) ||
          Object.keys(value).some(key => !["modelContent", "privateContent"].includes(key))) return;
      const next = copy(value);
      if (new TextEncoder().encode(JSON.stringify({ ...state, widget: next })).length > 16384) {
        send("error", { error: "state-size" }); return;
      }
      window.openai.widgetState = next;
      state.widget = next;
      snapshot();
    },
    sendFollowUpMessage({ prompt, title } = {}) {
      if (typeof prompt === "string" && prompt.trim() && prompt.length <= 12000)
        send("feedback", { prompt, title: String(title || "").slice(0, 120), state: copy(state) });
      return Promise.resolve();
    },
  };
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.data?.channel !== channel || event.data.token !== token) return;
    const message = event.data;
    if (message.type === "init") {
      writable = message.writable === true;
      window.dispatchEvent(new CustomEvent("openai:set_globals", { detail: { globals: { widgetState: window.openai.widgetState } } }));
    } else if (message.type === "viewport" && Number.isFinite(message.scale) && message.scale > 0 && message.scale <= 1) {
      document.body.style.transform = "scale(" + message.scale + ")";
      document.body.style.transformOrigin = "top left";
      document.documentElement.style.overflow = message.fitting ? "hidden" : "auto";
    } else if (message.type === "control" && writable) apply({ [message.id]: message.value }, true);
    else if (message.type === "reset" && writable) apply(Object.fromEntries([...bindings].map(([id, binding]) => [id, binding.descriptor.initial])), true);
    else if (message.type === "original") apply(message.active
      ? Object.fromEntries([...bindings].map(([id, binding]) => [id, binding.descriptor.initial]))
      : Object.fromEntries([...bindings].map(([id, binding]) => [id, state.controls[id] ?? binding.descriptor.initial])), false);
  });
  document.addEventListener("DOMContentLoaded", () => {
    ready = true;
    for (const root of document.querySelectorAll(".viz-carousel")) {
      const variants = [...root.children].filter(child => child.hasAttribute("data-variant"));
      if (variants.length < 2) continue;
      const nav = document.createElement("nav"), select = document.createElement("select");
      nav.className = "devloom-carousel-controls";
      select.setAttribute("aria-label", root.getAttribute("aria-label") || "Design");
      for (const [i, variant] of variants.entries()) {
        const option = document.createElement("option");
        option.value = i; option.textContent = `${i + 1} / ${variants.length} · ${variant.dataset.variant}`;
        select.append(option);
      }
      const activate = index => {
        select.value = String((index + variants.length) % variants.length);
        variants.forEach((variant, i) => { variant.hidden = i !== Number(select.value); });
        controls();
      };
      for (const [label, delta, symbol] of [[root.dataset.previousLabel || "Previous", -1, "←"], [root.dataset.nextLabel || "Next", 1, "→"]]) {
        const button = document.createElement("button");
        button.type = "button"; button.textContent = symbol; button.setAttribute("aria-label", label);
        button.addEventListener("click", () => activate(Number(select.value) + delta));
        nav.append(button);
        if (delta === -1) nav.append(select);
      }
      select.addEventListener("change", () => activate(Number(select.value)));
      root.append(nav); activate(0);
    }
    new MutationObserver(controls).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    let resizeQueued = false, previousSize = "";
    const resize = () => {
      if (resizeQueued) return;
      resizeQueued = true;
      // Offscreen iframes can suspend animation frames. Their dimensions must
      // still reach the host so a short conversation can lay out the preview.
      window.setTimeout(() => {
        resizeQueued = false;
        const size = { height: Math.min(20000, Math.max(160, document.body.offsetHeight, document.body.scrollHeight)),
          width: document.body.scrollWidth > window.innerWidth + 1 ? Math.min(10000, document.body.scrollWidth) : 0 };
        const encoded = JSON.stringify([size, window.innerWidth, window.innerHeight]);
        if (encoded !== previousSize) { previousSize = encoded; send("resize", size); }
      });
    };
    new ResizeObserver(resize).observe(document.body);
    window.addEventListener("resize", resize);
    new MutationObserver(resize).observe(document.body, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ["style", "class", "hidden", "width", "height"] });
    send("ready", { state: copy(state), revision: initial.revision });
    controls(); resize();
    if (document.querySelector("[data-lucide]")) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js";
      script.addEventListener("load", () => window.lucide?.createIcons({ attrs: { width: 16, height: 16 } }));
      document.head.append(script);
    }
  });
  // Links and forms in generated examples never navigate the host or submit.
  document.addEventListener("click", event => { if (event.target.closest("a[href]")) event.preventDefault(); }, true);
  document.addEventListener("submit", event => event.preventDefault(), true);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !event.defaultPrevented) send("escape"); });
})();
