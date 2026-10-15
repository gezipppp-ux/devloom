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

test("default flows reserve delivery outcomes for events and require reasons for manual reopen", () => {
  assert.equal(issueTransitions(issue("bug", "resolved")).some(entry => entry.status === "rework"), false);
  assert.throws(() => issueTransition(issue("requirement", "planned"), { status: "developing", revision: 1 }), /不允许/);
  assert.throws(() => issueTransition(issue("requirement", "verifying"), { status: "implemented", revision: 1 }), /不允许/);
  assert.equal(issueTransition(issue("bug", "verified"), { status: "closed", revision: 1 }).permission, "issue.accept");
  assert.throws(() => issueTransition(issue("bug", "closed"), { status: "pending", revision: 1 }), /原因/);
  assert.equal(issueTransition(issue("bug", "closed"), { status: "pending", revision: 1, reason: "再次出现" }).permission, "issue.transition");
});
