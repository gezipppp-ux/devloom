const definitions = require("../../shared/project-permissions.json");
const { accountError } = require("./account.cjs");

const catalog = Object.freeze(definitions.map(entry => Object.freeze({
  ...entry, scope: entry.scope || "project", requires: Object.freeze([...entry.requires]),
})));
const byId = new Map(catalog.map(entry => [entry.id, entry]));
const administratorPermissions = Object.freeze(["project.view", "project.configure", "project.members.manage", "project.archive", "issue.view", "issue.create", "issue.edit", "issue.assign", "issue.transition", "issue.accept", "release.manage", "collaboration.view", "comment.create", "deliverable.create", "asset.view", "asset.edit"]);

function grantableProjectPermissions(user) {
  if (user?.status !== "active") return [];
  const ceiling = user.department?.status === "active" && user.department.id === user.departmentId ? user.department.permissions : [];
  const selected = new Set([...effectivePermissions(ceiling, ceiling), ...(user.role === "admin" ? administratorPermissions : [])]);
  return catalog.filter(entry => selected.has(entry.id)).map(entry => entry.id);
}

function projectContextPermissions({ user, department, membership, project }) {
  if (user?.status !== "active" || !project) return [];
  const memberPermissions = membership?.status === "active" && membership.userId === user.id && membership.projectId === project.id &&
    department?.status === "active" && department.id === user.departmentId
    ? effectivePermissions(department.permissions, membership.permissions) : [];
  // Compute the membership dependency closure before adding the independent administrator baseline.
  const selected = new Set([...memberPermissions, ...(user.role === "admin" ? administratorPermissions : [])]);
  return catalog.filter(entry => selected.has(entry.id)).map(entry => entry.id);
}

function validatePermissions(input, { scope = "department", ceiling } = {}) {
  if (!Array.isArray(input) || input.length > catalog.length ||
      input.some(id => typeof id !== "string" || !byId.has(id)))
    throw accountError("权限列表包含未知或无效的权限。", 400, "INVALID_PERMISSIONS");
  const selected = new Set(input);
  if (selected.size !== input.length)
    throw accountError("权限列表不能重复。", 400, "INVALID_PERMISSIONS");
  for (const id of selected) {
    const entry = byId.get(id);
    if (scope === "project" && entry.scope !== "project")
      throw accountError("创建项目资格不能通过项目成员权限授予。", 400, "INVALID_PERMISSIONS");
    if (ceiling && !ceiling.includes(id))
      throw accountError(`权限「${entry.label}」超出该成员的部门权限上限。`, 400, "DEPARTMENT_PERMISSION_LIMIT");
    const missing = entry.requires.find(required => !selected.has(required));
    if (missing)
      throw accountError(`「${entry.label}」需要同时授予「${byId.get(missing).label}」。`, 400, "PERMISSION_DEPENDENCY");
  }
  return catalog.filter(entry => selected.has(entry.id)).map(entry => entry.id);
}

// Department changes can invalidate dependencies of a previously valid grant.
// Remove those grants too; never infer capabilities from a department name.
function effectivePermissions(ceiling, grants) {
  const allowed = new Set(Array.isArray(ceiling) ? ceiling : []);
  const selected = new Set((Array.isArray(grants) ? grants : [])
    .filter(id => byId.get(id)?.scope === "project" && allowed.has(id)));
  let changed;
  do {
    changed = false;
    for (const id of selected) if (byId.get(id).requires.some(required => !selected.has(required))) {
      selected.delete(id);
      changed = true;
    }
  } while (changed);
  return catalog.filter(entry => selected.has(entry.id)).map(entry => entry.id);
}

function assertProjectPermission({ user, department, membership, project }, permission) {
  if (!byId.has(permission) || byId.get(permission).scope !== "project")
    throw accountError("未知的项目权限。", 403, "PERMISSION_DENIED");
  if (!user || user.status !== "active") throw accountError("请先登录。", 401, "AUTH_REQUIRED");
  if (project && user.role === "admin" && administratorPermissions.includes(permission)) {
    if (project.status === "archived" && !permission.endsWith(".view"))
      throw accountError("项目已归档，不能继续写入或启动开发。", 409, "PROJECT_ARCHIVED");
    return;
  }
  if (!project || !membership || membership.userId !== user.id ||
      membership.projectId !== project.id || membership.status !== "active")
    throw accountError("项目不存在或未分配给当前账号。", 404, "PROJECT_NOT_FOUND");
  if (!department || department.id !== user.departmentId || department.status !== "active" ||
      !effectivePermissions(department.permissions, membership.permissions).includes(permission))
    throw accountError("当前账号没有此项目操作权限。", 403, "PERMISSION_DENIED");
  // Archive keeps reads available, while restore is a separate project operation.
  if (project.status === "archived" && !permission.endsWith(".view") && permission !== "session.stop")
    throw accountError("项目已归档，不能继续写入或启动开发。", 409, "PROJECT_ARCHIVED");
}

const ownerPermissions = Object.freeze(["project.view", "project.configure", "project.members.manage"]);
function projectCreationReadiness(user, department) {
  const reasons = [];
  if (user?.status === "active" && user.role === "admin") return { eligible: true, reasons };
  if (user?.status !== "active") reasons.push("账号未启用。");
  if (!department || department.id !== user?.departmentId || department.status !== "active") reasons.push("请先在账号管理中为本人分配有效部门。");
  else {
    const missing = ownerPermissions.filter(id => !department.permissions.includes(id));
    if (missing.length) reasons.push(`所属部门需开放：${missing.map(id => byId.get(id).label).join("、")}。`);
    if (user?.role !== "admin" && !department.permissions.includes("project.create")) reasons.push("所属部门尚未开放创建项目资格。");
  }
  if (user?.role !== "admin" && !user?.canCreateProjects) reasons.push("请联系管理员授予个人创建项目资格。");
  return { eligible: reasons.length === 0, reasons };
}
function canCreateProject(user, department) { return projectCreationReadiness(user, department).eligible; }

const productTemplate = Object.freeze(catalog.filter(entry =>
  ["需求与 Bug", "协作", "发布版本"].includes(entry.group) || ["project.view", "asset.view"].includes(entry.id),
).map(entry => entry.id));
const developerTemplate = Object.freeze(catalog.filter(entry =>
  entry.id.startsWith("code.") || entry.id.startsWith("session.") || ["project.view", "issue.view", "issue.transition",
    "collaboration.view", "comment.create", "deliverable.create"].includes(entry.id),
).map(entry => entry.id));

module.exports = { projectPermissionCatalog: catalog, validatePermissions, effectivePermissions, projectContextPermissions, administratorPermissions, grantableProjectPermissions,
  assertProjectPermission, canCreateProject, projectCreationReadiness, ownerPermissions, productTemplate, developerTemplate };
