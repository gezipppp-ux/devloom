const assert = require("node:assert/strict");
const { test } = require("node:test");
const { projectPermissionCatalog, validatePermissions, effectivePermissions, assertProjectPermission,
  projectContextPermissions, administratorPermissions, grantableProjectPermissions, canCreateProject, productTemplate, developerTemplate } = require("../../src/domain/project-permissions.cjs");

test("project grants enforce department ceilings, scopes and dependency closure", () => {
  const ceiling = projectPermissionCatalog.map(({ id }) => id);
  assert.deepEqual(validatePermissions(productTemplate), productTemplate);
  assert.deepEqual(validatePermissions(developerTemplate), developerTemplate);
  assert.throws(() => validatePermissions(["session.start"]), /同时授予/);
  assert.throws(() => validatePermissions(["project.view", "invented"]), /未知/);
  assert.throws(() => validatePermissions(["project.view", "project.view"]), /重复/);
  assert.throws(() => validatePermissions(ceiling, { scope: "project" }), /创建项目资格/);
  assert.throws(() => validatePermissions(developerTemplate, { scope: "project", ceiling: productTemplate }), /部门权限上限/);
  const revoked = effectivePermissions(ceiling.filter(id => id !== "code.view"), developerTemplate);
  assert.equal(revoked.some(id => /^(code|session)\./.test(id)), false);
  assert.ok(revoked.includes("issue.view"));
});

test("project creation needs both individual eligibility and department permission", () => {
  const user = { id: "u1", role: "member", status: "active", departmentId: "d1", canCreateProjects: true };
  const department = { id: "d1", status: "active", permissions: ["project.create", "project.view", "project.configure", "project.members.manage"] };
  assert.equal(canCreateProject(user, department), true);
  assert.equal(canCreateProject({ ...user, canCreateProjects: false }, department), false);
  assert.equal(canCreateProject(user, { ...department, permissions: [] }), false);
  assert.equal(canCreateProject(user, { ...department, id: "d2" }), false);
  assert.equal(canCreateProject({ ...user, role: "admin" }, null), true);
  assert.equal(canCreateProject({ ...user, role: "admin", status: "disabled" }, department), false);
});


test("administrator creation eligibility does not require department membership", () => {
  const user = { id: "u1", role: "admin", status: "active", departmentId: "d1" };
  const department = { id: "d1", status: "active", permissions: ["project.view", "project.configure", "project.members.manage"] };
  assert.equal(canCreateProject(user, department), true);
  for (const id of department.permissions) assert.equal(canCreateProject(user, { ...department, permissions: department.permissions.filter(key => key !== id) }), true);
  assert.equal(canCreateProject(user, { ...department, status: "disabled" }), true);
});

test("work-content permission combinations are dependency complete and project scoped", () => {
  const presets = require("../../shared/project-permission-presets.json");
  for (const preset of presets) {
    assert.deepEqual(new Set(validatePermissions(preset.permissions, { scope: "project" })), new Set(preset.permissions));
    assert.ok(preset.corePermissions.length > 0);
    assert.ok(preset.corePermissions.every(id => preset.permissions.includes(id)));
  }
  assert.ok(presets.find(preset => preset.id === "agent").corePermissions.includes("session.start"));
  const code = presets.find(preset => preset.id === "code");
  assert.equal(code.permissions.some(id => id.startsWith("session.")), false);
});


test("administrator baseline never repairs missing development or sensitive dependencies", () => {
  const user = { id: "u1", status: "active", role: "admin", departmentId: "d1" };
  const project = { id: "p1", status: "active" };
  for (const department of [null, { id: "d1", status: "disabled", permissions: productTemplate }]) {
    const context = { user, project, department, membership: null };
    assert.deepEqual(projectContextPermissions(context), administratorPermissions);
    for (const permission of administratorPermissions) assert.doesNotThrow(() => assertProjectPermission(context, permission));
    for (const permission of ["asset.secret.view", "code.view", "session.view"])
      assert.throws(() => assertProjectPermission(context, permission), { statusCode: 404 });
    assert.throws(() => assertProjectPermission({ ...context, project: null }, "project.view"), { statusCode: 404 });
    assert.throws(() => assertProjectPermission({ ...context, user: { ...user, role: "member" } }, "project.view"), { statusCode: 404 });
  }
  const context = { user, project: { ...project, status: "active" }, department: { id: "d1", status: "active", permissions: projectPermissionCatalog.map(entry => entry.id).filter(id => id !== "project.view") },
    membership: { projectId: "p1", userId: "u1", status: "active", permissions: projectPermissionCatalog.map(entry => entry.id) } };
  assert.deepEqual(projectContextPermissions(context), administratorPermissions);
  for (const permission of ["code.operate", "session.start", "asset.secret.view", "asset.secret.edit"])
    assert.throws(() => assertProjectPermission(context, permission), { statusCode: 403 });
});

test("administrator writes respect archived projects", () => {
  const context = { user: { id: "u", status: "active", role: "admin" }, project: { id: "p", status: "archived" } };
  for (const permission of administratorPermissions) {
    if (permission.endsWith(".view")) assert.doesNotThrow(() => assertProjectPermission(context, permission));
    else assert.throws(() => assertProjectPermission(context, permission), { code: "PROJECT_ARCHIVED" });
  }
});


test("ordinary member visibility keeps account, membership and department boundaries", () => {
  const context = { user: { id: "u1", role: "member", status: "active", departmentId: "d1" },
    department: { id: "d1", status: "active", permissions: productTemplate },
    project: { id: "p1", ownerUserId: "u1", status: "active" },
    membership: { projectId: "p1", userId: "u1", status: "active", permissions: productTemplate } };
  assert.doesNotThrow(() => assertProjectPermission(context, "issue.edit"));
  for (const membership of [null, { ...context.membership, status: "disabled" }, { ...context.membership, userId: "other" }])
    assert.throws(() => assertProjectPermission({ ...context, membership }, "issue.view"), { statusCode: 404 });
  for (const department of [null, { ...context.department, status: "disabled" }, { ...context.department, id: "other" }])
    assert.throws(() => assertProjectPermission({ ...context, department }, "issue.view"), { statusCode: 403 });
  for (const role of ["admin", "member"])
    assert.throws(() => assertProjectPermission({ ...context, user: { ...context.user, role, status: "disabled" } }, "issue.view"), { statusCode: 401 });
});


test("member permission presentation separates global access, grantable permissions and membership status", () => {
  const { presentMember } = require("../../src/application/project-presenter.cjs");
  const user = { id: "u1", role: "admin", status: "active", departmentId: null };
  const membership = { user, projectId: "p1", userId: "u1", status: "disabled", permissions: [] };
  const admin = presentMember(membership);
  assert.equal(admin.administratorAccess, true);
  assert.equal(admin.status, "disabled");
  assert.deepEqual(admin.departmentPermissions, []);
  assert.deepEqual(admin.permissions, []);
  assert.deepEqual(admin.grantablePermissions, administratorPermissions);
  assert.deepEqual(admin.effectivePermissions, administratorPermissions);
  const member = presentMember({ ...membership, user: { ...user, role: "member" } });
  assert.equal(member.administratorAccess, false);
  assert.deepEqual(member.effectivePermissions, []);
  assert.deepEqual(member.grantablePermissions, []);
  const disabled = presentMember({ ...membership, user: { ...user, status: "disabled" } });
  assert.equal(disabled.administratorAccess, false);
  assert.deepEqual(disabled.effectivePermissions, []);
  assert.deepEqual(disabled.grantablePermissions, []);
  const department = { id: "d1", status: "active", permissions: projectPermissionCatalog.map(entry => entry.id).filter(id => id !== "project.view") };
  assert.deepEqual(grantableProjectPermissions({ ...user, departmentId: "d1", department }), administratorPermissions);
  assert.deepEqual(grantableProjectPermissions({ ...user, role: "member", departmentId: "d1", department }), []);
});
