const assert = require("node:assert/strict");
const { test } = require("node:test");
const { postgresFixture } = require("../support/postgres.cjs");

const options = { skip: !process.env.TEST_DATABASE_URL && !process.env.CI
  ? "设置独立 TEST_DATABASE_URL 后执行 PostgreSQL 集成测试。" : false };

test("PostgreSQL deploy is repeatable and Prisma preserves JSON, bytes and timestamps", options, async (t) => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  await fixture.deploy();
  const database = await fixture.open();
  assert.equal(await database.connect(), database);
  const user = await database.client.user.create({ data: { username: "alice", passwordHash: "fixture-hash" } });
  const workspace = await database.client.workspace.create({ data: { ownerUserId: user.id, name: "开发空间" } });
  assert.equal(user.mustChangePassword, false);
  assert.ok(user.createdAt instanceof Date);
  const content = { message: "中文需求", nested: { active: true }, empty: null, list: [1, "two"] };
  await database.client.workspaceSetting.create({ data: { workspaceId: workspace.id, data: content } });
  assert.deepEqual((await database.client.workspaceSetting.findUnique({ where: { workspaceId: workspace.id } })).data, content);
  const bytes = Buffer.from([0, 255, 128, 34, 10]);
  await database.client.attachment.create({ data: {
    path: "fixture/image.png", workspaceId: workspace.id, mimeType: "image/png", size: bytes.length,
    sha256: "fixture-hash", data: bytes, metadata: { label: "测试" },
  } });
  assert.deepEqual(Buffer.from((await database.client.attachment.findUnique({ where: { path: "fixture/image.png" } })).data), bytes);
  await database.close();
  await database.close();
  assert.throws(() => database.client, /已关闭/);
});

test("Prisma transaction contexts isolate concurrent requests and roll back caught nested failures", options, async (t) => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const database = await fixture.open();
  await database.transaction(async () => {
    await database.client.systemSetting.create({ data: { key: "committed", value: { count: 1 } } });
  });
  await assert.rejects((database.transaction(async () => {
    await database.client.systemSetting.create({ data: { key: "rolled-back", value: {} } });
    try {
      await database.transaction(async () => {
        await database.client.systemSetting.create({ data: { key: "nested", value: {} } });
        throw new Error("nested-failure");
      });
    } catch { /* Outer callback must not turn an inner failure into a commit. */ }
  })), /nested-failure/);
  assert.deepEqual((await database.client.systemSetting.findMany()).map(({ key }) => key), ["committed"]);

  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const failing = (database.transaction(async () => {
    await database.client.systemSetting.create({ data: { key: "concurrent-failure", value: {} } });
    entered();
    await gate;
    throw new Error("rollback-only-this-request");
  }));
  const rejected = assert.rejects(failing, /rollback-only-this-request/);
  await started;
  try {
    await database.transaction(async () => {
      await database.client.systemSetting.create({ data: { key: "concurrent-success", value: {} } });
    });
  } finally { release(); }
  await rejected;
  assert.equal(await database.client.systemSetting.count({ where: { key: "concurrent-failure" } }), 0);
  assert.equal(await database.client.systemSetting.count({ where: { key: "concurrent-success" } }), 1);
});

test("PostgreSQL enforces concurrent uniqueness and ownership foreign keys", options, async (t) => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const database = await fixture.open();
  const results = await Promise.allSettled([1, 2].map(() => database.client.user.create({
    data: { username: "same-name", passwordHash: "fixture-hash" },
  })));
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.find(({ status }) => status === "rejected").reason.code, "P2002");
  await assert.rejects(database.client.workspace.create({ data: { ownerUserId: "missing-user", name: "invalid-owner" } }),
    (error) => error.code === "P2003");
});

test("PostgreSQL connection fails closed before deployment or after migration corruption", options, async (t) => {
  const fixture = await postgresFixture(t);
  await assert.rejects((fixture.open()), /迁移记录/);
  await fixture.deploy();
  const original = await fixture.admin.query(`SELECT id,checksum FROM "${fixture.schema}"."_prisma_migrations" ORDER BY migration_name LIMIT 1`);
  assert.equal(original.rows.length, 1);
  await fixture.admin.query(`UPDATE "${fixture.schema}"."_prisma_migrations" SET checksum=$1 WHERE id=$2`, ["0".repeat(64), original.rows[0].id]);
  await assert.rejects((fixture.open()), /校验值/);
  await fixture.admin.query(`UPDATE "${fixture.schema}"."_prisma_migrations" SET checksum=$1,finished_at=NULL WHERE id=$2`, [original.rows[0].checksum, original.rows[0].id]);
  await assert.rejects((fixture.open()), /失败或未完成/);
});
