const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { postgresFixture } = require("../support/postgres.cjs");
const { WorkspaceCloneStore } = require("../../src/storage/workspace-clone-store.cjs");

const options = { skip: !process.env.TEST_DATABASE_URL && !process.env.CI
  ? "设置独立 TEST_DATABASE_URL 后执行 PostgreSQL 集成测试。" : false };

test("PostgreSQL clone requests are idempotent and terminal records reject late progress", options, async (t) => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const database = await fixture.open();
  const user = await database.client.user.create({ data: { username: "owner", passwordHash: "fixture" } });
  const clones = new WorkspaceCloneStore(database);
  const input = { requestId: randomUUID(), name: "repository", remoteUrl: "https://example.test/repo.git", gitAccountId: randomUUID() };
  const first = await clones.create(user.id, input);
  assert.equal(first.created, true);
  const repeat = await clones.create(user.id, { gitAccountId: input.gitAccountId, remoteUrl: input.remoteUrl, name: input.name, requestId: input.requestId });
  assert.equal(repeat.created, false);
  assert.equal(repeat.row.id, first.row.id);
  await assert.rejects((clones.create(user.id, { ...input, name: "different-input" })), { statusCode: 409 });
  await assert.rejects((clones.read(first.row.id, "another-owner")), { statusCode: 404 });
  await assert.rejects((clones.dismiss(first.row.id, user.id)), /尚未结束/);
  await clones.progress(first.row.id, { stage: "receiving", percent: 75 });
  await clones.finish(first.row.id, "completed", { id: "workspace-id" });
  await clones.progress(first.row.id, { stage: "receiving", percent: 90 });
  await clones.finish(first.row.id, "failed", null, "late-failure");
  const final = await clones.read(first.row.id, user.id);
  assert.equal(final.status, "completed");
  assert.equal(JSON.parse(final.progress_json).percent, 75);
  await clones.dismiss(first.row.id, user.id);
  assert.deepEqual(await clones.list(user.id), []);
});
