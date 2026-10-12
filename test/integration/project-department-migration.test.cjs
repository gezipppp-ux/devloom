const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { postgresFixture } = require("../support/postgres.cjs");

const migration = fs.readFileSync(path.join(__dirname, "../../prisma/migrations/20261012010000_project_department_removal/migration.sql"), "utf8");

test("removing project departments preserves project identities and account department permissions", async t => {
  const { admin, schema } = await postgresFixture(t);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`
    CREATE TABLE departments (id TEXT PRIMARY KEY, permissions JSONB NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, department_id TEXT REFERENCES departments(id));
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, remote_url TEXT NOT NULL,
      department_id TEXT NOT NULL, owner_user_id TEXT NOT NULL REFERENCES users(id),
      CONSTRAINT projects_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id)
    );
    CREATE UNIQUE INDEX projects_department_id_name_key ON projects(department_id, name);
    INSERT INTO departments VALUES ('engineering', '["project.view","project.configure"]'), ('product', '["project.view"]');
    INSERT INTO users VALUES ('developer', 'engineering'), ('analyst', 'product');
    INSERT INTO projects VALUES ('first', 'Same name', 'https://git.example/first.git', 'engineering', 'developer'),
      ('second', 'Same name', 'https://git.example/second.git', 'product', 'analyst');
  `);
  await admin.query(migration);
  assert.deepEqual((await admin.query("SELECT * FROM projects ORDER BY id")).rows, [
    { id: "first", name: "Same name", remote_url: "https://git.example/first.git", owner_user_id: "developer" },
    { id: "second", name: "Same name", remote_url: "https://git.example/second.git", owner_user_id: "analyst" },
  ]);
  assert.equal((await admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'projects' AND column_name = 'department_id'", [schema])).rowCount, 0);
  assert.equal((await admin.query("SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = $1 AND table_name = 'projects' AND constraint_name = 'projects_department_id_fkey'", [schema])).rowCount, 0);
  assert.equal((await admin.query("SELECT to_regclass('projects_department_id_name_key') AS index")).rows[0].index, null);
  await admin.query("INSERT INTO projects VALUES ('third', 'Same name', 'https://git.example/third.git', 'developer')");
  assert.equal((await admin.query("SELECT count(*)::int AS count FROM projects WHERE name = 'Same name'")).rows[0].count, 3);
  assert.deepEqual((await admin.query("SELECT users.id, department_id, permissions FROM users JOIN departments ON departments.id = users.department_id ORDER BY users.id")).rows, [
    { id: "analyst", department_id: "product", permissions: ["project.view"] },
    { id: "developer", department_id: "engineering", permissions: ["project.view", "project.configure"] },
  ]);
  await assert.rejects(admin.query("UPDATE users SET department_id = 'missing' WHERE id = 'developer'"), { code: "23503" });
});
