const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { temporary } = require("../support/helpers.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { GitAccountServices } = require("../../src/application/git-account-services.cjs");
const { projectPermissionCatalog, productTemplate, developerTemplate } = require("../../src/domain/project-permissions.cjs");
const { saveSystemSettings } = require("../../src/config/system-settings.cjs");
const { cloneProject } = require("../../src/git/project-clone.cjs");
const { gitRemote } = require("../support/git-remote.cjs");

const all = projectPermissionCatalog.map(permission => permission.id);
const grants = all.filter(permission => permission !== "project.create");
async function fixture(t, options = {}) {
  const directory = temporary(t);
  const database = await initializeTestDatabase(t, directory);
  const accounts = new AccountServices(database);
  const admin = await accounts.create({ username: "admin", password: "fixture-password" }, null, true);
  const calls = [];
  const projects = new ProjectServices(database, { checkConnection: async (...args) => { calls.push(["check", args[1]]); }, clone: async input => { calls.push(["clone", input.target]); return input.publish(); }, ...options });
  t.after(async () => { await projects.close(); await accounts.close(); await database.close(); });
  const department = (await projects.saveDepartment(admin, { name: "Engineering", permissions: all })).department;
  await accounts.store.update(admin.id, { departmentId: department.id });
  const product = (await projects.saveDepartment(admin, { name: "Product", permissions: productTemplate })).department;
  const member = await accounts.create({ username: "member", password: "fixture-password", departmentId: department.id }, admin);
  const analyst = await accounts.create({ username: "analyst", password: "fixture-password", departmentId: product.id }, admin);
  const repository = (await projects.saveRepository(admin, { name: "repo", remoteUrl: "https://git.example/team/repo.git" })).repository;
  const project = (await projects.create(admin, { name: "Example", departmentId: department.id, repositoryId: repository.id })).project;
  await saveSystemSettings({ memberStorageRoot: path.join(directory, "members") }, directory);
  return { projects, accounts, admin, member, analyst, database, department, product, repository, project, calls };
}

test("current department ceilings and memberships gate projects without an administrator bypass", async t => {
  const f = await fixture(t);
  await assert.rejects(f.projects.authorize(f.project.id, f.member, "project.view"), /未分配/);
  await assert.rejects(f.projects.create(f.member, { name: "no", departmentId: f.department.id, repositoryId: f.repository.id }), /资格/);
  const owner = await f.projects.authorize(f.project.id, f.admin, "project.members.manage");
  assert.deepEqual(owner.permissions, ["project.view", "project.configure", "project.members.manage"]);
  await assert.rejects(f.projects.authorize(f.project.id, f.admin, "session.start"), /没有/);
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.analyst.id, permissions: productTemplate });
  assert.equal((await f.projects.read(f.project.id, f.analyst)).space, null);
  await assert.rejects(f.projects.space(f.project.id, f.analyst), /没有/);
  await assert.rejects(f.projects.saveMember(f.project.id, f.admin, { permissions: developerTemplate, revision: 1 }, f.analyst.id), /上限/);
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: developerTemplate });
  const space = (await f.projects.space(f.project.id, f.member)).space;
  assert.equal(space.status, "awaiting_credentials");
  await f.projects.saveMember(f.project.id, f.admin, { permissions: developerTemplate, revision: 1 }, f.member.id);
  assert.equal((await f.projects.space(f.project.id, f.member)).space.id, space.id);
  await f.projects.saveDepartment(f.admin, { revision: f.department.revision, permissions: all.filter(value => !["session.start", "session.continue", "session.approve"].includes(value)) }, f.department.id);
  await assert.rejects(f.projects.authorize(f.project.id, f.member, "session.start"), /没有/);
  await f.projects.authorize(f.project.id, f.analyst, "issue.create");
  const another = await f.accounts.create({ username: "otheradmin", password: "fixture-password", role: "admin", departmentId: f.department.id }, f.admin);
  await assert.rejects(f.projects.authorize(f.project.id, another, "project.view"), /未分配/);
});

test("revisions, owner succession and archive protect identities and retained spaces", async t => {
  const f = await fixture(t);
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: grants });
  const before = (await f.projects.space(f.project.id, f.member)).space;
  await assert.rejects(f.projects.saveMember(f.project.id, f.admin, { permissions: [], status: "disabled", revision: 1 }, f.admin.id), /接任/);
  await assert.rejects(f.projects.update(f.project.id, f.admin, { name: "bad revision", revision: 9 }), /变更/);
  const changed = await f.projects.update(f.project.id, f.admin, { name: "Renamed", ownerUserId: f.member.id, revision: 1 });
  assert.equal(changed.project.ownerUserId, f.member.id);
  await f.projects.saveMember(f.project.id, f.member, { permissions: [], status: "disabled", revision: 1 }, f.admin.id);
  await assert.rejects(f.projects.read(f.project.id, f.admin), /未分配/);
  await f.projects.archive(f.project.id, f.member, { revision: changed.project.revision });
  await f.projects.authorize(f.project.id, f.member, "session.view");
  await f.projects.authorize(f.project.id, f.member, "session.stop");
  await assert.rejects(f.projects.authorize(f.project.id, f.member, "session.start"), /归档/);
  assert.equal((await f.projects.space(f.project.id, f.member)).space.id, before.id);
});

test("space preparation checks the actual repository, publishes once and never accepts foreign credentials", async t => {
  const f = await fixture(t);
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: developerTemplate });
  const git = new GitAccountServices(f.database);
  const account = await git.save(f.member, { name: "personal", authType: "http", host: "https://git.example", username: "login", password: "private", authorName: "Author", authorEmail: "author@example.com" });
  await assert.rejects(f.projects.prepare(f.project.id, f.admin, { gitAccountId: account.id, requestId: randomUUID() }), /没有/);
  const requestId = randomUUID();
  const accepted = await f.projects.prepare(f.project.id, f.member, { gitAccountId: account.id, requestId });
  const running = f.projects.active.get(accepted.space.id).promise;
  await f.projects.prepare(f.project.id, f.member, { gitAccountId: account.id, requestId });
  await running;
  const ready = (await f.projects.space(f.project.id, f.member)).space;
  assert.equal(ready.status, "ready", ready.error);
  assert.equal(f.calls.filter(([name]) => name === "clone").length, 1);
  assert.equal(f.calls[0][1], f.repository.remoteUrl);
  assert.ok(f.calls[1][1].includes(path.join(f.project.id, "members", f.member.id)));
  assert.equal((await f.projects.workspaceAuthorization(ready.workspaceId, f.member, "session.start")).space.id, ready.id);
  await assert.rejects(f.projects.workspaceAuthorization(ready.workspaceId, f.admin, "session.view"), /不存在/);
  await assert.rejects(git.remove(f.member, account.id), /使用/);
  const checker = new GitAccountServices(f.database, { projects: f.projects, checkConnection: async () => {
    await f.projects.saveRepository(f.admin, { revision: f.repository.revision, description: "Changed during check" }, f.repository.id);
  } });
  await assert.rejects(checker.check(f.member, { projectId: f.project.id }, account.id), /检测期间已变更/);
  const secondRepository = (await f.projects.saveRepository(f.admin, { name: "other", remoteUrl: "https://git.example/other.git" })).repository;
  await assert.rejects(f.projects.update(f.project.id, f.admin, { revision: 1, repositoryId: secondRepository.id }), /不能更换/);
});

test("code operators can prepare their repository without any Codex permission", async t => {
  const f = await fixture(t);
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: ["project.view", "code.view", "code.operate"] });
  assert.equal((await f.projects.space(f.project.id, f.member)).space.status, "awaiting_credentials");
  const account = await new GitAccountServices(f.database).save(f.member, { name: "git", authType: "http", host: "https://git.example", username: "login", password: "private" });
  const accepted = await f.projects.prepare(f.project.id, f.member, { gitAccountId: account.id, requestId: randomUUID() });
  await f.projects.active.get(accepted.space.id).promise;
  const space = (await f.projects.space(f.project.id, f.member)).space;
  assert.equal(space.status, "ready");
  await f.projects.workspaceAuthorization(space.workspaceId, f.member, "code.operate");
  await assert.rejects(f.projects.workspaceAuthorization(space.workspaceId, f.member, "session.view"), /没有/);
  await assert.rejects(f.projects.workspaceAuthorization(space.workspaceId, f.member, "session.start"), /没有/);
});

test("project settings propagate to prepared spaces without exposing secrets or changing identity", async t => {
  const f = await fixture(t);
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: developerTemplate });
  const account = await new GitAccountServices(f.database).save(f.member, { name: "git", authType: "http", host: "https://git.example", username: "login", password: "private" });
  const accepted = await f.projects.prepare(f.project.id, f.member, { gitAccountId: account.id, requestId: randomUUID() });
  await f.projects.active.get(accepted.space.id).promise;
  const space = (await f.projects.space(f.project.id, f.member)).space;
  const before = await f.projects.store.readWorkspace(space.workspaceId, f.member.id);
  const template = "Project instructions: {{title}}\n{{content}}\n{{images}}";
  const cookie = "dsc-token=fixture-project-secret; session=fixture-project-cookie";
  const changed = await f.projects.update(f.project.id, f.admin, { revision: 1, settings: { baseRef: "refs/heads/main", initCommands: ["npm ci"], prompts: { manual: template }, tapd: { workspaceId: "12345", cookie } } });
  assert.equal(changed.project.settings.tapd.hasCookie, true);
  assert.ok(!JSON.stringify(changed).includes("fixture-project-secret"));
  const after = await f.projects.store.readWorkspace(space.workspaceId, f.member.id);
  assert.equal(after.execution.repository, before.execution.repository);
  assert.deepEqual(after.workspace, before.workspace);
  assert.equal(after.execution.baseRef, "refs/heads/main");
  assert.deepEqual(after.execution.initCommands, ["npm ci"]);
  assert.equal(after.prompt_templates.manual, template);
  const persisted = await f.database.client.project.findUnique({ where: { id: f.project.id } });
  assert.ok(!JSON.stringify(persisted).includes("fixture-project-secret"));
  const preserved = await f.projects.update(f.project.id, f.admin, { revision: changed.project.revision, settings: { prompts: { manual: null }, tapd: { workspaceId: "12345", cookie: "" } } });
  assert.equal(preserved.project.settings.tapd.hasCookie, true);
  assert.deepEqual((await f.projects.store.readWorkspace(space.workspaceId, f.member.id)).prompt_templates, {});
});

test("revocation during clone prevents publishing and keeps the original space for retry", async t => {
  let reached, release;
  const atClone = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { clone: async input => { assert.equal(input.preserveOnFailure, true); reached(); await gate; return input.publish(); } });
  t.after(() => release());
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: developerTemplate });
  const account = await new GitAccountServices(f.database).save(f.member, { name: "git", authType: "http", host: "https://git.example", username: "login", password: "private" });
  const accepted = await f.projects.prepare(f.project.id, f.member, { gitAccountId: account.id, requestId: randomUUID() });
  const pending = f.projects.active.get(accepted.space.id).promise;
  await atClone;
  await f.projects.saveMember(f.project.id, f.admin, { permissions: ["project.view"], revision: 1 }, f.member.id);
  release(); await pending;
  const saved = (await f.projects.read(f.project.id, f.member)).space;
  assert.equal(saved.id, accepted.space.id);
  assert.equal(saved.status, "failed");
  assert.equal(saved.workspaceId, null);
  assert.equal(await f.database.client.workspace.count(), 0);
});

for (const failure of ["clone", "publication"]) {
  test(`explicit retry after ${failure} failure preserves the failed checkout and publishes a new attempt`, async t => {
    const remote = await gitRemote(temporary(t));
    t.after(() => remote.close());
    const targets = [];
    let f;
    f = await fixture(t, { clone: async input => {
      targets.push(input.target);
      return cloneProject({ ...input,
        // A real authentication failure happens after cloneProject claims its directory.
        account: failure === "clone" && targets.length === 1 ? { ...input.account, password: "wrong" } : input.account,
        publish: async () => {
          if (failure === "publication" && targets.length === 1)
            await f.projects.update(f.project.id, f.admin, { revision: 1, name: "Changed during clone" });
          return input.publish();
        },
      });
    } });
    await f.projects.saveRepository(f.admin, { revision: f.repository.revision, remoteUrl: remote.remoteUrl }, f.repository.id);
    await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: developerTemplate });
    const account = await new GitAccountServices(f.database).save(f.member, {
      name: "local fixture", authType: "http", host: new URL(remote.remoteUrl).origin,
      username: remote.username, password: remote.password,
    });
    const firstRequest = { gitAccountId: account.id, requestId: randomUUID() };
    const first = await f.projects.prepare(f.project.id, f.member, firstRequest);
    await f.projects.active.get(first.space.id).promise;
    const failed = (await f.projects.space(f.project.id, f.member)).space;
    assert.equal(failed.status, "failed");
    assert.match(failed.error, failure === "clone" ? /Git 克隆失败/ : /准备期间已变更/);
    assert.equal(failed.workspaceId, null);
    assert.equal(fs.existsSync(targets[0]), true);
    if (failure === "publication") assert.equal(fs.readFileSync(path.join(targets[0], "README.md"), "utf8"), "fixture repository");
    fs.writeFileSync(path.join(targets[0], "retained.txt"), "preserve failed attempt");
    assert.equal((await f.projects.prepare(f.project.id, f.member, firstRequest)).space.status, "failed");
    assert.equal(targets.length, 1, "same failed request must not restart clone");

    const retryRequest = { gitAccountId: account.id, requestId: randomUUID() };
    const retry = await f.projects.prepare(f.project.id, f.member, retryRequest);
    const running = f.projects.active.get(retry.space.id).promise;
    await f.projects.prepare(f.project.id, f.member, retryRequest);
    await running;
    const ready = (await f.projects.space(f.project.id, f.member)).space;
    assert.equal(ready.status, "ready", ready.error);
    assert.equal(ready.id, failed.id);
    assert.equal(targets.length, 2);
    assert.notEqual(targets[0], targets[1]);
    assert.equal(path.dirname(targets[0]), path.dirname(targets[1]));
    assert.equal(fs.readFileSync(path.join(targets[0], "retained.txt"), "utf8"), "preserve failed attempt");
    assert.equal(fs.readFileSync(path.join(targets[1], "README.md"), "utf8"), "fixture repository");
    const config = await f.projects.store.readWorkspace(ready.workspaceId, f.member.id);
    assert.equal(config.execution.repository, targets[1]);
    assert.equal((await f.projects.prepare(f.project.id, f.member, { ...retryRequest, requestId: randomUUID() })).space.workspaceId, ready.workspaceId);
    assert.equal((await f.projects.store.readWorkspace(ready.workspaceId, f.member.id)).execution.repository, targets[1]);
    assert.equal(targets.length, 2, "ready spaces keep the published checkout");
    assert.equal(await f.database.client.workspace.count(), 1);
  });
}


test("active members require project visibility and restored members keep their space", async t => {
  const f = await fixture(t);
  await assert.rejects(f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: [] }), { code: "PROJECT_VIEW_REQUIRED" });
  const created = await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: developerTemplate });
  const removed = await f.projects.saveMember(f.project.id, f.admin, { permissions: developerTemplate, status: "disabled", revision: created.membership.revision }, f.member.id);
  const restored = await f.projects.saveMember(f.project.id, f.admin, { permissions: developerTemplate, status: "active", revision: removed.membership.revision }, f.member.id);
  assert.equal(restored.space.id, created.space.id);
  assert.equal((await f.projects.list(f.member)).projects.length, 1);
});


test("project listing explains the same owner prerequisites enforced during creation", async t => {
  const f = await fixture(t);
  await f.projects.saveDepartment(f.admin, { revision: f.department.revision, permissions: ["project.view"] }, f.department.id);
  const listing = await f.projects.list(f.admin);
  assert.equal(listing.canCreateProjects, false);
  assert.equal(listing.creationReadiness.eligible, false);
  assert.match(listing.creationReadiness.reasons.join(" "), /修改项目配置.*管理项目成员/);
  assert.equal(listing.setup.departmentAssigned, true);
  await assert.rejects(f.projects.create(f.admin, { name: "Blocked", departmentId: f.department.id, repositoryId: f.repository.id }), { statusCode: 403 });
});

test('moving a project owner to a weaker department requires succession first', async t => {
  const f = await fixture(t);
  const before = await f.accounts.store.byId(f.admin.id);
  await assert.rejects(f.accounts.update(f.admin.id, { departmentId: f.product.id }, f.admin), { statusCode: 409 });
  assert.equal((await f.accounts.store.byId(f.admin.id)).departmentId, f.department.id);
  assert.equal((await f.accounts.store.byId(f.admin.id)).auth_version, before.auth_version);
  await f.projects.authorize(f.project.id, f.admin, 'project.members.manage');
  const equal = (await f.projects.saveDepartment(f.admin, { name: 'Equivalent', permissions: all })).department;
  await f.accounts.update(f.admin.id, { departmentId: equal.id }, f.admin);
  await f.projects.authorize(f.project.id, f.admin, 'project.configure');
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: grants });
  await f.projects.update(f.project.id, f.admin, { revision: 1, ownerUserId: f.member.id });
  await f.accounts.update(f.admin.id, { departmentId: f.product.id }, f.admin);
  assert.equal((await f.accounts.store.byId(f.admin.id)).departmentId, f.product.id);
  await f.projects.authorize(f.project.id, f.member, 'project.members.manage');
});
