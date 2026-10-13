const { currentStep, required } = require("../domain/setup-state.cjs");
const { productTemplate, developerTemplate, projectPermissionCatalog } = require("../domain/project-permissions.cjs");

function presentSetupStatus(row, actor) {
  return { needsAdmin: row.status === "awaiting_admin", ...(actor ? { required: required(row) } : {}) };
}
function presentSetup(row, resources, settings) {
  const person = user => user && ({ id: user.id, username: user.username, displayName: user.displayName, departmentId: user.departmentId, status: user.status });
  return {
    version: 1, status: row.status, revision: row.revision, currentStep: currentStep(row),
    steps: row.steps, drafts: row.drafts, completedAt: row.completedAt?.toISOString() || null,
    administrator: person(resources.admin), memberStorageRoot: settings.memberStorageRoot, platform: settings.platform,
    departments: resources.departments.map(row => ({ id: row.id, name: row.name, status: row.status, permissions: row.permissions })),
    accounts: resources.accounts.map(user => ({ ...person(user), kind: row.steps.accounts?.data?.find(item => item.id === user.id)?.kind })),
    project: resources.project && { id: resources.project.id, name: resources.project.name, remoteUrl: resources.project.remoteUrl, status: resources.project.status },
    templates: [{ kind: "product", name: "产品部门", permissions: productTemplate }, { kind: "developer", name: "研发部门", permissions: developerTemplate }],
    permissions: projectPermissionCatalog,
  };
}
module.exports = { presentSetup, presentSetupStatus };
