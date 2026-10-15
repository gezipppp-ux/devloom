const assert = require("node:assert/strict");
const { test } = require("node:test");

test("copyText uses the asynchronous Clipboard API when it is available", async () => {
  const { copyText } = await import("../../web/src/shared/components/clipboard.js");
  const copied = [];
  await copyText("MCP configuration", {
    clipboard: { async writeText(value) { copied.push(value); } },
    document: undefined,
  });
  assert.deepEqual(copied, ["MCP configuration"]);
});

test("copyText falls back to the legacy command when Clipboard API is unavailable", async () => {
  const { copyText } = await import("../../web/src/shared/components/clipboard.js");
  const calls = [];
  const field = {
    style: {},
    value: "",
    setAttribute(name, value) { calls.push(["attribute", name, value]); },
    focus(options) { calls.push(["focus", options]); },
    select() { calls.push(["select"]); },
    setSelectionRange(start, end) { calls.push(["selection", start, end]); },
    remove() { calls.push(["remove"]); },
  };
  const previousFocus = { isConnected: true, focus(options) { calls.push(["restore", options]); } };
  const document = {
    activeElement: previousFocus,
    body: { append(element) { calls.push(["append", element]); } },
    createElement(name) { assert.equal(name, "textarea"); return field; },
    execCommand(command) { calls.push(["command", command, field.value]); return true; },
  };

  await copyText("fallback text", {
    clipboard: { async writeText() { throw new Error("permission denied"); } },
    document,
  });

  assert.deepEqual(calls.filter(([name]) => ["append", "select", "selection", "command", "remove", "restore"].includes(name)), [
    ["append", field],
    ["select"],
    ["selection", 0, 13],
    ["command", "copy", "fallback text"],
    ["remove"],
    ["restore", { preventScroll: true }],
  ]);
});

test("copyText reports an error only when neither copy mechanism succeeds", async () => {
  const { copyText } = await import("../../web/src/shared/components/clipboard.js");
  await assert.rejects(
    copyText("unavailable", { clipboard: undefined, document: undefined }),
    /Clipboard copy is unavailable/,
  );
});
