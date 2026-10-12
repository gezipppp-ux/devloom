const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { postgresFixture } = require("../support/postgres.cjs");
const { workflowDefinition } = require("../../src/domain/issue-workflows.cjs");

const migration = fs.readFileSync(path.join(__dirname, "../../prisma/migrations/20261012060000_system_workflows/migration.sql"), "utf8");
async function legacy(t, { issue = false } = {}) {
  const { admin, schema } = await postgresFixture(t);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`
    CREATE TABLE project_workflows (id TEXT PRIMARY KEY);
    CREATE TABLE project_workflow_versions (id TEXT PRIMARY KEY, workflow_id TEXT REFERENCES project_workflows(id));
    CREATE TABLE project_issues (id TEXT PRIMARY KEY, workflow_version_id TEXT NOT NULL,
      CONSTRAINT project_issues_workflow_version_fkey FOREIGN KEY (workflow_version_id) REFERENCES project_workflow_versions(id));
    CREATE TABLE departments (id TEXT PRIMARY KEY, permissions TEXT[] NOT NULL);
    CREATE TABLE project_members (id TEXT PRIMARY KEY, permissions TEXT[] NOT NULL);
    INSERT INTO project_workflows VALUES ('legacy-workflow');
    INSERT INTO project_workflow_versions VALUES ('legacy-version', 'legacy-workflow');
    INSERT INTO departments VALUES ('department', ARRAY['project.view', 'workflow.manage', 'release.manage']);
    INSERT INTO project_members VALUES ('member', ARRAY['project.view', 'workflow.manage']);
  `);
  if (issue) await admin.query("INSERT INTO project_issues VALUES ('existing-issue', 'legacy-version')");
  return admin;
}

test("system workflow migration seeds global templates and removes obsolete project grants", async t => {
  const admin = await legacy(t);
  await admin.query(migration);
  assert.equal((await admin.query("SELECT to_regclass('project_workflows') AS name")).rows[0].name, null);
  assert.equal((await admin.query("SELECT to_regclass('project_workflow_versions') AS name")).rows[0].name, null);
  assert.deepEqual((await admin.query("SELECT permissions FROM departments")).rows[0].permissions, ["project.view", "release.manage"]);
  assert.deepEqual((await admin.query("SELECT permissions FROM project_members")).rows[0].permissions, ["project.view"]);
  const workflows = (await admin.query("SELECT type, draft, published_version, definition FROM system_workflows JOIN system_workflow_versions ON workflow_id = system_workflows.id ORDER BY type")).rows;
  assert.deepEqual(workflows.map(row => row.type), ["bug", "requirement"]);
  for (const row of workflows) {
    assert.equal(row.published_version, 1);
    assert.deepEqual(row.definition, row.draft);
    workflowDefinition(row.definition, { publish: true });
  }
  await admin.query("INSERT INTO project_issues VALUES ('new-issue', 'system-bug-v1')");
  await assert.rejects(admin.query("INSERT INTO project_issues VALUES ('bad-issue', 'legacy-version')"), { code: "23503" });
});

test("system workflow migration rejects existing issues without altering their data or grants", async t => {
  const admin = await legacy(t, { issue: true });
  await assert.rejects(admin.query(migration), /existing issues were not modified/);
  await admin.query("ROLLBACK");
  assert.deepEqual((await admin.query("SELECT * FROM project_issues")).rows, [{ id: "existing-issue", workflow_version_id: "legacy-version" }]);
  assert.equal((await admin.query("SELECT count(*)::int AS count FROM project_workflow_versions")).rows[0].count, 1);
  assert.deepEqual((await admin.query("SELECT permissions FROM project_members")).rows[0].permissions, ["project.view", "workflow.manage"]);
  assert.equal((await admin.query("SELECT to_regclass('system_workflows') AS name")).rows[0].name, null);
});
