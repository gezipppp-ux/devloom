const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultWorkflow } = require("../../src/domain/issue-workflows.cjs");
const issue = (type, status) => ({ type, status, workflowVersion: { definition: defaultWorkflow(type) } });
const { issueInput, issueTransition, issueTransitions, pageInput } = require("../../src/domain/project-issues.cjs");

test("issues validate typed content and never accept arbitrary execution or state fields", () => {
  assert.equal(issueInput({ type: "requirement", title: "需求" }).type, "requirement");
  assert.equal(issueInput({ type: "bug", title: "缺陷" }).type, "bug");
  assert.throws(() => issueInput({ type: "requirement", title: "需求", status: "done" }), /字段/);
  assert.throws(() => issueInput({ type: "bug", title: "缺陷", watcherIds: ["a", "a"] }), /不同标识/);
  assert.throws(() => issueInput({ revision: 0, title: "修改" }, { type: "bug" }), /修订号/);
  assert.throws(() => pageInput({ limit: 1000 }), /分页/);
});

test("published flows isolate acceptance and require reasons for rejection, reopening and failed verification", () => {
  assert.deepEqual(issueTransitions(issue("bug", "resolved")).find(entry => entry.status === "failed"),
    { id: "resolved_failed", name: "验证失败", status: "failed", permission: "issue.accept", requiresReason: true });
  assert.throws(() => issueTransition(issue("requirement", "planned"), { status: "done", revision: 1 }), /不允许/);
  assert.equal(issueTransition(issue("requirement", "verifying"), { status: "implemented", revision: 1 }).permission, "issue.accept");
  assert.throws(() => issueTransition(issue("bug", "resolved"), { status: "failed", revision: 1 }), /原因/);
  assert.equal(issueTransition(issue("bug", "resolved"), { status: "failed", revision: 1, reason: "验证失败" }).permission, "issue.accept");
  assert.throws(() => issueTransition(issue("bug", "closed"), { status: "pending", revision: 1 }), /原因/);
  assert.equal(issueTransition(issue("bug", "closed"), { status: "pending", revision: 1, reason: "再次出现" }).permission, "issue.transition");
});
