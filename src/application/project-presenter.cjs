const { storedPromptOverrides } = require("../domain/prompt-templates.cjs");
const { projectContextPermissions, grantableProjectPermissions } = require("../domain/project-permissions.cjs");
function dates(row) { return { createdAt: row.createdAt?.toISOString(), updatedAt: row.updatedAt?.toISOString() }; }
function presentDepartment(row) { return { id: row.id, name: row.name, status: row.status, permissions: row.permissions, revision: row.revision, ...dates(row) }; }
function presentProject(row, permissions = []) {
  const settings = row.settings || {};
  return { id: row.id, name: row.name, description: row.description, ownerUserId: row.ownerUserId,
    remoteUrl: row.remoteUrl, repositoryEditable: row._count?.spaces === 0, status: row.status, revision: row.revision,
    settings: permissions.includes("project.configure") ? { initCommands: settings.initCommands || [], prompts: storedPromptOverrides(settings.prompts) } : undefined,
    ...dates(row) };
}
function presentMember(row) { if (!row) return null; return { projectId: row.projectId, userId: row.userId, status: row.status, permissions: row.permissions, revision: row.revision,
  ...(row.user ? { username: row.user.username, displayName: row.user.displayName, departmentId: row.user.departmentId, departmentName: row.user.department?.name || "", userStatus: row.user.status, departmentPermissions: row.user.department?.status === "active" ? row.user.department.permissions : [],
    administratorAccess: row.user.status === "active" && row.user.role === "admin", grantablePermissions: grantableProjectPermissions(row.user),
    effectivePermissions: projectContextPermissions({ user: row.user, department: row.user.department, membership: row, project: { id: row.projectId } }) } : {}) }; }
function presentSpace(row) { return row ? { id: row.id, projectId: row.projectId, userId: row.userId, workspaceId: row.workspaceId, gitAccountId: row.gitAccountId, status: row.status, error: row.error, revision: row.revision, requestId: row.requestId, ...dates(row) } : null; }
module.exports = { presentDepartment, presentProject, presentMember, presentSpace };
