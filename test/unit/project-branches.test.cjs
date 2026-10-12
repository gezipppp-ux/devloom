const test = require("node:test");
const assert = require("node:assert/strict");
const { ProjectBranchServices } = require("../../src/application/project-branch-services.cjs");

function fixture() {
  const actor = { id: "developer" };
  const space = { status: "ready", revision: 1, workspaceId: "workspace", gitAccountId: "account" };
  const account = { revision: 1, password: "private" };
  let permitted = true, calls = 0;
  const service = Object.create(ProjectBranchServices.prototype);
  service.projects = { async authorize(project, selected, permission) {
    assert.equal(project, "project"); assert.equal(selected, actor);
    assert.ok(["session.start", "issue.view"].includes(permission));
    if (!permitted) throw new Error("revoked");
    return { project: {} };
  } };
  service.store = {
    async space(project, owner) { assert.equal(project, "project"); assert.equal(owner, actor.id); return { ...space }; },
    async readWorkspace(id, owner) { assert.equal(id, space.workspaceId); assert.equal(owner, actor.id); return { execution: { repository: "repository", remoteUrl: "remote" } }; },
  };
  service.accounts = { async read(id, owner) { assert.equal(id, space.gitAccountId); assert.equal(owner, actor.id); return { ...account }; } };
  service.listBranches = async (repository, credentials) => {
    calls++; assert.equal(repository, "repository"); assert.equal(credentials.remoteUrl, "remote"); assert.equal(credentials.account.password, "private");
    return { branches: [{ name: "main", commit: "a".repeat(40) }], fetchedAt: "2026-10-12T00:00:00.000Z" };
  };
  return { service, actor, space, account, revoke: () => { permitted = false; }, calls: () => calls };
}

test("project branches require the caller's ready development space and expose no credentials", async () => {
  const f = fixture();
  const result = await f.service.list("project", f.actor);
  assert.equal("defaultBranch" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /private|repository|password/);
  f.space.status = "pending";
  await assert.rejects(f.service.list("project", f.actor), /准备自己的开发空间/);
  assert.equal(f.calls(), 1);
});

test("project branches recheck permissions and credential or space revisions after network waits", async () => {
  for (const change of [f => f.revoke(), f => f.account.revision++, f => f.space.revision++]) {
    const f = fixture(), list = f.service.listBranches;
    f.service.listBranches = async (...args) => { const result = await list(...args); change(f); return result; };
    await assert.rejects(f.service.list("project", f.actor), /revoked|已变化/);
  }
});
