const test = require("node:test");
const assert = require("node:assert/strict");
const { validateBaseBranch, resolveBaseBranch } = require("../../src/domain/development-baseline.cjs");
const { issueInput } = require("../../src/domain/project-issues.cjs");
const { projectInput } = require("../../src/domain/project-input.cjs");
const { presentProject } = require("../../src/application/project-presenter.cjs");
const { presentDevelopment } = require("../../src/application/project-development-presenter.cjs");

test("development baselines accept only explicit short branch names", () => {
  for (const branch of ["main", "release/1.0", "feature/中文"]) assert.equal(validateBaseBranch(branch), branch);
  for (const branch of ["", "HEAD", "refs/heads/main", "origin/main", "abcdef123456", "--help", "a..b", "a@{b", "a b", " main", "a\\b", "a.lock", ".main", "a//b", "a/", "a.", null])
    assert.throws(() => validateBaseBranch(branch), /短分支名/);
  assert.equal(validateBaseBranch("", { allowEmpty: true }), "");
  assert.equal(issueInput({ type: "bug", title: "bug" }).baseBranch, "");
  assert.equal(issueInput({ type: "bug", title: "bug", baseBranch: "release/1.0" }).baseBranch, "release/1.0");
  assert.deepEqual(projectInput({ revision: 1, settings: { baseBranch: "" } }, true).settings, { baseBranch: "" });
  assert.throws(() => projectInput({ revision: 1, settings: { baseRef: "main" } }, true), /未知/);
});

test("baseline resolution inherits project defaults and requires explicit selection for mixed or missing branches", () => {
  assert.equal(resolveBaseBranch([{ baseBranch: "" }], "main"), "main");
  assert.equal(resolveBaseBranch([{ baseBranch: "release/1" }], "main"), "release/1");
  assert.throws(() => resolveBaseBranch([{ baseBranch: "" }], ""), /配置/);
  assert.throws(() => resolveBaseBranch([{ baseBranch: "main" }, { baseBranch: "release/1" }], "main"), /不同/);
  assert.equal(resolveBaseBranch([{ baseBranch: "main" }, { baseBranch: "release/1" }], "", "release/2"), "release/2");
});

test("project and task baseline metadata is public without disclosing another executor's session", () => {
  assert.equal(presentProject({ settings: { baseBranch: "release/1", baseRef: "HEAD" } }).baseBranch, "release/1");
  assert.equal(presentProject({ settings: { baseRef: "main" } }).baseBranch, "");
  const task = { executorId: "owner", snapshot: { title: "task", baseBranch: "main", issues: [] }, createdAt: new Date(), updatedAt: new Date() };
  const dto = presentDevelopment(task, "viewer", { status: "running", sessionId: "private", baseline: { commit: "abc", fetchedAt: "time" } });
  assert.equal(dto.baseBranch, "main");
  assert.equal(dto.baseCommit, "abc");
  assert.equal(dto.fetchedAt, "time");
  assert.equal(dto.execution, null);
  assert.equal(dto.canOpenSession, false);
  assert.doesNotMatch(JSON.stringify(dto), /private/);
});
