const assert = require("node:assert/strict");
const { test } = require("node:test");
const { postgresOptions } = require("../../src/domain/postgres-options.cjs");
const { verifyPostgresMigrations } = require("../../src/storage/postgres-migrations.cjs");

test("PostgreSQL configuration requires an explicit database and keeps secrets out of errors", () => {
  for (const url of [undefined, "", "private-password", "sqlite:///tmp/test", "postgres://user:private-password@localhost", "postgres://localhost/db#fragment"])
    assert.throws(() => postgresOptions(url), (error) => !error.message.includes("private-password"));
  const configured = postgresOptions("postgresql://user:private-password@localhost/db?schema=test_project&sslmode=require");
  assert.equal(configured.schema, "test_project");
  const parsed = new URL(configured.pool.connectionString);
  assert.equal(parsed.searchParams.has("schema"), false);
  assert.equal(parsed.searchParams.get("sslmode"), "require");
  assert.equal(parsed.password, "private-password");
  assert.ok(configured.pool.connectionTimeoutMillis > 0);
});

test("schema identifiers cannot inject SQL or select multiple namespaces", () => {
  for (const schema of ['public";DROP TABLE users;--', "public,other", "123", "", "a".repeat(64)])
    assert.throws(() => postgresOptions(`postgres://localhost/db?schema=${encodeURIComponent(schema)}`), /schema/);
  assert.throws(() => postgresOptions("postgres://localhost/db?schema=a&schema=b"), /schema/);
  assert.equal(postgresOptions("postgres://localhost/db").schema, "public");
});

test("migration verification rejects missing, failed, edited and newer migrations", () => {
  const expected = [{ name: "20261012200000_baseline", checksum: "original" }];
  const applied = [{ migration_name: expected[0].name, checksum: "original", finished_at: new Date(), rolled_back_at: null }];
  assert.doesNotThrow(() => verifyPostgresMigrations(expected, applied));
  assert.throws(() => verifyPostgresMigrations([], []), /没有可用/);
  assert.throws(() => verifyPostgresMigrations(expected, []), /待执行/);
  assert.throws(() => verifyPostgresMigrations(expected, [{ ...applied[0], finished_at: null }]), /失败或未完成/);
  assert.throws(() => verifyPostgresMigrations(expected, [{ ...applied[0], checksum: "modified" }]), /校验值/);
  assert.throws(() => verifyPostgresMigrations(expected, [...applied, { ...applied[0], migration_name: "future" }]), /版本/);
  assert.throws(() => verifyPostgresMigrations(expected, [{ ...applied[0], migration_name: "previous_baseline" }]), /旧数据不兼容/);
  assert.doesNotThrow(() => verifyPostgresMigrations(expected, [...applied, { ...applied[0], finished_at: null, rolled_back_at: new Date() }]));
});
