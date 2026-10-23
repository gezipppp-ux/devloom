function legacyCopy(text, document) {
  if (!document?.body || typeof document.createElement !== "function" || typeof document.execCommand !== "function") return false;

  const previousFocus = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  Object.assign(field.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    padding: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  // A modal makes the rest of the document inert, including a body-level field.
  const host = previousFocus?.closest?.("dialog[open]") || document.body;
  host.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, field.value.length);
    return document.execCommand("copy");
  } finally {
    field.remove();
    if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
  }
}

export async function copyText(value, { clipboard = globalThis.navigator?.clipboard, document = globalThis.document } = {}) {
  const text = String(value);
  let clipboardError;
  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }
  if (legacyCopy(text, document)) return;
  throw clipboardError || new Error("Clipboard copy is unavailable.");
}
