const assert = require("node:assert/strict");
const { test } = require("node:test");
const { promisify } = require("node:util");
const { postgresFixture } = require("../support/postgres.cjs");
const { AccountStore } = require("../../src/storage/account-store.cjs");
const { AuthSessionStore } = require("../../src/storage/auth-session-store.cjs");

const options = { skip: !process.env.TEST_DATABASE_URL && !process.env.CI
  ? "设置独立 TEST_DATABASE_URL 后执行 PostgreSQL 集成测试。" : false };

test("PostgreSQL account changes invalidate sessions without storing their bearer ids", options, async (t) => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const database = await fixture.open();
  const accounts = new AccountStore(database);
  const sessions = new AuthSessionStore(database);
  const admin = await accounts.create({ username: "admin", displayName: "admin", password_hash: "fixture-hash", role: "admin" }, { initial: true });
  const user = await accounts.create({ username: "member", displayName: "member", password_hash: "fixture-hash", role: "member", must_change_password: true });
  assert.equal(user.must_change_password, true);
  const set = promisify(sessions.set.bind(sessions));
  const get = promisify(sessions.get.bind(sessions));
  const sid = "private-bearer-id";
  await set(sid, { userId: user.id, sessionId: sid, encryptedSessionId: "private-encrypted-id", cookie: { expires: new Date(Date.now() + 60000) } });
  assert.equal(await sessions.valid(sid, user.id), true);
  const saved = await database.client.authSession.findFirst();
  assert.equal(JSON.stringify(saved).includes(sid), false);
  assert.equal(JSON.stringify(saved).includes("private-encrypted-id"), false);
  assert.equal((await get(sid)).userId, user.id);
  const next = await accounts.update(user.id, { password_hash: "changed-hash" });
  assert.equal(next.auth_version, user.auth_version + 1);
  assert.equal(await sessions.valid(sid, user.id), false);
  assert.equal(await get(sid), null);
  await assert.rejects((accounts.update(admin.id, { status: "disabled" })), /最后一个/);
  assert.equal((await accounts.byId(admin.id)).status, "active");
});

test("concurrent PostgreSQL administrator changes cannot remove every active administrator", options, async (t) => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const database = await fixture.open();
  const accounts = new AccountStore(database);
  const first = await accounts.create({ username: "first", displayName: "first", password_hash: "fixture-hash", role: "admin" });
  const second = await accounts.create({ username: "second", displayName: "second", password_hash: "fixture-hash", role: "admin" });
  const results = await Promise.allSettled([(accounts.update(first.id, { role: "member" })), (accounts.update(second.id, { role: "member" }))]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = results.find(({ status }) => status === "rejected").reason;
  assert.equal(rejected.statusCode, 409, `${rejected.code}: ${rejected.message}`);
  assert.equal(await database.client.user.count({ where: { role: "admin", status: "active" } }), 1);
});

test("PostgreSQL sessions share a persistent signing secret and reject expired sessions", options, async (t) => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const database = await fixture.open();
  const first = new AuthSessionStore(database);
  const second = new AuthSessionStore(await fixture.open());
  const secrets = await Promise.all([(first.signingSecret()), (second.signingSecret())]);
  assert.equal(secrets[0], secrets[1]);
  await promisify(first.set.bind(first))("expired", { cookie: { expires: new Date(Date.now() - 1000) } });
  assert.equal(await promisify(second.get.bind(second))("expired"), null);
  assert.equal(await database.client.authSession.count(), 0);
});

test("promotion clears department and project grants, demotion removes automatic access", options, async t => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const database = await fixture.open();
  const accounts = new AccountStore(database);
  const department = await database.client.department.create({ data: { name: "Members", permissions: ["project.view"] } });
  const admin = await accounts.create({ username: "admin", displayName: "Admin", password_hash: "fixture", role: "admin", departmentId: department.id, canCreateProjects: true });
  assert.equal(admin.departmentId, null);
  assert.equal(admin.canCreateProjects, false);
  const member = await accounts.create({ username: "member", displayName: "Member", password_hash: "fixture", role: "member", departmentId: department.id, canCreateProjects: true });
  const project = await database.client.project.create({ data: { name: "Project", directoryName: "repo", directoryKey: "repo", remoteUrl: "https://git.example/repo.git", ownerUserId: admin.id } });
  await database.client.projectMember.create({ data: { projectId: project.id, userId: member.id, permissions: ["project.view"] } });
  const promoted = await accounts.update(member.id, { role: "admin" });
  assert.equal(promoted.departmentId, null);
  assert.equal(promoted.canCreateProjects, false);
  const membership = await database.client.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: member.id } } });
  assert.deepEqual(membership.permissions, []);
  const { projectContextPermissions, administratorPermissions } = require("../../src/domain/project-permissions.cjs");
  assert.deepEqual(projectContextPermissions({ user: promoted, project, membership }), administratorPermissions);
  const demoted = await accounts.update(member.id, { role: "member", departmentId: department.id });
  assert.equal(demoted.departmentId, department.id);
  assert.deepEqual(projectContextPermissions({ user: demoted, department, project, membership }), []);
});
