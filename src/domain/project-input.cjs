const { accountError } = require("./account.cjs");
const { remoteUrl } = require("./git-account.cjs");
const { validatePermissions } = require("./project-permissions.cjs");
const { validateInitCommands } = require("./init-commands.cjs");
const { promptTemplateCatalog, validatePromptTemplate } = require("./prompt-templates.cjs");

function object(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key)))
    throw accountError("包含未知或无效的字段。");
  return input;
}
function id(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value))
    throw accountError("资源标识无效。");
  return value;
}
function text(value, label, maximum = 200, empty = false) {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw accountError(`${label}无效。`);
  return value.trim();
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw accountError("请提供当前修订号。", 409, "REVISION_REQUIRED");
  return value;
}
function status(value) {
  if (!["active", "disabled"].includes(value)) throw accountError("状态无效。");
  return value;
}
function departmentInput(input, updating = false) {
  object(input, ["name", "permissions", "status", "revision"]);
  const value = {};
  if (!updating || input.name !== undefined) value.name = text(input.name, "部门名称", 80);
  if (!updating || input.permissions !== undefined) value.permissions = validatePermissions(input.permissions || []);
  if (input.status !== undefined) value.status = status(input.status);
  if (updating) value.revision = revision(input.revision);
  return value;
}
function repositoryInput(input, updating = false) {
  object(input, ["name", "remoteUrl", "description", "status", "revision"]);
  const value = {};
  if (!updating || input.name !== undefined) value.name = text(input.name, "仓库名称", 80);
  if (!updating || input.remoteUrl !== undefined) value.remoteUrl = remoteUrl(input.remoteUrl);
  if (input.description !== undefined) value.description = text(input.description, "仓库说明", 4000, true);
  if (input.status !== undefined) value.status = status(input.status);
  if (updating) value.revision = revision(input.revision);
  return value;
}
function projectSettings(input) {
  object(input, ["baseRef", "initCommands", "prompts", "tapd"]);
  const value = {};
  if (input.baseRef !== undefined) {
    value.baseRef = text(input.baseRef, "基准引用", 200);
    if (/[\r\n]/.test(value.baseRef)) throw accountError("基准引用无效。");
  }
  if (input.initCommands !== undefined) value.initCommands = validateInitCommands(input.initCommands);
  if (input.prompts !== undefined) {
    object(input.prompts, Object.keys(promptTemplateCatalog));
    value.prompts = {};
    for (const [key, prompt] of Object.entries(input.prompts)) value.prompts[key] = prompt === null ? null : validatePromptTemplate(key, prompt);
  }
  if (input.tapd !== undefined) {
    object(input.tapd, ["workspaceId", "cookie", "clearCookie", "imageHosts"]);
    if (!/^\d+$/.test(input.tapd.workspaceId || "")) throw accountError("TAPD 项目 ID 无效。");
    if (input.tapd.cookie !== undefined && (typeof input.tapd.cookie !== "string" || input.tapd.cookie.length > 32000 || /[\r\n\0]/.test(input.tapd.cookie))) throw accountError("TAPD Cookie 无效。");
    if (input.tapd.clearCookie !== undefined && typeof input.tapd.clearCookie !== "boolean") throw accountError("清除 Cookie 参数无效。");
    if (input.tapd.imageHosts !== undefined && (!Array.isArray(input.tapd.imageHosts) || input.tapd.imageHosts.length > 30 || input.tapd.imageHosts.some(host => typeof host !== "string" || host.length > 253 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(host)))) throw accountError("图片域名无效。");
    value.tapd = { ...input.tapd };
  }
  return value;
}
function projectInput(input, updating = false) {
  object(input, ["name", "description", "departmentId", "repositoryId", "ownerUserId", "settings", "revision"]);
  const value = {};
  if (!updating || input.name !== undefined) value.name = text(input.name, "项目名称", 80);
  if (input.description !== undefined) value.description = text(input.description, "项目说明", 8000, true);
  if (!updating || input.departmentId !== undefined) value.departmentId = id(input.departmentId);
  if (!updating || input.repositoryId !== undefined) value.repositoryId = id(input.repositoryId);
  if (input.ownerUserId !== undefined) {
    if (!updating) throw accountError("项目创建者为初始负责人。");
    value.ownerUserId = id(input.ownerUserId);
  }
  if (input.settings !== undefined) value.settings = projectSettings(input.settings);
  if (updating) value.revision = revision(input.revision);
  return value;
}
function memberInput(input, updating = false) {
  object(input, ["userId", "permissions", "status", "revision"]);
  const value = { permissions: validatePermissions(input.permissions, { scope: "project" }) };
  if (!updating) value.userId = id(input.userId);
  if (!updating && input.revision !== undefined) throw accountError("请通过已有成员接口提交修订号。");
  if (input.status !== undefined) value.status = status(input.status);
  if (updating) value.revision = revision(input.revision);
  return value;
}
function prepareSpaceInput(input) {
  object(input, ["gitAccountId", "requestId"]);
  return { gitAccountId: id(input.gitAccountId), requestId: id(input.requestId) };
}
module.exports = { projectId: id, projectRevision: revision, departmentInput, repositoryInput, projectInput, memberInput, prepareSpaceInput };
