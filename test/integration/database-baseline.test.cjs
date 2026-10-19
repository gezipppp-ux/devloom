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

test("workflow responsibility migration refuses existing business data and preserves the old schema", async t => {
  const { admin, schema } = await postgresFixture(t);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query('CREATE TABLE "_prisma_migrations" (migration_name TEXT, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ)');
  for (const row of readPostgresMigrations()) {
    if (row.name === "20261014200000_workflow_responsibilities") break;
    await admin.query(fs.readFileSync(path.join(root, "prisma/migrations", row.name, "migration.sql"), "utf8"));
  }
  await admin.query(`UPDATE system_workflows SET revision = 2 WHERE type = 'bug'`);
  const before = (await admin.query('SELECT * FROM system_workflows ORDER BY type')).rows;
  const sql = fs.readFileSync(path.join(root, "prisma/migrations/20261014200000_workflow_responsibilities/migration.sql"), "utf8");
  await assert.rejects(admin.query(sql), /fresh issue and delivery data/);
  await admin.query("ROLLBACK");
  assert.deepEqual((await admin.query('SELECT * FROM system_workflows ORDER BY type')).rows, before);
  assert.equal((await admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'project_issues' AND column_name = 'participant_ids'", [schema])).rowCount, 1);
  assert.equal((await admin.query("SELECT to_regclass('work_actions') AS name")).rows[0].name, null);
  await admin.query(`UPDATE system_workflows SET revision = 1;
    INSERT INTO users (id, username, display_name, password_hash, updated_at) VALUES ('owner', 'owner', 'Owner', 'unused', CURRENT_TIMESTAMP);
    INSERT INTO projects (id, name, directory_name, directory_key, owner_user_id, remote_url, updated_at) VALUES ('project', 'Project', 'project', 'project', 'owner', 'https://example.test/repo.git', CURRENT_TIMESTAMP);
    INSERT INTO project_issues (id, project_id, number, type, title, status, workflow_version_id, created_by_id, updated_by_id, updated_at)
      SELECT 'issue', 'project', 1, 'bug', 'Retained issue', 'pending', v.id, 'owner', 'owner', CURRENT_TIMESTAMP FROM system_workflow_versions v JOIN system_workflows w ON w.id = v.workflow_id WHERE w.type = 'bug' LIMIT 1`);
  const issues = (await admin.query('SELECT * FROM project_issues')).rows;
  await assert.rejects(admin.query(sql), /fresh issue and delivery data/);
  await admin.query("ROLLBACK");
  assert.deepEqual((await admin.query('SELECT * FROM project_issues')).rows, issues);
});

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

test("setup credential removal preserves initialization progress and operation records", async t => {
  const { admin, schema } = await postgresFixture(t);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query('CREATE TABLE "_prisma_migrations" (migration_name TEXT, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ)');
  await admin.query(migration);
  await admin.query(fs.readFileSync(path.join(root, "prisma/migrations/20261013150000_initialization_guide/migration.sql"), "utf8"));
  await admin.query(`UPDATE system_setup SET status = 'pending', initial_admin_id = 'fixture-admin', revision = 5,
    steps = '{"admin":{"status":"completed"}}', drafts = '{"directory":"/fixture/members"}',
    token_hash = 'retired-token-hash', token_expires_at = CURRENT_TIMESTAMP;
    INSERT INTO setup_operations (request_id, step, input_hash) VALUES ('fixture-request', 'directory', 'fixture-hash')`);
  const { token_hash, token_expires_at, ...progress } = (await admin.query("SELECT * FROM system_setup")).rows[0];
  assert.ok(token_hash && token_expires_at);
  const operations = (await admin.query("SELECT * FROM setup_operations")).rows;
  await admin.query(fs.readFileSync(path.join(root, "prisma/migrations/20261014160000_remove_setup_credentials/migration.sql"), "utf8"));
  assert.deepEqual((await admin.query("SELECT * FROM system_setup")).rows, [progress]);
  assert.deepEqual((await admin.query("SELECT * FROM setup_operations")).rows, operations);
});

test("fresh baseline matches Prisma, preserves database constraints and publishes both system workflows", async t => {
  const fixture = await postgresFixture(t);
  await fixture.deploy();
  await fixture.deploy();
  const database = await fixture.open();
  assert.deepEqual(readPostgresMigrations().map(row => row.name), ["20261012200000_baseline", "20261013070000_mcp_access", "20261013110000_agent_suppliers", "20261013150000_initialization_guide", "20261013180000_project_directory_names", "20261013210000_neutral_workbench", "20261014120000_project_overview", "20261014150000_administrator_permissions", "20261014160000_remove_setup_credentials", "20261014170000_project_deliveries", "20261014200000_workflow_responsibilities", "20261015120000_workflow_handoffs", "20261015150000_mcp_upload_tokens", "20261019120000_issue_deletion", "20261019150000_space_preparation_progress"]);
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
    "project_assets_nonproduction_secret_check", "project_deliverables_revision_check", "project_deliverables_source", "project_deliverables_status_check", "project_files_single_parent_check", "project_files_size_check",
    "project_issues_due_date", "project_issues_number_check", "project_releases_status_check", "projects_directory_key_check", "projects_issue_sequence_check",
    "system_setup_singleton_check", "system_setup_status_check", "system_workflows_type_check", "user_git_accounts_auth_type_check", "users_administrator_department_check", "users_role_check", "users_status_check", "work_actions_revision_check", "work_actions_status_check", "workflow_execution_events_status_check",
  ]);
  const cli = path.join(path.dirname(require.resolve("prisma/package.json")), "build/index.js");
  await promisify(execFile)(process.execPath, [cli, "migrate", "diff", "--from-config-datasource",
    "--to-schema", "prisma/schema.prisma", "--exit-code"], {
    cwd: root, env: { ...process.env, DATABASE_URL: fixture.url }, windowsHide: true, timeout: 60000,
  });
});

test("issue deletion migration preserves existing issues and only adds an empty deletion marker", async t => {
  const { admin, schema } = await postgresFixture(t);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query('CREATE TABLE "_prisma_migrations" (migration_name TEXT, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ)');
  for (const row of readPostgresMigrations()) {
    if (row.name === "20261019120000_issue_deletion") break;
    await admin.query(fs.readFileSync(path.join(root, "prisma/migrations", row.name, "migration.sql"), "utf8"));
  }
  await admin.query(`INSERT INTO users (id, username, display_name, password_hash, updated_at) VALUES ('owner', 'owner', 'Owner', 'unused', CURRENT_TIMESTAMP);
    INSERT INTO projects (id, name, directory_name, directory_key, owner_user_id, remote_url, updated_at) VALUES ('project', 'Project', 'project', 'project', 'owner', 'https://example.test/repo.git', CURRENT_TIMESTAMP);
    INSERT INTO project_issues (id, project_id, number, type, title, status, workflow_version_id, reporter_id, business_owner_id, created_by_id, updated_by_id, updated_at)
      SELECT 'issue', 'project', 1, 'requirement', 'Retained issue', v.definition->'nodes'->0->>'id', v.id, 'owner', 'owner', 'owner', 'owner', CURRENT_TIMESTAMP FROM system_workflow_versions v JOIN system_workflows w ON w.id = v.workflow_id WHERE w.type = 'requirement' LIMIT 1`);
  const before = (await admin.query('SELECT * FROM project_issues')).rows[0];
  const workflows = (await admin.query('SELECT * FROM system_workflows ORDER BY type')).rows;
  await admin.query(fs.readFileSync(path.join(root, "prisma/migrations/20261019120000_issue_deletion/migration.sql"), "utf8"));
  assert.deepEqual((await admin.query('SELECT * FROM project_issues')).rows[0], { ...before, deleted_at: null });
  assert.deepEqual((await admin.query('SELECT * FROM system_workflows ORDER BY type')).rows, workflows);
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

test("administrator permission migration clears only admin assignments and preserves project identities", async t => {
  const { admin, schema } = await postgresFixture(t);
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query('CREATE TABLE "_prisma_migrations" (migration_name TEXT, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ)');
  await admin.query(migration);
  await admin.query(`INSERT INTO departments (id, name, updated_at) VALUES ('department', 'Members', CURRENT_TIMESTAMP);
    INSERT INTO users (id, username, display_name, password_hash, role, department_id, can_create_projects, updated_at)
    VALUES ('administrator', 'admin', 'Admin', 'fixture', 'admin', 'department', true, CURRENT_TIMESTAMP),
           ('member', 'member', 'Member', 'fixture', 'member', 'department', true, CURRENT_TIMESTAMP);
    INSERT INTO projects (id, name, owner_user_id, remote_url, updated_at)
    VALUES ('project', 'Project', 'administrator', 'https://git.example/repo.git', CURRENT_TIMESTAMP);
    INSERT INTO project_members (project_id, user_id, permissions, updated_at)
    VALUES ('project', 'administrator', ARRAY['project.view'], CURRENT_TIMESTAMP),
           ('project', 'member', ARRAY['project.view'], CURRENT_TIMESTAMP)`);
  const projects = (await admin.query('SELECT * FROM projects')).rows;
  const member = (await admin.query("SELECT * FROM users WHERE id = 'member'")).rows;
  const memberGrant = (await admin.query("SELECT * FROM project_members WHERE user_id = 'member'")).rows;
  const sql = fs.readFileSync(path.join(root, 'prisma/migrations/20261014150000_administrator_permissions/migration.sql'), 'utf8');
  await admin.query(sql);
  assert.deepEqual((await admin.query('SELECT * FROM projects')).rows, projects);
  assert.deepEqual((await admin.query("SELECT * FROM users WHERE id = 'member'")).rows, member);
  assert.deepEqual((await admin.query("SELECT * FROM project_members WHERE user_id = 'member'")).rows, memberGrant);
  assert.deepEqual((await admin.query("SELECT department_id, can_create_projects FROM users WHERE id = 'administrator'")).rows, [{ department_id: null, can_create_projects: false }]);
  assert.deepEqual((await admin.query("SELECT permissions, revision FROM project_members WHERE user_id = 'administrator'")).rows, [{ permissions: [], revision: 2 }]);
  await assert.rejects(admin.query("UPDATE users SET department_id = 'department' WHERE id = 'administrator'"), /users_administrator_department_check/);
});
