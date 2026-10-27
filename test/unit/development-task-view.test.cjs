const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const load = () => import(pathToFileURL(path.resolve(__dirname, "../../web/src/features/projects/development-task-view.js")).href);

test("development guidance uses the executor's preparation only when they can start", async () => {
  const { developmentTaskView: view } = await load();
  assert.equal(view({ status: "planned", canStart: true }).step, 1);
  assert.equal(view({ status: "planned", canStart: true }, { spaceReady: true }).step, 2);
  assert.equal(view({ status: "planned", canStart: false }, { spaceReady: true }).title, "等待负责人开始开发");
});
test("failed, unknown and private execution states never imply successful development", async () => {
  const { developmentTaskView: view } = await load();
  assert.match(view({ status: "started", execution: { status: "failed" } }).title, /失败/);
  assert.equal(view({ status: "unknown", execution: { status: "completed" }, canComplete: true }).step, 3);
  assert.equal(view({ status: "started", execution: null }).title, "开发已启动");
  assert.equal(view({ status: "started", execution: null, canComplete: true }).title, "等待人工确认开发结果");
  assert.equal(view({ status: "new-server-state" }).step, 0);
});
test("archived and merged tasks do not offer development guidance", async () => {
  const { developmentTaskView: view } = await load();
  assert.equal(view({ status: "planned", canStart: true, release: { status: "archived" } }).step, 0);
  assert.equal(view({ status: "planned", canStart: true }, { readOnlyReason: "项目已归档" }).step, 0);
  assert.equal(view({ status: "merged", mergedIntoTaskId: "target" }).title, "此任务已合并");
  assert.match(view({ status: "completed" }).description, /各自流程验收/);
});

test("list execution labels distinguish absent, private and unconfirmed runs from task completion", async () => {
  const { developmentExecutionView: view } = await load();
  assert.equal(view({ status: "planned" }).label, "未启动");
  assert.equal(view({ status: "started", canOpenSession: true }).label, "状态待确认");
  assert.equal(view({ status: "started", canOpenSession: false }).label, "不可查看");
  assert.equal(view({ status: "cancelled", canOpenSession: false, runKey: null }).label, "不可查看", "a private run key being hidden does not prove the Agent never ran");
  assert.equal(view({ status: "completed", canOpenSession: true }).label, "状态待确认");
  assert.equal(view({ status: "completed", execution: { status: "running" } }).label, "执行中");
  assert.equal(view({ status: "started", execution: { status: "completed" } }).label, "本轮结束");
  assert.equal(view({ status: "started", execution: { status: "new-server-state" } }).tone, "warning");
});
