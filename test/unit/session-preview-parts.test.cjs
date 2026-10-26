const { test } = require("node:test");
const assert = require("node:assert/strict");

test("adjacent previews share a gallery without swallowing prose, errors or mutating version identities", async () => {
  const { previewParts } = await import("../../web/src/features/session/session-preview-parts.js");
  const first = { type: "preview", id: "one", group: "a", version: 2 };
  const second = { type: "preview", id: "two", group: "b", version: 1 };
  const third = { type: "preview", id: "three", group: "a", version: 3 };
  const prose = { type: "text", text: "Explain this separately." }, blank = { type: "text", text: "\n\n" };
  const error = { type: "preview-error", error: "Unavailable" };
  const parts = [prose, first, blank, second, prose, third, error, first, blank];
  const before = structuredClone(parts);
  const result = previewParts(parts);
  assert.deepEqual(result.map(part => part.type), ["text", "preview-group", "text", "preview-group", "preview-error", "preview-group", "text"]);
  assert.deepEqual(result[1].previews, [first, second]);
  assert.deepEqual(result[3].previews, [third]);
  assert.equal(result[0], prose);
  assert.equal(result.at(-1), blank);
  assert.deepEqual(parts, before);
});
