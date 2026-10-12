const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const path = require("node:path");
const { initializeTestDatabase } = require("../support/database.cjs");
const { temporary } = require("../support/helpers.cjs");
const { test } = require("node:test");
const { postgresFixture } = require("../support/postgres.cjs");
const { GitAccountStore } = require("../../src/storage/git-account-store.cjs");
const { SessionHistoryStore } = require("../../src/storage/session-history-store.cjs");

const options = { skip: !process.env.TEST_DATABASE_URL && !process.env.CI
  ? "设置独立 TEST_DATABASE_URL 后执行 PostgreSQL 集成测试。" : false };

test("PostgreSQL credentials stay encrypted, owner-scoped and protected against stale revisions", options, async (t) => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const database = await fixture.open();
  database.encryptionKey = randomBytes(32);
  const store = new GitAccountStore(database);
  const user = await database.client.user.create({ data: { username: "owner", passwordHash: "fixture" } });
  const input = { name: "primary", authType: "http", host: "https://example.test", username: "owner", password: "private-access-token" };
  const saved = await store.save(user.id, input);
  assert.equal(saved.password, input.password);
  assert.equal(JSON.stringify(await database.client.gitAccount.findMany()).includes(input.password), false);
  await assert.rejects((store.read(saved.id, "other-owner")), { statusCode: 404 });
  const updated = await store.save(user.id, { ...input, password: "rotated-token" }, saved);
  assert.equal(updated.revision, saved.revision + 1);
  await assert.rejects((store.save(user.id, input, saved)), { statusCode: 409 });
  assert.equal((await store.read(saved.id, user.id)).password, "rotated-token");
  const workspace = await database.client.workspace.create({ data: { ownerUserId: user.id, name: "linked" } });
  await database.client.workspaceSetting.create({ data: { workspaceId: workspace.id, data: { agent: { provider: "codex" }, execution: { gitAccountId: saved.id } } } });
  await assert.rejects((store.remove(saved.id, user.id)), /仍被工作区/);
  const draft = await store.createKeyDraft(user.id, { sshPrivateKey: "fixture-private-key", publicKey: "fixture-public-key" });
  await assert.rejects((store.save(user.id, { name: input.name, authType: "ssh", host: "example.test",
    sshPrivateKey: "fixture-private-key", publicKey: "fixture-public-key" }, updated, draft.id)), /切换主机或认证方式/);
  assert.equal((await store.keyDraft(draft.id, user.id)).sshPrivateKey, "fixture-private-key");
  await assert.rejects((store.save(user.id, { ...input, name: "must-roll-back" }, undefined, randomUUID())), /草稿已失效/);
  assert.equal(await database.client.gitAccount.count(), 1);
});

test("PostgreSQL history pagination preserves ordering, live updates and cursor ownership", options, async (t) => {
  const root = temporary(t);
  const database = await initializeTestDatabase(t, root);
  const history = new SessionHistoryStore(path.join(root, "runs/first"), database);
  const other = new SessionHistoryStore(path.join(root, "runs/second"), database);
  for (let index = 0; index < 53; index++) await history.save({ id: `item-${index}`, text: `text-${index}` });
  const first = await history.list();
  assert.equal(first.items.length, 50);
  assert.equal(first.items[0].id, "item-3");
  const older = await history.list(first.nextCursor);
  assert.deepEqual(older.items.map(({ id }) => id), ["item-0", "item-1", "item-2"]);
  assert.equal(older.nextCursor, null);
  await assert.rejects((other.list(first.nextCursor)), /不属于当前任务/);
  await assert.rejects((history.list("db:9999999999999999999")), /无效/);
  await history.save({ id: "item-52", text: "live-update" });
  const beforeReorder = await database.client.sessionItem.findUnique({ where: { runPath_itemId: { runPath: "runs/first", itemId: "item-0" } } });
  const cutoff = new Date(Date.now() - 60000).toISOString();
  await history.reconcile([{ id: "item-52", text: "stale-snapshot" }, { id: "older-import", text: "imported" }], cutoff);
  const all = await database.client.sessionItem.findMany({ where: { runPath: "runs/first" }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  assert.equal(all.length, 54);
  assert.equal(all[0].data.text, "live-update");
  assert.equal(all[1].itemId, "older-import");
  assert.equal(all.find((row) => row.itemId === "item-0").updatedAt.getTime(), beforeReorder.updatedAt.getTime(),
    "reordering history must not masquerade as a fresh content update");
  assert.deepEqual(await history.idsBefore(["item-52", "item-0"], "older-import"), new Set(["item-52"]));
});
