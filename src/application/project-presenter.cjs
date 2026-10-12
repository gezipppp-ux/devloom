const { effectivePermissions } = require("../domain/project-permissions.cjs");
function dates(row) { return { createdAt: row.createdAt?.toISOString(), updatedAt: row.updatedAt?.toISOString() }; }
function presentDepartment(row) { return { id: row.id, name: row.name, status: row.status, permissions: row.permissions, revision: row.revision, ...dates(row) }; }
function presentRepository(row) { return { id: row.id, name: row.name, remoteUrl: row.remoteUrl, description: row.description, status: row.status, revision: row.revision, ...dates(row) }; }
function presentProject(row, permissions = []) {
  const settings = row.settings || {};
  return { id: row.id, name: row.name, description: row.description, departmentId: row.departmentId, ownerUserId: row.ownerUserId,
    repositoryId: row.repositoryId, status: row.status, revision: row.revision,
    department: row.department ? { id: row.department.id, name: row.department.name } : undefined,
    repository: row.repository ? presentRepository(row.repository) : undefined,
    settings: permissions.includes("project.configure") ? { baseRef: settings.baseRef || "HEAD", initCommands: settings.initCommands || [], prompts: settings.prompts || {},
      tapd: { workspaceId: settings.tapd?.session?.request_body?.group_id || "", hasCookie: Boolean(settings.tapd?.session?.cookie_header), imageHosts: settings.tapd?.image_hosts || [] } } : undefined,
    ...dates(row) };
}
function presentMember(row) { return { projectId: row.projectId, userId: row.userId, status: row.status, permissions: row.permissions, revision: row.revision,
  ...(row.user ? { username: row.user.username, departmentId: row.user.departmentId, departmentName: row.user.department?.name || "", userStatus: row.user.status, departmentPermissions: row.user.department?.status === "active" ? row.user.department.permissions : [],
    effectivePermissions: row.status === "active" && row.user.status === "active" && row.user.department?.status === "active" ? effectivePermissions(row.user.department.permissions, row.permissions) : [] } : {}) }; }
function presentSpace(row) { return row ? { id: row.id, projectId: row.projectId, userId: row.userId, workspaceId: row.workspaceId, gitAccountId: row.gitAccountId, status: row.status, error: row.error, revision: row.revision, requestId: row.requestId, ...dates(row) } : null; }
module.exports = { presentDepartment, presentRepository, presentProject, presentMember, presentSpace };
