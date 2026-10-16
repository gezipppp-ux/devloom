const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { setupAdminInput, setupDraftInput, setupStepInput, environmentReadiness } = require("../../src/domain/setup-state.cjs");

test("initial admin accepts account details and rejects client-controlled privileges", () => {
  const input = { username: "admin", displayName: "管理员", password: "fixture-password" };
  assert.equal(setupAdminInput(input).role, "admin");
  for (const extra of [{ role: "member" }, { departmentId: "department" }, { unknown: "value" }])
    assert.throws(() => setupAdminInput({ ...input, ...extra }));
  assert.throws(() => setupAdminInput({ ...input, password: "short" }));
});

test("setup drafts allow unfinished fields but reject passwords and credential-bearing repository URLs", () => {
  const input = { revision: 1, drafts: { accounts: [0, 1].map(() => ({ username: "", displayName: "", selected: true })) } };
  assert.equal(setupDraftInput(input).drafts.accounts[0].username, "");
  input.drafts.accounts[0].password = "secret";
  assert.throws(() => setupDraftInput(input));
  for (const remoteUrl of ["https://user:secret@git.example/repo", "ssh://git:secret@git.example/repo", "https://git.example/repo?token=secret"]) {
    assert.throws(() => setupDraftInput({ revision: 1, drafts: { project: { name: "", description: "", remoteUrl, memberIds: [] } } }));
  }
  for (const step of ["environment", "directory", "departments", "complete"])
    assert.throws(() => setupStepInput(step, { revision: 1, requestId: randomUUID(), skip: true }));
});

test("installed tools permit setup without Codex login data; missing tools and failed checks still block", () => {
  const report = { tools: ["node", "npm", "git", "codex"].map(id => ({ id, binaryReady: true, status: "pass" })), checks: [{ name: "数据目录可写", status: "pass" }] };
  assert.deepEqual(setupStepInput("environment", { revision: 1, requestId: randomUUID(), value: {} }).value, {});
  assert.equal(environmentReadiness(report), true);
  assert.equal(environmentReadiness({ ...report, busy: true }), false);
  assert.equal(environmentReadiness({ ...report, job: { status: "restart-required" } }), false);
  assert.equal(environmentReadiness({ ...report, tools: report.tools.slice(0, -1) }), false);
  assert.equal(environmentReadiness({ ...report, tools: report.tools.map(tool => tool.id === "codex" ? { ...tool, binaryReady: false } : tool) }), false);
  assert.equal(environmentReadiness({ ...report, checks: [{ name: "数据目录可写", status: "fail" }] }), false);
});
