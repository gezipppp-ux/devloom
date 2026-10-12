const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { postgresFixture } = require("../support/postgres.cjs");

const migration = fs.readFileSync(path.join(__dirname, "../../prisma/migrations/20261012020000_account_display_name/migration.sql"), "utf8");

test("display-name migration initializes existing accounts once and preserves stable identities", async t => {
  const { admin, schema } = await postgresFixture(t);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, auth_version INT NOT NULL);
    INSERT INTO users VALUES ('first', 'alice', 3), ('second', 'bob', 9);`);
  await admin.query(migration);
  assert.deepEqual((await admin.query("SELECT * FROM users ORDER BY id")).rows, [
    { id: "first", username: "alice", auth_version: 3, display_name: "alice" },
    { id: "second", username: "bob", auth_version: 9, display_name: "bob" },
  ]);
  await admin.query("UPDATE users SET display_name = '同名'");
  assert.equal((await admin.query("SELECT COUNT(*)::int AS count FROM users WHERE display_name = '同名'")).rows[0].count, 2);
  await assert.rejects(admin.query("INSERT INTO users (id, username, auth_version) VALUES ('third', 'carol', 1)"), { code: "23502" });
});
