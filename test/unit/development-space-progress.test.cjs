const { test } = require("node:test");
const assert = require("node:assert/strict");
const { presentSpace } = require("../../src/application/project-presenter.cjs");

test("space progress only exposes known stages, bounded percentages and valid timestamps", () => {
  const row = { progress: { stage: "receiving", percent: 64, startedAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:01:00Z", stderr: "credential-bearing output" } };
  const result = presentSpace(row).progress;
  assert.deepEqual(result, { stage: "receiving", percent: 64, startedAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-19T10:01:00.000Z" });
  for (const percent of [-1, 101, "64", 3.5, NaN]) assert.equal(presentSpace({ progress: { ...row.progress, percent } }).progress.percent, null);
  for (const stage of ["validating", "connecting", "publishing"]) assert.equal(presentSpace({ progress: { ...row.progress, stage } }).progress.percent, null);
  assert.equal(presentSpace({ progress: { stage: "raw remote message" } }).progress, null);
  assert.equal(presentSpace({ progress: { stage: "receiving", startedAt: "invalid" } }).progress.startedAt, null);
  assert.equal(presentSpace({}).progress, null);
});
