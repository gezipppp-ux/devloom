const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { postgresFixture } = require("../support/postgres.cjs");

test("acceptance migration preserves source text and converts issue and task snapshots", async t => {
  const { admin, schema } = await postgresFixture(t);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`CREATE TABLE project_issues (id text, acceptance_criteria text NOT NULL DEFAULT '');
    CREATE TABLE development_tasks (id text, snapshot jsonb);
    CREATE TABLE task_issue_links (task_id text, issue_id text, snapshot jsonb);
    CREATE TABLE mcp_operations (user_id text, request_id text, result jsonb)`);
  const raw = "- [ ] First\n  - nested\n  detail\n- Second\n  ```\n- code\n  ```";
  const issue = { id: "i", acceptanceCriteria: raw };
  const snapshot = { issues: [issue], additions: [{ issues: [{ acceptanceCriteria: "single\nparagraph" }] }] };
  await admin.query("INSERT INTO project_issues VALUES ($1,$2),($3,$4),($5,$6)", ["i", raw, "p", "first\nsecond", "empty", ""]);
  await admin.query("INSERT INTO development_tasks VALUES ($1,$2::jsonb)", ["task", JSON.stringify(snapshot)]);
  await admin.query("INSERT INTO task_issue_links VALUES ($1,$2,$3::jsonb)", ["task", "i", JSON.stringify(issue)]);
  await admin.query("INSERT INTO mcp_operations VALUES ($1,$2,$3::jsonb)", ["user", "request", JSON.stringify({ issue })]);
  const sql = await readFile(path.resolve("prisma/migrations/20261028090000_acceptance_criteria_items/migration.sql"), "utf8");
  await admin.query(sql);
  const rows = (await admin.query("SELECT id, acceptance_criteria FROM project_issues")).rows;
  const criteria = rows.find(row => row.id === "i").acceptance_criteria;
  assert.deepEqual(criteria, ["First\n  - nested\n  detail", "Second\n  ```\n- code\n  ```"]);
  assert.deepEqual(rows.find(row => row.id === "p").acceptance_criteria, ["first\nsecond"]);
  assert.deepEqual(rows.find(row => row.id === "empty").acceptance_criteria, []);
  const updated = (await admin.query("SELECT snapshot FROM development_tasks")).rows[0].snapshot;
  assert.deepEqual(updated.issues[0].acceptanceCriteria, criteria);
  assert.deepEqual(updated.additions[0].issues[0].acceptanceCriteria, ["single\nparagraph"]);
  assert.equal((await admin.query("SELECT original_text FROM acceptance_criteria_migration_backup WHERE issue_id = $1", ["i"])).rows[0].original_text, raw);
  for (const table of ["acceptance_criteria_task_backup", "acceptance_criteria_task_link_backup", "acceptance_criteria_mcp_receipt_backup"])
    assert.equal((await admin.query(`SELECT count(*)::int AS count FROM "${table}"`)).rows[0].count, 1);
});
