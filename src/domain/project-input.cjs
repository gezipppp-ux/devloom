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
function projectSettings(input) {
  object(input, ["initCommands", "prompts"]);
  const value = {};
  if (input.initCommands !== undefined) value.initCommands = validateInitCommands(input.initCommands);
  if (input.prompts !== undefined) {
    object(input.prompts, Object.keys(promptTemplateCatalog));
    value.prompts = {};
    for (const [key, prompt] of Object.entries(input.prompts)) value.prompts[key] = prompt === null ? null : validatePromptTemplate(key, prompt);
  }
  return value;
}
function projectInput(input, updating = false) {
  object(input, ["name", "description", "remoteUrl", "ownerUserId", "settings", "revision"]);
  const value = {};
  if (!updating || input.name !== undefined) value.name = text(input.name, "项目名称", 80);
  if (input.description !== undefined) value.description = text(input.description, "项目说明", 8000, true);
  if (!updating || input.remoteUrl !== undefined) value.remoteUrl = remoteUrl(input.remoteUrl);
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
module.exports = { projectId: id, projectRevision: revision, departmentInput, projectInput, memberInput, prepareSpaceInput };
