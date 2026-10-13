const assert = require("node:assert/strict");
const { test } = require("node:test");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { AgentSupplierServices } = require("../../src/application/agent-supplier-services.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { supplierSummary } = require("../../src/application/agent-supplier-presenter.cjs");

const draft = () => ({ name: "测试供应商", agentType: "codex", baseUrl: "https://fixture.invalid/v1", apiKey: "test-key-never-public", enabled: true, notes: "fixture",
  models: [{ model: "fixture-model", label: "模型", reasoningEfforts: ["low"], defaultReasoningEffort: "low" }], defaultModel: "fixture-model" });
test("supplier persistence encrypts keys, protects defaults and active uses, and checks revisions", async t => {
  const database = await initializeTestDatabase(t, temporary(t));
  const admin = await database.client.user.create({ data: { username: "admin", displayName: "Admin", role: "admin", passwordHash: "unused" } });
  const accounts = new AccountServices(database); t.after(() => accounts.close());
  const services = new AgentSupplierServices(database, { accounts });
  const original = await services.list(admin);
  assert.equal(original.currentId, "codex-server-config");
  await assert.rejects(services.save(null, draft()), { statusCode: 403 });
  const { supplier } = await services.save(admin, draft());
  assert.equal(supplier.hasApiKey, true);
  assert.doesNotMatch(JSON.stringify(supplier), /test-key|credentials|apiKey/);
  const stored = await services.store.read(supplier.id, true);
  assert.equal(stored.apiKey, draft().apiKey);
  assert.doesNotMatch(stored.credentials, /test-key/);
  assert.deepEqual(Object.keys(supplierSummary(stored)).sort(), ["agentType", "id", "mode", "name", "runtimeRevision"]);
  assert.doesNotMatch(JSON.stringify(await services.duplicate(admin, supplier.id)), /test-key|apiKey|credentials/);
  const edit = draft(); delete edit.apiKey;
  const renamed = (await services.save(admin, { ...edit, name: "新名称", revision: 1 }, supplier.id)).supplier;
  assert.equal(renamed.runtimeRevision, 1);
  await assert.rejects(services.save(admin, { ...edit, revision: 1 }, supplier.id), { statusCode: 409 });
  const rotated = (await services.save(admin, { ...draft(), apiKey: "rotated-key", revision: 2 }, supplier.id)).supplier;
  assert.equal(rotated.runtimeRevision, 2);
  await services.activate(admin, supplier.id, { revision: original.selectionRevision });
  await assert.rejects(services.save(admin, { ...edit, enabled: false, revision: 3 }, supplier.id), /先切换/);
  await assert.rejects(services.remove(admin, supplier.id, { revision: 3, confirm: true }), /先切换/);
  const selected = await services.store.selection("codex", true);
  const token = await services.store.reserve("test-workspace", "1-1", selected);
  await services.activate(admin, original.currentId, { revision: selected.selectionRevision });
  await assert.rejects(services.store.reserve("test-workspace", "1-2", selected), /已切换/);
  await assert.rejects(services.remove(admin, supplier.id, { revision: 3, confirm: true }), /状态未确认/);
  await services.store.mark("test-workspace", "1-1", "wrong-token", "idle");
  await assert.rejects(services.remove(admin, supplier.id, { revision: 3, confirm: true }), /状态未确认/);
  await services.store.mark("test-workspace", "1-1", token, "idle");
  await services.remove(admin, supplier.id, { revision: 3, confirm: true });
  await assert.rejects(services.store.read(supplier.id), { statusCode: 404 });
  await assert.rejects(services.remove(admin, original.currentId, { revision: 1, confirm: true }), /不能删除/);
});
test("supplier network operations recheck administrator identity and saved revisions after awaiting", async t => {
  const database = await initializeTestDatabase(t, temporary(t));
  const admin = await database.client.user.create({ data: { username: "admin", displayName: "Admin", role: "admin", passwordHash: "unused" } });
  const accounts = new AccountServices(database); t.after(() => accounts.close());
  let during = async () => {};
  const services = new AgentSupplierServices(database, { accounts, provider: () => ({ supplier: { async fetchModels() { await during(); return []; } } }) });
  const { supplier } = await services.save(admin, draft());
  during = () => services.save(admin, { ...draft(), revision: 1, notes: "changed" }, supplier.id);
  await assert.rejects(services.request(admin, { id: supplier.id, revision: 1 }, "models"), { statusCode: 409 });
  during = () => database.client.user.update({ where: { id: admin.id }, data: { role: "member" } });
  await assert.rejects(services.request(admin, { id: supplier.id, revision: 2 }, "models"), { statusCode: 403 });
});
test("system supplier HTTP requires live administrator identity and CSRF without workspace selection", async t => {
  const database = await initializeTestDatabase(t, temporary(t));
  const accounts = new AccountServices(database); t.after(() => accounts.close());
  const password = "fixture-password";
  const admin = await accounts.create({ username: "admin", password }, null, true);
  const app = createWebServer({ database }); t.after(() => app.close());
  const origin = await app.listen(0); let cookie = "", token = "";
  async function request(route, input, headers = {}) {
    const response = await fetch(origin + route, { method: input === undefined ? "GET" : "POST", headers: { cookie, "x-csrf-token": token, "content-type": "application/json", ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";", 1)[0];
    const data = await response.json(); if (data.token) token = data.token;
    return { status: response.status, data };
  }
  const endpoint = "/api/system/agent-suppliers";
  assert.equal((await request(endpoint)).status, 401);
  await request("/api/auth/session");
  assert.equal((await request("/api/auth/login", { username: "admin", password })).status, 200);
  assert.equal((await request(endpoint)).status, 200);
  assert.equal((await request(endpoint, draft(), { "x-csrf-token": "bad" })).status, 403);
  const created = await request(endpoint, draft()); assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.doesNotMatch(JSON.stringify(created.data), /test-key-never-public/);
  await database.client.user.update({ where: { id: admin.id }, data: { role: "member" } });
  for (const [route, input] of [[endpoint, undefined], [endpoint, draft()], [`${endpoint}/models`, { baseUrl: draft().baseUrl, apiKey: "fixture" }]])
    assert.equal((await request(route, input)).status, 403);
});
