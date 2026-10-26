const { test } = require("node:test");
const assert = require("node:assert/strict");
const { canRetryPreparation } = require("../../src/domain/preparation-retry.cjs");
const { developmentPreparationRetryInput } = require("../../src/domain/project-development.cjs");

test("only unambiguously unstarted preparation failures can retry", () => {
  const state = { execution: { status: "failed" }, transition: { status: "not_started" }, worktree: { repository: "/fixture", baseline: { branch: "main", commit: null } } };
  assert.equal(canRetryPreparation(state), true);
  for (const patch of [{ session_id: "session" }, { execution_started_at: "date" }, { initialization: {} }, { transition: { status: "pending" } },
    ...["preparing", "running", "unknown", "completed"].map(status => ({ execution: { status } })),
    ...[{ path: "/tree" }, { branch: "task" }, { base_commit: "a" }, { baseline: { branch: "main", commit: "a" } }, { baseline: {} }].map(worktree => ({ worktree: { ...state.worktree, ...worktree } }))]) {
    assert.equal(canRetryPreparation({ ...state, ...patch }), false, JSON.stringify(patch));
  }
  assert.equal(canRetryPreparation(null), false);
});

test("preparation retry accepts only a UUID and revision, never replacement execution inputs", () => {
  const input = { requestId: "82255a16-6742-4269-80e1-6aabfa33ae69", revision: 7 };
  assert.deepEqual(developmentPreparationRetryInput(input), input);
  for (const invalid of [{ ...input, requestId: "invalid" }, { ...input, baseBranch: "different" }, { ...input, revision: 0 }])
    assert.throws(() => developmentPreparationRetryInput(invalid), error => error.statusCode === 400);
});
