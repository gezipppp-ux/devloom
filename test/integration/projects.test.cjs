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
const { administratorPermissions, projectPermissionCatalog, productTemplate, developerTemplate } = require("../../src/domain/project-permissions.cjs");
const { saveSystemSettings } = require("../../src/config/system-settings.cjs");
const { cloneProject } = require("../../src/git/project-clone.cjs");
const { gitRemote } = require("../support/git-remote.cjs");
const { executionConfig } = require("../../src/config/execution-settings.cjs");

const { getPromptTemplates } = require("../../src/domain/prompt-templates.cjs");
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
  const project = (await projects.create(admin, { name: "Example", remoteUrl: "https://git.example/team/repo.git" })).project;
  await saveSystemSettings({ memberStorageRoot: path.join(directory, "members") }, directory);
  return { projects, accounts, admin, member, analyst, database, department, product, project, calls };
}

test("repository directories reserve names case-insensitively and retain suffixes across updates and reopening", async t => {
  const f = await fixture(t);
  assert.equal(f.project.directoryName, "repo");
  const second = (await f.projects.create(f.admin, { name: "另一个项目", remoteUrl: "git@gitee.com:other/Repo.git" })).project;
  assert.match(second.directoryName, /^Repo-[a-f0-9]{8}$/);
  const updated = (await f.projects.update(second.id, f.admin, { revision: second.revision, name: "显示名称", remoteUrl: "https://gitee.com/other/Repo.git" })).project;
  assert.equal(updated.directoryName, second.directoryName);
  const reopened = new ProjectServices(f.database);
  t.after(() => reopened.close());
  assert.equal((await reopened.read(second.id, f.admin)).project.directoryName, second.directoryName);
  const changed = (await f.projects.update(second.id, f.admin, { revision: updated.revision, remoteUrl: "https://gitee.com/other/new-repo.git" })).project;
  assert.equal(changed.directoryName, "new-repo");
  await f.projects.archive(f.project.id, f.admin, { revision: f.project.revision });
  const third = (await f.projects.create(f.admin, { name: "第三个项目", remoteUrl: f.project.remoteUrl })).project;
  assert.match(third.directoryName, /^repo-[a-f0-9]{8}$/);
  for (const remoteUrl of ["https://git.example/team/CON.git", "https://git.example/team/%2frepo.git"])
    await assert.rejects(f.projects.create(f.admin, { name: "非法目录", remoteUrl }), { statusCode: 400 });
  assert.equal(await f.database.client.project.count(), 3);
});

test("concurrent project creation reserves separate directories without duplicate projects or memberships", async t => {
  const f = await fixture(t);
  const created = await Promise.all(["first", "second"].map(owner => f.projects.create(f.admin, { name: owner, remoteUrl: `https://git.example/${owner}/web-coding.git` })));
  const names = created.map(result => result.project.directoryName);
  assert.ok(names.includes("web-coding"));
  assert.equal(new Set(names.map(name => name.toLowerCase())).size, 2);
  assert.match(names.find(name => name !== "web-coding"), /^web-coding-[a-f0-9]{8}$/);
  assert.equal(await f.database.client.project.count(), 3);
  assert.equal(await f.database.client.projectMember.count(), 3);
});

test("project prompt defaults and member overrides isolate types, accounts and projects with revision checks", async t => {
  const f = await fixture(t);
  const defaults = getPromptTemplates();
  assert.deepEqual((await f.database.client.project.findUnique({ where: { id: f.project.id } })).settings.prompts, defaults);
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: ["project.view"] });
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.analyst.id, permissions: ["project.view"] });
  const personal = "私有修复说明 {{title}}\n{{content}}\n{{images}}";
  const shared = "共享需求说明 {{title}}\n{{content}}\n{{images}}";
  const initial = await f.projects.promptSettings(f.project.id, f.member);
  assert.deepEqual(initial.templates, defaults);
  assert.equal(initial.canConfigure, false);
  const saved = await f.projects.savePrompts(f.project.id, f.member, { scope: "personal", revision: initial.personalRevision, templates: { bug: personal } });
  assert.equal(saved.templates.bug, personal);
  assert.equal(saved.templates.requirement, defaults.requirement);
  assert.deepEqual((await f.projects.promptSettings(f.project.id, f.analyst)).overrides, {});
  assert.ok(!JSON.stringify(await f.projects.members(f.project.id, f.admin)).includes(personal), "member lists never disclose personal templates");
  assert.deepEqual((await f.projects.read(f.project.id, f.admin)).project.settings.prompts, defaults);
  await assert.rejects(f.projects.savePrompts(f.project.id, f.member, { scope: "project", revision: 1, templates: { bug: personal } }), { statusCode: 403 });
  await assert.rejects(f.projects.savePrompts(f.project.id, f.member, { scope: "personal", revision: 1, templates: { bug: null } }), { statusCode: 409 });
  for (const templates of [{ manual: personal }, { bug: "缺少资料" }, { bug: "" }, { bug: personal + "{{unknown}}" }])
    await assert.rejects(f.projects.savePrompts(f.project.id, f.member, { scope: "personal", revision: saved.personalRevision, templates }));
  await assert.rejects(f.projects.savePrompts(f.project.id, f.member, { scope: "personal", revision: saved.personalRevision, templates: { bug: personal }, userId: f.analyst.id }), { statusCode: 400 });
  const changed = await f.projects.savePrompts(f.project.id, f.admin, { scope: "project", revision: 1, templates: { requirement: shared, bug: shared } });
  const effective = await f.projects.effectivePrompts(f.project.id, f.member);
  assert.deepEqual(effective, { ...defaults, bug: personal, requirement: shared });
  assert.deepEqual(await f.projects.effectivePrompts(f.project.id, f.analyst), { ...defaults, bug: shared, requirement: shared });
  const another = (await f.projects.create(f.admin, { name: "独立项目", remoteUrl: f.project.remoteUrl })).project;
  await f.projects.saveMember(another.id, f.admin, { userId: f.member.id, permissions: ["project.view"] });
  assert.deepEqual(await f.projects.effectivePrompts(another.id, f.member), defaults);
  const reset = await f.projects.savePrompts(f.project.id, f.member, { scope: "personal", revision: saved.personalRevision, templates: { bug: null } });
  assert.deepEqual(reset.overrides, {});
  assert.equal(reset.templates.bug, shared);
  await f.projects.savePrompts(f.project.id, f.admin, { scope: "project", revision: changed.projectRevision, templates: { bug: null } });
  assert.equal((await f.projects.effectivePrompts(f.project.id, f.member)).bug, defaults.bug);
  const writes = await Promise.allSettled([personal, shared].map(bug => f.projects.savePrompts(f.project.id, f.member, { scope: "personal", revision: reset.personalRevision, templates: { bug } })));
  assert.equal(writes.filter(result => result.status === "fulfilled").length, 1);
  await f.projects.saveMember(f.project.id, f.admin, { revision: 1, permissions: ["project.view"], status: "disabled" }, f.member.id);
  await assert.rejects(f.projects.promptSettings(f.project.id, f.member), { statusCode: 404 });
  const project = (await f.projects.read(f.project.id, f.admin)).project;
  await f.projects.archive(project.id, f.admin, { revision: project.revision });
  await assert.rejects(f.projects.savePrompts(project.id, f.analyst, { scope: "personal", revision: 1, templates: { bug: personal } }), { statusCode: 409 });
});

test("department ceilings and memberships gate operations while administrators can read projects", async t => {
  const f = await fixture(t);
  await assert.rejects(f.projects.authorize(f.project.id, f.member, "project.view"), /未分配/);
  await assert.rejects(f.projects.create(f.member, { name: "no", remoteUrl: f.project.remoteUrl }), /资格/);
  const owner = await f.projects.authorize(f.project.id, f.admin, "project.members.manage");
  assert.deepEqual(new Set(owner.permissions), new Set([...administratorPermissions, "project.configure", "project.members.manage"]));
  await f.projects.authorize(f.project.id, f.admin, "session.start");
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
  await f.projects.authorize(f.project.id, another, "project.view");
});

test("project summaries expose public active participants and respect issue visibility", async t => {
  const f = await fixture(t);
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: ["project.view"] });
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.analyst.id, permissions: productTemplate });
  for (const project of [(await f.projects.read(f.project.id, f.member)).project, (await f.projects.list(f.member)).projects[0]]) {
    assert.equal(project.memberCount, 3);
    assert.equal(project.issueCount, undefined, "a project-only viewer cannot learn issue counts");
    assert.deepEqual(Object.keys(project.owner).sort(), ["displayName", "id"]);
    assert.ok(project.memberPreview.every(member => Object.keys(member).sort().join() === "displayName,id"));
  }
  assert.equal((await f.projects.read(f.project.id, f.admin)).project.issueCount, 0);
  await f.projects.saveMember(f.project.id, f.admin, { revision: 1, permissions: productTemplate, status: "disabled" }, f.analyst.id);
  const summary = (await f.projects.read(f.project.id, f.member)).project;
  assert.equal(summary.memberCount, 2);
  assert.equal(summary.memberPreview.some(person => person.id === f.analyst.id), false);
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
  assert.deepEqual((await f.projects.read(f.project.id, f.admin)).permissions, administratorPermissions);
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
  await assert.rejects(f.projects.prepare(f.project.id, f.admin, { gitAccountId: account.id, requestId: randomUUID() }), /Git 账号不存在/);
  const requestId = randomUUID();
  const accepted = await f.projects.prepare(f.project.id, f.member, { gitAccountId: account.id, requestId });
  const running = f.projects.active.get(accepted.space.id).promise;
  await f.projects.prepare(f.project.id, f.member, { gitAccountId: account.id, requestId });
  await running;
  const ready = (await f.projects.space(f.project.id, f.member)).space;
  assert.equal(ready.status, "ready", ready.error);
  assert.equal(f.calls.filter(([name]) => name === "clone").length, 1);
  assert.equal(f.calls[0][1], f.project.remoteUrl);
  assert.ok(f.calls[1][1].includes(path.join(f.project.directoryName, "members", f.member.username)));
  const config = await f.database.readWorkspace(ready.workspaceId, f.member.id);
  assert.equal(config.workspace.owner_username, "member");
  const configFile = path.join(f.database.dataRoot, "workspaces", ready.workspaceId, "config.json");
  const execution = (await executionConfig(config, configFile)).execution;
  assert.equal(path.dirname(execution.repository), execution.memberRoot);
  assert.equal(execution.worktreeRoot, path.join(execution.memberRoot, "worktree"));
  await f.accounts.update(f.member.id, { displayName: "新的显示名称" }, f.admin);
  await f.projects.update(f.project.id, f.admin, { revision: 1, name: "新项目显示名称" });
  const synced = await f.database.readWorkspace(ready.workspaceId, f.member.id);
  assert.equal(synced.execution.repository, config.execution.repository);
  assert.equal(synced.execution.projectName, config.execution.projectName);
  assert.equal(synced.workspace.owner_username, "member");
  assert.equal((await executionConfig(synced, configFile)).execution.worktreeRoot, execution.worktreeRoot);
  await assert.rejects(executionConfig({ ...config, version: 5 }, configFile), /旧项目目录配置不兼容/);
  await assert.rejects(executionConfig({ ...config, workspace: { ...config.workspace, owner_username: undefined } }, configFile), /账号/);
  assert.equal((await f.projects.workspaceAuthorization(ready.workspaceId, f.member, "session.start")).space.id, ready.id);
  await assert.rejects(f.projects.workspaceAuthorization(ready.workspaceId, f.admin, "session.view"), /不存在/);
  await assert.rejects(git.remove(f.member, account.id), /使用/);
  const checker = new GitAccountServices(f.database, { projects: f.projects, checkConnection: async () => {
    await f.projects.update(f.project.id, f.admin, { revision: 2, description: "Changed during check" });
  } });
  await assert.rejects(checker.check(f.member, { projectId: f.project.id }, account.id), /检测期间已变更/);
  await assert.rejects(f.projects.update(f.project.id, f.admin, { revision: 3, remoteUrl: "https://git.example/other.git" }), /不能更换/);
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

test("Gitee project preparation and settings synchronization preserve each member transport and canonical repository", async t => {
  const calls = [];
  const f = await fixture(t, {
    checkConnection: async (account, remote) => { calls.push(["check", account.id, remote]); },
    clone: async input => { calls.push(["clone", input.account.id, input.remote]); return input.publish(); },
  });
  const peer = await f.accounts.create({ username: "peer", password: "fixture-password", departmentId: f.department.id }, f.admin);
  const git = new GitAccountServices(f.database);
  const draft = await git.store.createKeyDraft(f.member.id, { sshPrivateKey: "fixture-private", publicKey: "fixture-public" });
  const ssh = await git.save(f.member, { name: "Gitee SSH", authType: "ssh", host: "gitee.com", keyDraftId: draft.id });
  const http = await git.save(peer, { name: "Gitee HTTPS", authType: "http", host: "https://gitee.com", username: "login", password: "fixture-secret" });
  const wrongHost = await git.save(f.member, { name: "Other host", authType: "http", host: "https://other.example", username: "login", password: "fixture-secret" });
  const wrongPort = await git.save(f.member, { name: "Other port", authType: "http", host: "https://gitee.com:8443", username: "login", password: "fixture-secret" });
  for (const remoteUrl of ["https://gitee.com/team/repo.git", "git@gitee.com:team/repo.git"]) {
    const project = (await f.projects.create(f.admin, { name: "Gitee transport", remoteUrl })).project;
    for (const actor of [f.member, peer])
      await f.projects.saveMember(project.id, f.admin, { userId: actor.id, permissions: developerTemplate });
    for (const account of [wrongHost, wrongPort])
      await assert.rejects(f.projects.prepare(project.id, f.member, { gitAccountId: account.id, requestId: randomUUID() }), { code: "GIT_ACCOUNT_REMOTE_MISMATCH" });
    await assert.rejects(f.projects.prepare(project.id, peer, { gitAccountId: ssh.id, requestId: randomUUID() }), /不存在/);
    assert.equal((await f.projects.space(project.id, f.member)).space.status, "awaiting_credentials");
    const configs = [];
    for (const [actor, account, transport] of [[f.member, ssh, "git@gitee.com:team/repo.git"], [peer, http, "https://gitee.com/team/repo.git"]]) {
      const accepted = await f.projects.prepare(project.id, actor, { gitAccountId: account.id, requestId: randomUUID() });
      await f.projects.active.get(accepted.space.id).promise;
      const ready = (await f.projects.space(project.id, actor)).space;
      assert.equal(ready.status, "ready", ready.error);
      assert.deepEqual(calls.splice(0), [["check", account.id, transport], ["clone", account.id, transport]]);
      const config = await f.projects.store.readWorkspace(ready.workspaceId, actor.id);
      assert.equal(config.execution.remoteUrl, transport);
      assert.equal(config.execution.gitAccountId, account.id);
      configs.push({ actor, ready, config });
    }
    const updated = await f.projects.update(project.id, f.admin, { revision: project.revision, settings: { initCommands: ["npm ci"] } });
    assert.equal(updated.project.remoteUrl, remoteUrl);
    assert.equal((await f.projects.store.project(project.id)).remoteUrl, remoteUrl);
    for (const { actor, ready, config } of configs) {
      const after = await f.projects.store.readWorkspace(ready.workspaceId, actor.id);
      assert.equal(after.execution.remoteUrl, config.execution.remoteUrl);
      assert.equal(after.execution.gitAccountId, config.execution.gitAccountId);
      assert.equal(after.execution.repository, config.execution.repository);
      assert.deepEqual(after.workspace, config.workspace);
      assert.equal(after.execution.baseBranch, "");
      assert.deepEqual(after.execution.initCommands, ["npm ci"]);
    }
    assert.deepEqual(calls, [], "settings synchronization never reconnects or reclones prepared spaces");
  }
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
  const retired = { tapd: { session: { cookie_header: "fixture-project-secret" } }, prompts: getPromptTemplates() };
  await f.projects.store.saveProject({ settings: retired, revision: 1 }, f.project.id);
  await f.projects.store.writeWorkspace(space.workspaceId, { ...before, tapd: retired.tapd, prompt_templates: retired.prompts });
  for (const settings of [{ tapd: {} }, { prompts: { tapd: "old prompt" } }])
    await assert.rejects(f.projects.update(f.project.id, f.admin, { revision: 2, settings }), { statusCode: 400 });
  const changed = await f.projects.update(f.project.id, f.admin, { revision: 2, settings: { initCommands: ["npm ci"], prompts: { requirement: template } } });
  assert.equal(Object.hasOwn(changed.project.settings, "tapd"), false);
  assert.ok(!JSON.stringify(changed).includes("fixture-project-secret"));
  const after = await f.projects.store.readWorkspace(space.workspaceId, f.member.id);
  assert.equal(after.execution.repository, before.execution.repository);
  assert.deepEqual(after.workspace, before.workspace);
      assert.equal(after.execution.baseBranch, "");
  assert.deepEqual(after.execution.initCommands, ["npm ci"]);
  assert.equal(after.prompt_templates.requirement, template);
  const persisted = await f.database.client.project.findUnique({ where: { id: f.project.id } });
  assert.ok(!JSON.stringify(persisted).includes("fixture-project-secret"));
  const preserved = await f.projects.update(f.project.id, f.admin, { revision: changed.project.revision, settings: { prompts: { requirement: null } } });
  assert.equal(Object.hasOwn(preserved.project.settings, "tapd"), false);
  assert.equal(Object.hasOwn(after, "tapd"), false);
  assert.deepEqual((await f.projects.store.readWorkspace(space.workspaceId, f.member.id)).prompt_templates, getPromptTemplates());
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
            await f.projects.update(f.project.id, f.admin, { revision: 2, name: "Changed during clone" });
          return input.publish();
        },
      });
    } });
    await f.projects.update(f.project.id, f.admin, { revision: 1, remoteUrl: remote.remoteUrl });
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
  assert.equal(listing.canCreateProjects, true);
  assert.equal(listing.creationReadiness.eligible, true);
  assert.deepEqual(listing.creationReadiness.reasons, []);
  assert.equal(listing.setup.departmentAssigned, false);
  await f.projects.create(f.admin, { name: "Allowed", remoteUrl: f.project.remoteUrl });
});

test("administrator owners retain global management after department changes", async t => {
  const f = await fixture(t);
  await f.accounts.update(f.admin.id, { departmentId: f.product.id }, f.admin);
  assert.equal((await f.accounts.store.byId(f.admin.id)).departmentId, null);
  await f.projects.authorize(f.project.id, f.admin, "project.members.manage");
  await f.projects.authorize(f.project.id, f.admin, "project.configure");
});

test("qualified members introduce independent project repositories and revision checks protect edits", async t => {
  const f = await fixture(t);
  await f.accounts.store.update(f.member.id, { canCreateProjects: true });
  const input = { name: "Member project", remoteUrl: "https://git.example/new/repo.git" };
  const created = (await f.projects.create(f.member, input)).project;
  assert.equal(created.remoteUrl, input.remoteUrl);
  assert.equal(created.repositoryEditable, true);
  assert.equal(Object.hasOwn(created, "repository"), false);
  assert.equal(Object.hasOwn(created, "repositoryId"), false);
  assert.equal(Object.hasOwn((await f.projects.list(f.admin)).setup, "hasRepositories"), false);
  const changed = (await f.projects.update(created.id, f.member, { revision: created.revision, remoteUrl: "https://git.example/new/changed.git" })).project;
  assert.equal(changed.remoteUrl, "https://git.example/new/changed.git");
  assert.equal((await f.projects.read(f.project.id, f.admin)).project.remoteUrl, f.project.remoteUrl);
  await assert.rejects(f.projects.update(created.id, f.member, { revision: created.revision, remoteUrl: input.remoteUrl }), /变更/);
  assert.equal((await f.projects.read(created.id, f.admin)).membership, null);
  await f.projects.saveMember(created.id, f.member, { userId: f.analyst.id, permissions: productTemplate });
  assert.equal((await f.projects.read(created.id, f.member)).project.repositoryEditable, true);
  await f.projects.saveMember(created.id, f.member, { userId: f.admin.id, permissions: developerTemplate });
  assert.equal((await f.projects.read(created.id, f.member)).project.repositoryEditable, false);
  await assert.rejects(f.projects.update(created.id, f.member, { revision: changed.revision, remoteUrl: input.remoteUrl }), /不能更换/);
  const saved = (await f.projects.update(created.id, f.member, { revision: changed.revision, remoteUrl: changed.remoteUrl, description: "Same address remains valid" })).project;
  assert.equal(saved.remoteUrl, changed.remoteUrl);
  assert.equal(saved.description, "Same address remains valid");
});

test("projects have no department ownership while account department ceilings and memberships still apply", async t => {
  const f = await fixture(t);
  const input = { name: f.project.name, remoteUrl: "https://git.example/independent.git" };
  await assert.rejects(f.projects.create(f.admin, { ...input, departmentId: f.department.id }), { statusCode: 400 });
  await assert.rejects(f.projects.update(f.project.id, f.admin, { revision: f.project.revision, departmentId: f.product.id }), { statusCode: 400 });
  const sameName = (await f.projects.create(f.admin, input)).project;
  assert.notEqual(sameName.id, f.project.id);
  assert.equal(sameName.name, f.project.name);
  for (const actor of [f.admin, f.member]) {
    const listing = await f.projects.list(actor);
    assert.equal(Object.hasOwn(listing, "departments"), false);
    assert.equal(Object.hasOwn(listing, "departmentId"), false);
    for (const project of listing.projects) {
      assert.equal(Object.hasOwn(project, "department"), false);
      assert.equal(Object.hasOwn(project, "departmentId"), false);
    }
  }
  assert.equal((await f.projects.list(f.member)).projects.length, 0);
  await assert.rejects(f.projects.read(f.project.id, f.member), { statusCode: 404 });
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.analyst.id, permissions: productTemplate });
  await f.projects.authorize(f.project.id, f.analyst, "issue.create");
  assert.equal((await f.accounts.store.byId(f.analyst.id)).departmentId, f.product.id);
  await assert.rejects(f.projects.authorize(f.project.id, f.analyst, "code.operate"), { statusCode: 403 });
  await f.accounts.store.update(f.analyst.id, { canCreateProjects: true });
  await assert.rejects(f.projects.create(f.analyst, input), { statusCode: 403 });
  await f.projects.saveDepartment(f.admin, { revision: f.product.revision, permissions: productTemplate.filter(permission => permission !== "issue.create") }, f.product.id);
  await assert.rejects(f.projects.authorize(f.project.id, f.analyst, "issue.create"), { statusCode: 403 });
});


test("administrators manage all collaboration without membership or department and lose access when their role is revoked", async t => {
  const f = await fixture(t);
  const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
  const content = new ProjectContentServices(f.database, f.projects);
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: grants });
  const observer = await f.accounts.create({ username: "observer", password: "fixture-password", role: "admin", departmentId: f.department.id }, f.admin);
  await f.accounts.store.update(observer.id, { departmentId: null });
  const issue = await content.createIssue(f.project.id, f.member, { type: "bug", title: "Visible bug" });
  await content.addComment(f.project.id, issue.id, f.member, { body: "Visible comment" });
  await content.addDeliverable(f.project.id, f.member, { reviewerId: f.member.id, issueId: issue.id, body: "Visible delivery" });
  const asset = await content.saveAsset(f.project.id, null, f.member, { type: "credential", title: "Credential metadata", secret: "hidden-secret" });
  const file = await content.uploadFile(f.project.id, "issues", issue.id, f.member, { name: "note.txt", mimeType: "text/plain", data: Buffer.from("visible attachment") });
  const read = await f.projects.read(f.project.id, observer);
  assert.equal(read.membership, null);
  assert.equal(read.space, null);
  assert.deepEqual(read.permissions, administratorPermissions);
  assert.deepEqual(read.permissionContext, { administratorAccess: true, departmentName: "", ceiling: [], grants: [] });
  assert.ok(read.project.settings);
  assert.ok((await f.projects.members(f.project.id, observer)).candidates.length);
  assert.equal((await content.listIssues(f.project.id, observer, {})).items.length, 1);
  assert.equal((await content.readIssue(f.project.id, issue.id, observer)).id, issue.id);
  for (const kind of ["comments", "deliverables", "history"])
    assert.ok((await content.children(f.project.id, issue.id, observer, kind, {})).items.length);
  assert.equal((await content.listAssets(f.project.id, observer, {})).items.length, 1);
  assert.equal(JSON.stringify(await content.readAsset(f.project.id, asset.id, observer)).includes("hidden-secret"), false);
  assert.ok((await content.assetHistory(f.project.id, asset.id, observer, {})).items.length);
  assert.equal((await content.listFiles(f.project.id, "issues", issue.id, observer, {})).items.length, 1);
  await content.downloadFile(f.project.id, file.id, observer);
  assert.equal((await content.readSecret(f.project.id, asset.id, observer)).secret, "hidden-secret");
  for (const permission of ["asset.secret.edit", "code.view", "session.view"])
    await f.projects.authorize(f.project.id, observer, permission);
  await assert.rejects(f.projects.read(randomUUID(), observer), { statusCode: 404 });
  await f.projects.update(f.project.id, observer, { revision: f.project.revision, description: "Managed by administrator" });
  await content.addComment(f.project.id, issue.id, observer, { body: "Administrator comment" });
  await f.projects.saveMember(f.project.id, observer, { userId: f.analyst.id, permissions: productTemplate });
  await f.projects.archive(f.project.id, observer, { revision: f.project.revision + 1 });
  const listing = await f.projects.list(observer);
  assert.equal(listing.isAdmin, true);
  assert.equal(listing.projects[0].status, "archived");
  assert.equal(listing.projects[0].membership, null);
  assert.equal(await f.database.client.projectMember.count({ where: { userId: observer.id } }), 0);
  assert.equal(await f.database.client.developmentSpace.count({ where: { userId: observer.id } }), 0);
  await assert.rejects(content.addComment(f.project.id, issue.id, observer, { body: "Archived write" }), { code: "PROJECT_ARCHIVED" });
  await f.projects.archive(f.project.id, observer, { revision: f.project.revision + 2 }, true);
  await f.accounts.store.update(observer.id, { departmentId: f.product.id });
  await f.projects.saveDepartment(f.admin, { revision: f.product.revision, status: "disabled" }, f.product.id);
  assert.equal((await f.projects.read(f.project.id, observer)).permissionContext.administratorAccess, true);
  await f.accounts.store.update(observer.id, { role: "member" });
  assert.deepEqual((await f.projects.list(observer)).projects, []);
  await assert.rejects(content.readIssue(f.project.id, issue.id, observer), { statusCode: 404 });
  await f.accounts.store.update(observer.id, { role: "admin", status: "disabled" });
  await assert.rejects(f.projects.list(observer), { statusCode: 401 });
  await assert.rejects(f.projects.read(f.project.id, observer), { statusCode: 401 });
});


test("administrator creation without department preserves an explicit owner membership", async t => {
  const f = await fixture(t);
  const admin = await f.accounts.create({ username: "newadmin", password: "fixture-password", role: "admin", departmentId: f.department.id }, f.admin);
  await f.accounts.store.update(admin.id, { departmentId: null });
  const created = await f.projects.create(admin, { name: "No department", remoteUrl: f.project.remoteUrl });
  assert.equal(created.project.ownerUserId, admin.id);
  assert.equal(created.membership.userId, admin.id);
  assert.deepEqual(created.membership.permissions, []);
  assert.equal(created.space, null);
  assert.equal((await f.projects.list(admin)).canCreateProjects, true);
});


test("owner succession accepts administrator authority only with an active project membership", async t => {
  const f = await fixture(t);
  const successor = await f.accounts.create({ username: "successor", password: "fixture-password", role: "admin", departmentId: f.department.id }, f.admin);
  await f.accounts.store.update(successor.id, { departmentId: null });
  await assert.rejects(f.projects.update(f.project.id, f.admin, { revision: 1, ownerUserId: successor.id }), /接任负责人/);
  await f.database.client.projectMember.create({ data: { projectId: f.project.id, userId: successor.id, permissions: ["project.view"] } });
  const transferred = await f.projects.update(f.project.id, f.admin, { revision: 1, ownerUserId: successor.id });
  assert.equal(transferred.project.ownerUserId, successor.id);
  await f.projects.saveMember(f.project.id, f.admin, { userId: f.member.id, permissions: ["project.view"] });
  await assert.rejects(f.projects.update(f.project.id, f.admin, { revision: transferred.project.revision, ownerUserId: f.member.id }), /接任负责人/);
  await assert.rejects(f.projects.saveMember(f.project.id, f.admin, { permissions: [], status: "disabled", revision: 1 }, successor.id), /有效部门|接任/);
});


test("administrator owner has all capabilities with empty grants and no department", async t => {
  const f = await fixture(t);
  await f.accounts.store.update(f.admin.id, { departmentId: null });
  const updated = await f.projects.saveMember(f.project.id, f.admin, { revision: 1, permissions: [] }, f.admin.id);
  assert.deepEqual(updated.membership.permissions, []);
  assert.equal(updated.membership.administratorAccess, true);
  assert.deepEqual(updated.membership.grantablePermissions, administratorPermissions);
  assert.deepEqual(updated.membership.effectivePermissions, administratorPermissions);
  const members = await f.projects.members(f.project.id, f.admin);
  const owner = members.members.find(member => member.userId === f.admin.id);
  const candidate = members.candidates.find(user => user.id === f.admin.id);
  assert.equal(owner.administratorAccess, true);
  assert.deepEqual(owner.departmentPermissions, []);
  assert.deepEqual(candidate.permissions, []);
  assert.equal(candidate.administratorAccess, true);
  assert.deepEqual(candidate.grantablePermissions, administratorPermissions);
  await f.projects.authorize(f.project.id, f.admin, "project.members.manage");
  await assert.rejects(f.projects.saveMember(f.project.id, f.admin, { revision: 2, permissions: [], status: "disabled" }, f.admin.id), /接任/);
  for (const permission of administratorPermissions) await f.projects.authorize(f.project.id, f.admin, permission);
  assert.equal(await f.database.client.developmentSpace.count({ where: { userId: f.admin.id } }), 1);
});

test("departmentless nonmember administrators can prepare their own space and claim development", async t => {
  const f = await fixture(t);
  const admin = await f.accounts.create({ username: "independent-admin", role: "admin", password: "fixture-password" }, f.admin);
  assert.equal(admin.departmentId, null);
  const git = await new GitAccountServices(f.database).save(admin, { name: "Admin Git", authType: "http", host: "https://git.example", username: "login", password: "private" });
  const accepted = await f.projects.prepare(f.project.id, admin, { gitAccountId: git.id, requestId: randomUUID() });
  await f.projects.active.get(accepted.space.id).promise;
  const ready = (await f.projects.space(f.project.id, admin)).space;
  assert.equal(ready.status, "ready", ready.error);
  assert.equal((await f.projects.read(f.project.id, admin)).membership, null);
  await f.projects.workspaceAuthorization(ready.workspaceId, admin, "session.start");
  await assert.rejects(f.projects.workspaceAuthorization(ready.workspaceId, f.admin, "session.view"), { statusCode: 404 });
  const { ProjectContentServices } = require("../../src/application/project-content-services.cjs");
  const { ProjectDevelopmentServices } = require("../../src/application/project-development-services.cjs");
  const issue = await new ProjectContentServices(f.database, f.projects).createIssue(f.project.id, admin, { type: "bug", title: "Admin development" });
  const services = new ProjectDevelopmentServices(f.database, f.projects);
  const planned = await services.create(f.project.id, admin, { requestId: randomUUID(), issueIds: [issue.id] });
  assert.equal(planned.tasks[0].executorId, admin.id);
  assert.equal(planned.tasks[0].status, "planned");
  assert.equal((await f.projects.read(f.project.id, admin)).membership, null);
});
