const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Client } = require("pg");
const { PostgresDatabase } = require("../../src/storage/postgres-database.cjs");

const execute = promisify(execFile);
const root = path.resolve(__dirname, "../..");

async function postgresFixture(t) {
  const source = process.env.TEST_DATABASE_URL;
  assert.ok(source, "PostgreSQL 集成测试需要独立的 TEST_DATABASE_URL；不能使用生产 DATABASE_URL。");
  const url = new URL(source);
  const schema = `test_prisma_${randomUUID().replaceAll("-", "")}`;
  url.searchParams.delete("schema");
  const admin = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  const connections = [];
  await admin.connect();
  t.after(async () => {
    try {
      await Promise.all(connections.map((connection) => connection.close()));
      assert.match(schema, /^test_prisma_[a-f0-9]{32}$/);
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set("schema", schema);
  async function deploy() {
    const cli = path.join(path.dirname(require.resolve("prisma/package.json")), "build/index.js");
    await execute(process.execPath, [cli, "migrate", "deploy", "--config", path.join(root, "prisma.config.cjs")], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url.toString(), PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
  }
  async function open() {
    const database = new PostgresDatabase(url.toString());
    connections.push(database);
    return (await database.connect());
  }
  return { url: url.toString(), schema, admin, open, deploy, track: (database) => connections.push(database) };
}

module.exports = { postgresFixture };
