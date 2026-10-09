const test = require("node:test");
const assert = require("node:assert/strict");

test("file references retain paths and line locations, rejecting remote/unsafe protocols and commands", async () => {
  const { fileReference } = await import("../../web/src/features/session/file-reference.js");
  assert.deepEqual(fileReference("/repo/a.ts:12:3"), { path: "/repo/a.ts", line: 12 });
  assert.deepEqual(fileReference("C:\\work\\test.ts#L9"), { path: "C:\\work\\test.ts", line: 9 });
  assert.deepEqual(fileReference("src/a%20b.vue#L2-L8"), { path: "src/a b.vue", line: 2 });
  for (const value of ["https://example.com/a.ts", "javascript:alert(1).ts", "file:///secret.ts", "//server/a.ts", "npm run build", "pnpm test a.ts", "x.ts?secret", "<script>.ts", "%invalid"])
    assert.equal(fileReference(value), null, value);
});

test("diff rows keep old/new line numbers and pair replacement lines without shifting the rest", async () => {
  const { diffRows, splitRows } = await import("../../web/src/features/session/code-content.js");
  const rows = diffRows([{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 3, lines: ["-old", "+new", "+extra", " same"] }]);
  assert.deepEqual(rows.slice(1).map(r => [r.old, r.next]), [[3, undefined], [undefined, 3], [undefined, 4], [4, 5]]);
  const split = splitRows(rows);
  assert.equal(split[1].left.text, "old");
  assert.equal(split[1].right.text, "new");
  assert.equal(split[2].left, undefined);
  assert.equal(split[3].left.text, "same");
});
