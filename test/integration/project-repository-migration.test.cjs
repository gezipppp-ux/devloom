const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { postgresFixture } = require("../support/postgres.cjs");

const migration = fs.readFileSync(path.join(__dirname, "../../prisma/migrations/20261012000000_project_repository/migration.sql"), "utf8");

async function legacyProjects(t) {
  const fixture = await postgresFixture(t);
  await fixture.admin.query(`SET search_path TO "${fixture.schema}"`);
  await fixture.admin.query(`
    CREATE TABLE repositories (id TEXT PRIMARY KEY, remote_url TEXT NOT NULL);
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, repository_id TEXT NOT NULL,
      CONSTRAINT projects_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id)
    );
    INSERT INTO repositories VALUES
      ('shared', 'https://git.example/shared.git'),
      ('separate', 'git@git.example:team/separate.git'),
      ('unused', 'https://git.example/unused.git');
    INSERT INTO projects VALUES ('first', 'First project', 'shared'),
      ('second', 'Second project', 'shared'), ('third', 'Third project', 'separate');
  `);
  return fixture;
}

test("project repository migration preserves existing projects and copies shared repository URLs", async t => {
  const { admin, schema } = await legacyProjects(t);
  await admin.query(migration);
  assert.deepEqual((await admin.query("SELECT * FROM projects ORDER BY id")).rows, [
    { id: "first", name: "First project", remote_url: "https://git.example/shared.git" },
    { id: "second", name: "Second project", remote_url: "https://git.example/shared.git" },
    { id: "third", name: "Third project", remote_url: "git@git.example:team/separate.git" },
  ]);
  const columns = (await admin.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'projects'", [schema])).rows;
  assert.equal(columns.some(column => column.column_name === "repository_id"), false);
  assert.equal(columns.find(column => column.column_name === "remote_url").is_nullable, "NO");
  assert.equal((await admin.query("SELECT to_regclass('repositories') AS catalog")).rows[0].catalog, null);
  assert.equal((await admin.query("SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = $1 AND table_name = 'projects' AND constraint_type = 'FOREIGN KEY'", [schema])).rowCount, 0);
  await assert.rejects(admin.query("INSERT INTO projects (id, name) VALUES ('missing', 'Missing URL')"), { code: "23502" });
});

test("project repository migration rolls back schema and records when the final catalog drop fails", async t => {
  const { admin, schema } = await legacyProjects(t);
  await admin.query("CREATE VIEW repository_dependency AS SELECT id FROM repositories");
  await assert.rejects(admin.query(migration), { code: "2BP01" });
  await admin.query("ROLLBACK");
  assert.equal((await admin.query("SELECT count(*)::int AS count FROM repositories")).rows[0].count, 3);
  assert.deepEqual((await admin.query("SELECT * FROM projects ORDER BY id")).rows, [
    { id: "first", name: "First project", repository_id: "shared" },
    { id: "second", name: "Second project", repository_id: "shared" },
    { id: "third", name: "Third project", repository_id: "separate" },
  ]);
  assert.equal((await admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'projects' AND column_name = 'remote_url'", [schema])).rowCount, 0);
  await assert.rejects(admin.query("INSERT INTO projects VALUES ('invalid', 'Invalid repository', 'missing')"), { code: "23503" });
});
