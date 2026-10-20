const test = require("node:test");
const assert = require("node:assert/strict");

test("activity grouping preserves history order and turn, message, failure and plan boundaries", async () => {
  const { sessionRows } = await import("../../web/src/features/session/session-activity.js");
  const item = (id, type = "commandExecution", turnId = "turn-a", extra = {}) => ({ id, type, turnId, status: "completed", ...extra });
  const items = [item("u", "userMessage"), item("r", "reasoning"), item("c"),
    item("a", "agentMessage"), item("f", "fileChange"), item("fail", "commandExecution", "turn-a", { exitCode: 1 }),
    item("after"), item("next-turn", "commandExecution", "turn-b"), item("plan", "plan", "turn-b"),
    item("unknown", "approval", "turn-b"), item("no-turn-1", "reasoning", null), item("no-turn-2", "reasoning", null)];
  const snapshot = structuredClone(items);
  const rows = sessionRows(items);
  assert.deepEqual(rows.map(row => row.items?.map(entry => entry.id) || row.item.id),
    ["u", ["r", "c"], "a", ["f"], "fail", ["after"], ["next-turn"], "plan", "unknown", ["no-turn-1"], ["no-turn-2"]]);
  assert.deepEqual(rows.flatMap(row => row.items || [row.item]), snapshot);
  assert.deepEqual(items, snapshot, "grouping must not mutate canonical records");
});

test("activity status does not hide nonzero exits or mislabel incomplete work as completed", async () => {
  const { activityFailed, activitySummary } = await import("../../web/src/features/session/session-activity.js");
  for (const item of [{ status: "failed" }, { error: "failed to write" }, { status: "completed", exitCode: 2 }, { exitCode: "1" }])
    assert.equal(activityFailed(item), true);
  for (const item of [{ exitCode: 0 }, { exitCode: null }, { status: "inProgress" }]) assert.equal(activityFailed(item), false);
  assert.equal(activitySummary([{ type: "reasoning", status: "inProgress" }, { type: "fileChange", status: "inProgress" }]).label, "正在修改文件");
  assert.equal(activitySummary([{ status: "completed" }, { status: "pending" }]).label, "等待执行");
  assert.equal(activitySummary([{ status: "completed" }, { status: "interrupted" }]).label, "已停止");
  assert.equal(activitySummary([{ status: "completed" }, { status: "skipped" }]).completed, undefined);
  assert.equal(activitySummary([{ status: "completed" }]).completed, true);
});
