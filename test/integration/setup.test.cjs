const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { SetupServices } = require("../../src/application/setup-services.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { productTemplate, developerTemplate } = require("../../src/domain/project-permissions.cjs");

const password = "setup-fixture-password";
const readyReport = () => ({ busy: false, tools: ["git", "codex", "node", "npm"].map(id => ({ id, binaryReady: true, status: "pass" })), checks: [{ name: "数据目录可写", status: "pass" }] });
async function fixture(t) {
  const directory = temporary(t), database = await initializeTestDatabase(t, directory, { withSetup: true });
  const accounts = new AccountServices(database), projects = new ProjectServices(database);
  const environment = { read: async () => readyReport(), status: () => ({ busy: false }), close: async () => {} };
  const setup = new SetupServices(database, { accounts, projects, environment, directory });
  t.after(async () => { await projects.close(); await accounts.close(); await database.close(); });
  async function bootstrap() {
    return setup.bootstrap({ username: "admin", displayName: "初始化管理员", password });
  }
  async function step(actor, name, value = {}, skip = false, requestId = randomUUID()) {
    const input = { revision: (await setup.read(actor)).revision, requestId, ...(skip ? { skip } : { value }) };
    return { result: await setup.submit(actor, name, input), input };
  }
  async function prerequisites(actor) {
    await step(actor, "environment", { deferCodexLogin: false });
    await step(actor, "directory", { memberStorageRoot: path.join(directory, "members") });
    await step(actor, "departments");
  }
  return { directory, database, accounts, projects, environment, setup, bootstrap, step, prerequisites };
}

test("fresh setup creates admin directly and concurrent admin creation is atomic", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.setup.status(), { needsAdmin: true });
  const input = { username: "admin", displayName: "管理员", password };
  const results = await Promise.allSettled([f.setup.bootstrap(input), f.setup.bootstrap({ ...input, username: "other" })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await f.database.client.user.count(), 1);
  const actor = results.find(result => result.status === "fulfilled").value;
  assert.equal(actor.mustChangePassword, false);
  assert.equal(actor.role, "admin");
  assert.equal((await f.setup.read(actor)).currentStep, "environment");
  await assert.rejects(f.setup.bootstrap(input), { statusCode: 403 });
  const row = await f.database.client.systemSetup.findUnique({ where: { id: "installation" } });
  assert.equal(row.initialAdminId, actor.id);
  assert.equal(row.status, "pending");
  assert.equal(row.revision, 2);
  assert.notEqual((await f.database.client.user.findFirst()).passwordHash, password);
});

test("setup persists ordered idempotent steps, templates and optional members without cloning or running", async t => {
  const f = await fixture(t), actor = await f.bootstrap();
  await assert.rejects(f.step(actor, "departments"), { statusCode: 409 });
  await f.prerequisites(actor);
  const records = ["product", "developer"].map((kind, index) => ({ kind, username: index ? "test-dev" : "test-product", displayName: index ? "测试#研发" : "测试#产品", password }));
  const created = await f.step(actor, "accounts", { accounts: records });
  const repeated = await f.setup.submit(actor, "accounts", created.input);
  assert.equal(repeated.revision, created.result.revision);
  assert.equal(await f.database.client.user.count(), 3);
  await assert.rejects(f.setup.submit(actor, "accounts", { ...created.input, value: { accounts: [{ ...records[0], password: "changed-password" }] } }), { code: "REQUEST_CONFLICT" });
  const members = created.result.accounts;
  const saved = await f.step(actor, "project", { name: "第一个项目", description: "fixture", remoteUrl: "https://git.example/team/repo.git", memberIds: members.map(item => item.id) });
  for (const member of members) {
    const expected = member.kind === "product" ? productTemplate : developerTemplate;
    const department = saved.result.departments.find(item => item.id === member.departmentId);
    assert.deepEqual(department.permissions.sort(), [...expected].sort());
    const membership = await f.projects.store.membership(saved.result.project.id, member.id);
    assert.deepEqual([...membership.permissions].sort(), [...expected].sort());
    assert.equal((await f.accounts.store.byId(member.id)).must_change_password, true);
  }
  assert.equal(await f.database.client.workspace.count(), 0);
  assert.equal(await f.database.client.run.count(), 0);
  const complete = await f.step(actor, "complete");
  assert.equal(complete.result.status, "completed");
  assert.equal((await f.setup.status(actor)).required, false);
  await f.setup.gate(actor, "GET", "/api/projects");
  assert.ok(!JSON.stringify(complete.result).includes(password));
  assert.ok(!(await f.database.client.setupOperation.findMany()).some(row => JSON.stringify(row).includes(password)));
  await assert.rejects(f.step(actor, "accounts", {}, true), { statusCode: 409 });
});

test("setup rolls back conflicting resources, rechecks environment and resumes non-sensitive drafts", async t => {
  const f = await fixture(t), actor = await f.bootstrap();
  await f.prerequisites(actor);
  const initial = await f.setup.read(actor);
  const draft = { directory: "", accounts: [0, 1].map(() => ({ username: "", displayName: "", selected: false })), project: { name: "未完成", remoteUrl: "", description: "", memberIds: [] } };
  await f.setup.saveDraft(actor, { revision: initial.revision, drafts: draft });
  const resumed = new SetupServices(f.database, f);
  assert.equal((await resumed.read(actor)).drafts.project.name, "未完成");
  const records = ["product", "developer"].map(kind => ({ kind, username: "same-name", displayName: kind, password }));
  await assert.rejects(f.step(actor, "accounts", { accounts: records }));
  assert.equal(await f.database.client.user.count(), 1, "first account rolls back when second conflicts");
  assert.equal((await f.setup.read(actor)).steps.accounts, undefined);
  await f.step(actor, "accounts", {}, true);
  await f.step(actor, "project", {}, true);
  f.environment.read = async () => ({ ...readyReport(), busy: true });
  await assert.rejects(f.step(actor, "complete"), { code: "SETUP_ENVIRONMENT_REQUIRED" });
  f.environment.read = async () => readyReport();
  assert.equal((await f.step(actor, "complete")).result.status, "completed");
});

test("HTTP bootstrap requires session CSRF and origin, signs in admin and gates business routes", async t => {
  const f = await fixture(t);
  const app = createWebServer({ database: f.database, dataDirectory: f.directory, environment: f.environment });
  t.after(() => app.close());
  const origin = await app.listen(0);
  let cookie = "", csrf = "";
  async function request(url, input, headers = {}) {
    const response = await fetch(origin + url, { method: input === undefined ? "GET" : "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json", ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    const data = await response.json(); if (data.token) csrf = data.token;
    return { status: response.status, data };
  }
  assert.deepEqual((await request("/api/setup/status")).data, { needsAdmin: true });
  await request("/api/auth/session");
  const input = { username: "admin", displayName: "管理员", password };
  assert.equal((await request("/api/setup/admin", input, { "x-csrf-token": "wrong" })).status, 403);
  assert.equal((await request("/api/setup/admin", input, { origin: "https://evil.example" })).status, 403);
  assert.equal((await request("/api/setup/admin", { ...input, role: "admin" })).status, 400);
  const result = await request("/api/setup/admin", input);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.user.role, "admin");
  assert.deepEqual(result.data.setup, { needsAdmin: false, required: true });
  assert.equal((await request("/api/projects")).data.code, "SETUP_REQUIRED");
  assert.equal((await request("/api/system/setup")).status, 200);
  assert.equal((await request("/api/setup/admin", input)).status, 403);
  assert.equal((await request("/api/auth/logout", {})).status, 200);
  assert.equal((await request("/api/system/setup")).status, 401);
});

test("admin CLI creation enters setup but configured installs never reopen", async t => {
  const f = await fixture(t);
  const actor = await f.accounts.create({ username: "admin", password }, null, true);
  assert.equal((await f.setup.read(actor)).currentStep, "environment");
  await assert.rejects(f.bootstrap(), { code: "SETUP_ADMIN_EXISTS" });
  await f.database.client.systemSetup.update({ where: { id: "installation" }, data: { status: "not_required" } });
  assert.equal((await f.setup.status(actor)).required, false);
  await f.database.client.user.deleteMany();
  await assert.rejects(f.bootstrap(), { code: "SETUP_ADMIN_EXISTS" });
  const row = await f.database.client.systemSetup.findUnique({ where: { id: "installation" } });
  assert.equal(row.status, "not_required");
  assert.equal(await f.database.client.user.count(), 0);
});

test("setup rejects invalid directories, concurrent duplicate steps, revoked admins and member writes", async t => {
  const f = await fixture(t), actor = await f.bootstrap();
  await f.step(actor, "environment", { deferCodexLogin: false });
  await assert.rejects(f.step(actor, "directory", { memberStorageRoot: "relative-path" }));
  assert.equal((await f.setup.read(actor)).currentStep, "directory");
  await f.step(actor, "directory", { memberStorageRoot: path.join(f.directory, "members") });
  const input = { revision: (await f.setup.read(actor)).revision, requestId: randomUUID(), value: {} };
  const submitted = await Promise.allSettled([f.setup.submit(actor, "departments", input), f.setup.submit(actor, "departments", input)]);
  assert.ok(submitted.some(result => result.status === "fulfilled"));
  assert.equal(await f.database.client.department.count(), 2);
  assert.equal((await f.setup.submit(actor, "departments", input)).currentStep, "accounts");
  const departmentId = (await f.setup.read(actor)).departments[0].id;
  const member = await f.accounts.create({ username: "outsider", password, departmentId }, actor);
  await assert.rejects(f.setup.read(member), { statusCode: 403 });
  await assert.rejects(f.setup.submit(member, "accounts", { revision: (await f.setup.read(actor)).revision, requestId: randomUUID(), skip: true }), { statusCode: 403 });
  await assert.rejects(f.setup.gate(member, "POST", "/api/system/setup/accounts"), { code: "SETUP_REQUIRED" });
  await assert.rejects(f.setup.gate(actor, "POST", "/mcp"), { code: "SETUP_REQUIRED" });
  const before = await f.setup.read(actor);
  await assert.rejects(f.setup.submit(actor, "accounts", { revision: before.revision, requestId: randomUUID(), skip: true }, async () => {
    await f.database.client.user.update({ where: { id: actor.id }, data: { role: "member" } });
  }), { statusCode: 403 });
  assert.equal((await f.database.client.systemSetup.findUnique({ where: { id: "installation" } })).revision, before.revision);
});
