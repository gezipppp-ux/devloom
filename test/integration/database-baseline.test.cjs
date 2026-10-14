const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { test } = require("node:test");
const { postgresFixture } = require("../support/postgres.cjs");
const { workflowDefinition, defaultWorkflow } = require("../../src/domain/issue-workflows.cjs");
const { readPostgresMigrations } = require("../../src/storage/postgres-migrations.cjs");

const root = path.resolve(__dirname, "../..");
const migration = fs.readFileSync(path.join(root, "prisma/migrations/20261012200000_baseline/migration.sql"), "utf8");

test("repository directory migration rejects historical projects without altering records", async t => {
  const { admin, schema } = await postgresFixture(t);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query('CREATE TABLE "_prisma_migrations" (migration_name TEXT, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ)');
  await admin.query(migration);
  await admin.query(`INSERT INTO users (id, username, display_name, password_hash, updated_at)
    VALUES ('old-user', 'admin', 'Admin', 'fixture', CURRENT_TIMESTAMP);
    INSERT INTO projects (id, name, owner_user_id, remote_url, updated_at)
    VALUES ('old-project', 'Old project', 'old-user', 'https://git.example/repo.git', CURRENT_TIMESTAMP)`);
  const before = (await admin.query('SELECT * FROM projects')).rows;
  const directoryMigration = fs.readFileSync(path.join(root, "prisma/migrations/20261013180000_project_directory_names/migration.sql"), "utf8");
  await assert.rejects(admin.query(directoryMigration), /fresh project data/);
  await admin.query("ROLLBACK");
  assert.deepEqual((await admin.query('SELECT * FROM projects')).rows, before);
  assert.equal((await admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'projects' AND column_name = 'directory_name'", [schema])).rowCount, 0);
});

test("setup migration classifies empty, admin-only and existing business installations exactly once", async t => {
  const setupMigration = fs.readFileSync(path.join(root, "prisma/migrations/20261013150000_initialization_guide/migration.sql"), "utf8");
  for (const scenario of ["empty", "admin", "department", "member"]) {
    const { admin, schema } = await postgresFixture(t);
    await admin.query(`SET search_path TO "${schema}"`);
    await admin.query('CREATE TABLE "_prisma_migrations" (migration_name TEXT, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ)');
    await admin.query(migration);
    if (scenario !== "empty") await admin.query(`INSERT INTO users (id, username, display_name, password_hash, role, updated_at)
      VALUES ('fixture-user', 'fixture', 'Fixture', 'fixture-hash', $1, CURRENT_TIMESTAMP)`, [scenario === "member" ? "member" : "admin"]);
    if (scenario === "department") await admin.query(`INSERT INTO departments (id, name, updated_at) VALUES ('fixture-department', '已有部门', CURRENT_TIMESTAMP)`);
    await admin.query(setupMigration);
    const row = (await admin.query("SELECT * FROM system_setup")).rows[0];
    assert.equal(row.status, { empty: "awaiting_admin", admin: "pending", department: "not_required", member: "not_required" }[scenario]);
    await admin.query("DELETE FROM users; DELETE FROM departments");
    assert.equal((await admin.query("SELECT status FROM system_setup")).rows[0].status, row.status, "deletion never reopens initialization");
  }
});

test("fresh baseline matches Prisma, preserves database constraints and publishes both system workflows", async t => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  await fixture.deploy();
  const database = await fixture.open();
  assert.deepEqual(readPostgresMigrations().map(row => row.name), ["20261012200000_baseline", "20261013070000_mcp_access", "20261013110000_agent_suppliers", "20261013150000_initialization_guide", "20261013180000_project_directory_names", "20261013210000_neutral_workbench"]);
  const workflows = await database.client.systemWorkflow.findMany({ include: { versions: true }, orderBy: { type: "asc" } });
  assert.deepEqual(workflows.map(row => row.type), ["bug", "requirement"]);
  for (const row of workflows) {
    assert.equal(row.publishedVersion, 1);
    assert.equal(row.versions.length, 1);
    assert.deepEqual(row.versions[0].definition, row.draft);
    assert.deepEqual(row.draft, defaultWorkflow(row.type));
    workflowDefinition(row.draft, { publish: true });
  }
  const checks = await fixture.admin.query(`SELECT conname FROM pg_constraint
    WHERE connamespace = $1::regnamespace AND contype = 'c' ORDER BY conname`, [fixture.schema]);
  assert.deepEqual(checks.rows.map(row => row.conname), [
    "agent_supplier_selections_revision_check", "agent_supplier_uses_status_check", "agent_suppliers_mode_check", "agent_suppliers_revision_check",
    "issue_deliverables_revision_check", "issue_deliverables_status_check",
    "project_assets_nonproduction_secret_check", "project_files_single_parent_check", "project_files_size_check",
    "project_issues_due_date", "project_issues_number_check", "project_releases_status_check", "projects_directory_key_check", "projects_issue_sequence_check",
    "system_setup_singleton_check", "system_setup_status_check", "system_workflows_type_check", "user_git_accounts_auth_type_check", "users_role_check", "users_status_check",
  ]);
  const cli = path.join(path.dirname(require.resolve("prisma/package.json")), "build/index.js");
  await promisify(execFile)(process.execPath, [cli, "migrate", "diff", "--from-config-datasource",
    "--to-schema", "prisma/schema.prisma", "--exit-code"], {
    cwd: root, env: { ...process.env, DATABASE_URL: fixture.url }, windowsHide: true, timeout: 60000,
  });
});

test("previous database histories reject startup and deployment without changing business data", async t => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  const database = await fixture.open();
  const user = await database.client.user.create({ data: { username: "retained", displayName: "保留记录", passwordHash: "fixture" } });
  await fixture.admin.query(`UPDATE "${fixture.schema}"."_prisma_migrations" SET migration_name = 'previous_baseline'`);
  await assert.rejects(fixture.open(), /旧数据不兼容/);
  await fixture.admin.query(`SET search_path TO "${fixture.schema}"`);
  await assert.rejects(fixture.admin.query(migration), /Unsupported database history/);
  await fixture.admin.query("ROLLBACK");
  await assert.rejects(fixture.deploy(), { code: 1 });
  assert.deepEqual(await database.client.user.findUnique({ where: { id: user.id } }), user);
  assert.equal(await database.client.systemWorkflow.count(), 2);
});

test("baseline DDL rolls back entirely on a late table conflict", async t => {
  const { admin, schema } = await postgresFixture(t);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`CREATE TABLE "_prisma_migrations" (migration_name TEXT, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ);
    CREATE TABLE system_workflow_versions (sentinel TEXT);
    INSERT INTO system_workflow_versions VALUES ('untouched');`);
  await assert.rejects(admin.query(migration), { code: "42P07" });
  await admin.query("ROLLBACK");
  assert.equal((await admin.query("SELECT to_regclass('users') AS name")).rows[0].name, null);
  assert.deepEqual((await admin.query("SELECT * FROM system_workflow_versions")).rows, [{ sentinel: "untouched" }]);
});
