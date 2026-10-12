const test = require("node:test");
const assert = require("node:assert/strict");
const { issueInput, issueTransition, issueTransitions, pageInput } = require("../../src/domain/project-issues.cjs");

test("issues validate typed content and never accept arbitrary execution or state fields", () => {
  assert.equal(issueInput({ type: "requirement", title: "需求" }).status, "review");
  assert.equal(issueInput({ type: "bug", title: "缺陷" }).status, "confirmation");
  assert.throws(() => issueInput({ type: "requirement", title: "需求", status: "done" }), /字段/);
  assert.throws(() => issueInput({ type: "bug", title: "缺陷", participantIds: ["a", "a"] }), /不同标识/);
  assert.throws(() => issueInput({ revision: 0, title: "修改" }, { type: "bug" }), /修订号/);
  assert.throws(() => pageInput({ limit: 1000 }), /分页/);
});

test("fixed flows isolate acceptance and require reasons for rejection, reopening and failed verification", () => {
  assert.deepEqual(issueTransitions({ type: "bug", status: "verification" }).find(entry => entry.status === "fixing"),
    { status: "fixing", permission: "issue.accept", requiresReason: true });
  assert.throws(() => issueTransition({ type: "requirement", status: "review" }, { status: "done", revision: 1 }), /不允许/);
  assert.equal(issueTransition({ type: "requirement", status: "acceptance" }, { status: "done", revision: 1 }).permission, "issue.accept");
  assert.throws(() => issueTransition({ type: "bug", status: "verification" }, { status: "fixing", revision: 1 }), /原因/);
  assert.equal(issueTransition({ type: "bug", status: "verification" }, { status: "fixing", revision: 1, reason: "验证失败" }).permission, "issue.accept");
  assert.throws(() => issueTransition({ type: "bug", status: "closed" }, { status: "ready", revision: 1 }), /原因/);
  assert.equal(issueTransition({ type: "bug", status: "closed" }, { status: "ready", revision: 1, reason: "再次出现" }).permission, "issue.transition");
});
