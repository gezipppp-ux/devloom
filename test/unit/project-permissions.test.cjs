const assert = require("node:assert/strict");
const { test } = require("node:test");
const { projectPermissionCatalog, validatePermissions, effectivePermissions, assertProjectPermission,
  canCreateProject, productTemplate, developerTemplate } = require("../../src/domain/project-permissions.cjs");

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

test("system administrators and project owners do not bypass project permissions", () => {
  const user = { id: "u1", role: "admin", status: "active", departmentId: "d1" };
  const department = { id: "d1", name: "研发部", status: "active", permissions: productTemplate };
  const project = { id: "p1", ownerUserId: "u1", status: "active" };
  const membership = { projectId: "p1", userId: "u1", status: "active", permissions: productTemplate };
  const context = { user, department, project, membership };
  assert.doesNotThrow(() => assertProjectPermission(context, "issue.edit"));
  assert.throws(() => assertProjectPermission(context, "session.start"), { statusCode: 403 });
  assert.throws(() => assertProjectPermission({ ...context, membership: null }, "issue.view"), { statusCode: 404 });
  assert.throws(() => assertProjectPermission({ ...context, membership: { ...membership, userId: "u2" } }, "issue.view"), { statusCode: 404 });
  assert.throws(() => assertProjectPermission({ ...context, department: { ...department, id: "d2" } }, "issue.view"), { statusCode: 403 });
  assert.throws(() => assertProjectPermission({ ...context, user: { ...user, status: "disabled" } }, "issue.view"), { statusCode: 401 });
  assert.throws(() => assertProjectPermission({ ...context, project: { ...project, status: "archived" } }, "issue.edit"), { code: "PROJECT_ARCHIVED" });
  assert.doesNotThrow(() => assertProjectPermission({ ...context, project: { ...project, status: "archived" } }, "issue.view"));
});

test("project creation needs both individual eligibility and department permission", () => {
  const user = { id: "u1", role: "member", status: "active", departmentId: "d1", canCreateProjects: true };
  const department = { id: "d1", status: "active", permissions: ["project.create", "project.view", "project.configure", "project.members.manage"] };
  assert.equal(canCreateProject(user, department), true);
  assert.equal(canCreateProject({ ...user, canCreateProjects: false }, department), false);
  assert.equal(canCreateProject(user, { ...department, permissions: [] }), false);
  assert.equal(canCreateProject(user, { ...department, id: "d2" }), false);
  assert.equal(canCreateProject({ ...user, role: "admin" }, null), false);
  assert.equal(canCreateProject({ ...user, role: "admin", status: "disabled" }, department), false);
});


test("administrator creation eligibility requires the initial owner permissions", () => {
  const user = { id: "u1", role: "admin", status: "active", departmentId: "d1" };
  const department = { id: "d1", status: "active", permissions: ["project.view", "project.configure", "project.members.manage"] };
  assert.equal(canCreateProject(user, department), true);
  for (const id of department.permissions) assert.equal(canCreateProject(user, { ...department, permissions: department.permissions.filter(key => key !== id) }), false);
  assert.equal(canCreateProject(user, { ...department, status: "disabled" }), false);
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
