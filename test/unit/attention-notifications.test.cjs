const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SessionViews } = require("../../src/application/session-views.cjs");

test("attention snapshots never backfill notifications and isolate successful baselines by account", async () => {
  const { createAttentionTracker } = await import("../../web/src/features/accounts/attention-tracker.js");
  const tracker = createAttentionTracker(), first = { id: "approval:1" }, second = { id: "delivery:2" };
  assert.deepEqual(tracker.accept("account-a", [first]), []);
  assert.deepEqual(tracker.accept("account-a", [first]), []);
  assert.deepEqual(tracker.accept("account-a", [first, second]), [second]);
  // A failed poll has no accepted snapshot and cannot reset the baseline.
  assert.deepEqual(tracker.accept("account-a", [first, second]), []);
  tracker.accept("account-a", [first]);
  assert.deepEqual(tracker.accept("account-a", [first, second]), [second], "returning to pending is a new action");
  assert.deepEqual(tracker.accept("account-b", [first, second]), [], "another account starts with a fresh silent baseline");
  tracker.reset("account-b");
  assert.deepEqual(tracker.accept("account-b", [second]), []);
});

test("attention request projection exposes no prompts or payloads and discards resolved, stale and unsupported requests", async () => {
  const runtime = { key: "run", connected: true, turnId: "turn", lastActivity: "2026-10-14T01:00:00Z", requests: new Map([
    ["approval", { id: "approval", kind: "approval", turnId: "turn", params: { command: "secret" } }],
    ["question", { id: "question", kind: "user-input", turnId: "turn", questions: [{ question: "secret" }] }],
    ["stale", { id: "stale", kind: "approval", turnId: "old-turn" }],
  ]) };
  const sessions = new Map([["run", runtime]]);
  let reads = 0;
  const store = { isArchived: async () => false, read: async () => ({ workitem: { title: "Original" } }), readSessionTitle: async () => { reads++; runtime.requests.delete("question"); return "Task"; } };
  const agent = { capabilities: { approvals: true, userInput: true }, connect: () => assert.fail("Attention must not connect an Agent") };
  const views = new SessionViews({ store, agent, sessions, assertOpen() {} });
  const result = await views.pendingRequests();
  assert.equal(reads, 1);
  assert.deepEqual(result, [{ key: "run", title: "Task", updatedAt: runtime.lastActivity, requests: [{ id: "approval", kind: "approval", turnId: "turn" }] }]);
  agent.capabilities.approvals = false;
  assert.deepEqual(await views.pendingRequests(), []);
  agent.capabilities.approvals = true;
  runtime.connected = false;
  assert.deepEqual(await views.pendingRequests(), []);
  runtime.connected = true;
  store.isArchived = async () => true;
  assert.deepEqual(await views.pendingRequests(), []);
});
