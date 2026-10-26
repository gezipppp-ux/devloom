const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeItem } = require("../../src/codex/session-item.cjs");
const { validatePreviewState } = require("../../src/domain/session-preview.cjs");

test("Codex markers normalize to ordered neutral references without executing or accepting malformed sources", () => {
  const marker = `visualize${JSON.stringify({ path: "C:/task/p.html", title: "搜索" })}`;
  const item = normalizeItem({ id: "reply", type: "agent_message", text: `Before\n${marker}\nAfter\n${marker}` }, "turn");
  assert.equal(item.previewReferences.length, 2);
  for (const reference of item.previewReferences) assert.equal(item.text.slice(reference.start, reference.end), marker);
  assert.equal(normalizeItem({ type: "userMessage", text: marker }).previewReferences, undefined);
  assert.deepEqual(normalizeItem({ type: "agentMessage", text: "visualize{bad}" }).previewReferences, []);
});

test("preview state validation bounds private and model data together and keeps them separate", () => {
  const value = { widget: { modelContent: { radius: 12 }, privateContent: { note: "hidden" } }, controls: { width: 2 } };
  assert.deepEqual(validatePreviewState(value), value);
  assert.deepEqual(validatePreviewState({}), { widget: null, controls: {} });
  assert.throws(() => validatePreviewState({ controls: { one: {} } }), /调整值/);
  assert.throws(() => validatePreviewState({ widget: { privateContent: "x".repeat(17000) } }), /16 KiB/);
  assert.throws(() => validatePreviewState({ widget: { other: true } }), /格式/);
});
