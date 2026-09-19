const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const BetterSqlite3 = require("better-sqlite3");
const { initializeDatabase, databaseStatus } = require("../../src/storage/database-lifecycle.cjs");
const { databaseForPath } = require("../../src/storage/database-registry.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { executionConfig } = require("../../src/config/execution-settings.cjs");
const { readOptional, updateConfig, writeConfig } = require("../../src/storage/json-files.cjs");
const { temporary, png } = require("../support/helpers.cjs");

function addUser(database, name, role = "member") {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.handle.prepare("INSERT INTO users(id,username,password_hash,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run(id, name, "fixture-hash", role, "active", now, now);
  return { id, username: name, role, status: "active" };
}

test("explicit nested data roots initialize independently from parent resource routing", async (t) => {
  let parent;
  let nested;
  t.after(() => { nested?.close(); parent?.close(); });
  const root = temporary(t);
  const nestedRoot = path.join(root, "cache", "independent-data");
  parent = await initializeDatabase(root);
  nested = await initializeDatabase(nestedRoot);
  assert.notEqual(nested, parent);
  assert.equal(nested.dataRoot, nestedRoot);
  assert.equal(fs.existsSync(path.join(nestedRoot, "db", "web-coding.sqlite")), true);
  addUser(parent, "parent-member");
  addUser(nested, "nested-member");
  assert.deepEqual(parent.handle.prepare("SELECT username FROM users").all(), [{ username: "parent-member" }]);
  assert.deepEqual(nested.handle.prepare("SELECT username FROM users").all(), [{ username: "nested-member" }]);
  const nestedSettings = path.join(nestedRoot, "system-settings.json");
  assert.equal(databaseForPath(nestedSettings), nested);
  assert.equal(await initializeDatabase(nestedRoot), nested);
});

test("SQLite initializes once, skips old files, encrypts credentials and isolates member workspaces", async (t) => {
  let database;
  let reopened;
  t.after(() => { database?.close(); reopened?.close(); });
  const root = temporary(t);
  const staleId = randomUUID();
  const old = path.join(root, "workspaces", staleId, "config.json");
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.writeFileSync(old, JSON.stringify({ workspace: { id: staleId, name: "不会导入" } }));
  const results = await Promise.all([initializeDatabase(root), initializeDatabase(root)]);
  [database] = results;
  const concurrent = results[1];
  assert.equal(database, concurrent);
  assert.equal(databaseForPath(old), database);
  assert.equal(readOptional(old).workspace, undefined);
  assert.equal(database.handle.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  assert.equal(database.handle.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(database.handle.pragma("foreign_keys", { simple: true }), 1);
  const alice = addUser(database, "alice");
  const bob = addUser(database, "bob");
  const admin = addUser(database, "admin", "admin");
  const workspaces = new WorkspaceManager({ directory: path.join(root, "workspaces") });
  const first = workspaces.save({ name: "同名项目" }, undefined, alice);
  const second = workspaces.save({ name: "同名项目" }, undefined, bob);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(workspaces.list(alice).map(({ id }) => id), [first.id]);
  assert.throws(() => workspaces.list(), /登录/);
  assert.throws(() => workspaces.read(first.id, bob), /不存在/);
  assert.throws(() => workspaces.read(first.id, admin), /不存在/);
  assert.throws(() => workspaces.save({ name: "同名项目" }, undefined, alice), /已存在/);
  assert.throws(() => workspaces.save({ name: "越权" }, first.id, bob), /不存在/);
  const file = workspaces.configFile(first.id);
  updateConfig(file, (config) => ({ ...config, tapd: { session: { cookie_header: "private-cookie" } } }));
  assert.equal(readOptional(file).tapd.session.cookie_header, "private-cookie");
  const serialized = database.handle.prepare("SELECT data FROM workspace_settings WHERE workspace_id=?").get(first.id).data;
  assert.equal(serialized.includes("private-cookie"), false);
  assert.equal(fs.existsSync(file), false);
  const settingsFile = path.join(root, "system-settings.json");
  writeConfig(settingsFile, { worktreeBasePath: root });
  const effective = executionConfig(readOptional(file), file);
  assert.equal(effective.codex.worktree_root, path.join(root, "u-" + alice.id, "w-" + first.id.slice(0, 8)));
  database.close();
  reopened = await initializeDatabase(root);
  assert.equal(readOptional(file).tapd.session.cookie_header, "private-cookie");
  assert.equal(readOptional(settingsFile).worktreeBasePath, root);
  assert.deepEqual((await databaseStatus(root)).pending, []);
});

test("database documents, run projections and binary attachments remain authoritative without disk files", async (t) => {
  let database;
  t.after(() => database?.close());
  const root = temporary(t);
  database = await initializeDatabase(root);
  const actor = addUser(database, "member");
  const workspaces = new WorkspaceManager({ directory: path.join(root, "workspaces") });
  const workspace = workspaces.save({ name: "存储测试" }, undefined, actor);
  const directory = path.join(root, "workspaces", workspace.id, "runs", "1-2");
  const file = path.join(directory, "run.json");
  writeConfig(file, { source: { channel: "tapd", scope: "1", id: "2" }, session_id: "session-id", status: "running" });
  updateConfig(file, (value) => ({ ...value, status: "finished" }));
  const row = database.handle.prepare("SELECT * FROM runs").get();
  assert.equal(row.owner_user_id, actor.id);
  assert.equal(row.execution_state, "finished");
  assert.equal(row.session_id, "session-id");
  const snapshot = path.join(directory, "requirement.json");
  writeConfig(snapshot, { title: "保留资料" });
  assert.equal(database.listDocuments(directory).length, 2);
  const image = path.join(directory, "images", "1.png");
  database.putBlob(image, png, { mimeType: "image/png", expiresAt: "2030-01-01T00:00:00.000Z" });
  assert.deepEqual(database.readBlob(image).data, png);
  assert.equal(database.listBlobs(directory)[0].path, image);
  assert.equal(fs.existsSync(directory), false);
  assert.throws(() => database.readDocument(path.join(root, "..", "outside.json")), /当前数据目录/);
  assert.equal(database.deleteDocument(snapshot), true);
  assert.equal(database.readDocument(snapshot), undefined);
  assert.equal(database.deleteBlob(image), true);
});

test("versioned migrations back up existing data, preserve defaults, and fail closed on live writers or failed scripts", async (t) => {
  const root = temporary(t);
  const migrationDirectory = path.join(root, "test-migrations");
  fs.mkdirSync(migrationDirectory);
  fs.copyFileSync(path.join(__dirname, "../../src/storage/migrations/schema-v001.cjs"),
    path.join(migrationDirectory, "schema-v001.cjs"));
  let database = await initializeDatabase(root, { migrationsDirectory: migrationDirectory });
  database.close();
  fs.writeFileSync(path.join(migrationDirectory, "schema-v002.cjs"),
    'exports.up = async (knex) => { await knex.schema.createTable("upgrade_fixture", t => t.text("value")); }; exports.down = async () => {};');
  const leaseFile = path.join(root, "db", "connections", "fixture.json");
  fs.writeFileSync(leaseFile, JSON.stringify({ pid: process.pid, token: "fixture" }));
  await assert.rejects(initializeDatabase(root, { migrationsDirectory: migrationDirectory }), /运行进程/);
  fs.unlinkSync(leaseFile);
  database = await initializeDatabase(root, { migrationsDirectory: migrationDirectory });
  assert.equal(database.handle.prepare("SELECT name FROM sqlite_master WHERE name='upgrade_fixture'").get().name, "upgrade_fixture");
  database.close();
  const backups = fs.readdirSync(path.join(root, "db", "backups"));
  assert.equal(backups.length, 1);
  const backup = new BetterSqlite3(path.join(root, "db", "backups", backups[0]), { readonly: true });
  assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE name='upgrade_fixture'").get(), undefined);
  backup.close();
  fs.writeFileSync(path.join(migrationDirectory, "schema-v003.cjs"),
    'exports.up = async (knex) => { await knex.schema.createTable("rolled_back_fixture", t => t.text("value")); throw new Error("fixture upgrade failed"); }; exports.down = async () => {};');
  await assert.rejects(initializeDatabase(root, { migrationsDirectory: migrationDirectory }), /fixture upgrade failed/);
  assert.equal(databaseForPath(root), undefined);
  const check = new BetterSqlite3(path.join(root, "db", "web-coding.sqlite"), { readonly: true });
  assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name='rolled_back_fixture'").get(), undefined);
  assert.equal(check.prepare("SELECT COUNT(*) AS count FROM knex_migrations").get().count, 2);
  check.close();
});
