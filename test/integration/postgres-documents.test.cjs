const assert = require("node:assert/strict");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { postgresFixture } = require("../support/postgres.cjs");
const { temporary, png } = require("../support/helpers.cjs");
const { ApplicationDatabase } = require("../../src/storage/application-database.cjs");

const options = { skip: !process.env.TEST_DATABASE_URL && !process.env.CI
  ? "设置独立 TEST_DATABASE_URL 后执行 PostgreSQL 集成测试。" : false };

test("PostgreSQL workspace documents preserve ownership and encrypt TAPD credentials", options, async (t) => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const directory = temporary(t);
  const database = new ApplicationDatabase({ directory, url: fixture.url, encryptionKey: randomBytes(32) });
  t.after(async () => (await database.close()));
  await database.connect();
  const alice = await database.client.user.create({ data: { username: "alice", displayName: "alice", passwordHash: "fixture" } });
  const bob = await database.client.user.create({ data: { username: "bob", displayName: "bob", passwordHash: "fixture" } });
  const id = randomUUID();
  const config = { workspace: { id, name: "应用", owner_user_id: alice.id, owner_username: "forged" },
    tapd: { session: { cookie_header: "private-tapd-cookie" } }, agent: { provider: "codex" }, execution: {} };
  const file = path.join(directory, "workspaces", id, "config.json");
  await database.writeDocument(file, config);
  assert.equal((await database.readWorkspace(id, alice.id)).workspace.owner_username, "alice");
  assert.equal((await database.readDocument(file)).tapd.session.cookie_header, "private-tapd-cookie");
  await assert.rejects((database.readWorkspace(id, bob.id)), { statusCode: 404 });
  await assert.rejects((database.writeWorkspace(id, { ...config, workspace: { ...config.workspace, owner_user_id: bob.id } })), /所有者/);
  const persisted = await database.client.workspaceSetting.findUnique({ where: { workspaceId: id } });
  assert.equal(JSON.stringify(persisted).includes("private-tapd-cookie"), false);
  assert.deepEqual(await database.listWorkspaces(bob.id), []);
  await assert.rejects((database.readDocument(path.join(directory, "..", "outside.json"))), /当前数据目录/);
});

test("PostgreSQL run cleanup treats path wildcards literally and retains neighboring records", options, async (t) => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const directory = temporary(t);
  const database = new ApplicationDatabase({ directory, url: fixture.url, encryptionKey: randomBytes(32) });
  t.after(async () => (await database.close()));
  await database.connect();
  const exact = path.join(directory, "runs", "task_name");
  const neighbor = path.join(directory, "runs", "taskXname");
  for (const target of [exact, neighbor]) {
    await database.writeDocument(path.join(target, "run.json"), { agent: { provider: "codex" }, status: "running", source: { channel: "manual" } });
    await database.writeDocument(path.join(target, "requirements.json"), { title: "测试" });
    await database.putBlob(path.join(target, "images", "1.png"), png, { mimeType: "image/png" });
    await database.appendLog(path.join(target, "events.jsonl"), "fixture-event\n");
  }
  assert.equal((await database.listDocuments(exact)).length, 2);
  assert.equal((await database.listBlobs(exact)).length, 1);
  assert.deepEqual((await database.readBlob(path.join(exact, "images", "1.png"))).data, png);
  assert.equal(await database.deleteRunDirectory(exact), true);
  assert.deepEqual(await database.listDocuments(exact), []);
  assert.deepEqual(await database.listBlobs(exact), []);
  assert.equal((await database.listDocuments(neighbor)).length, 2);
  assert.equal((await database.listBlobs(neighbor)).length, 1);
  assert.equal(await database.client.logChunk.count(), 1);
  await assert.rejects((database.transaction(async () => {
    await database.updateDocument(path.join(neighbor, "run.json"), (value) => ({ ...value, status: "done" }));
    throw new Error("rollback-run-update");
  })), /rollback-run-update/);
  assert.equal((await database.readDocument(path.join(neighbor, "run.json"))).status, "running");
});
