const { validateWorkspaceIcon } = require("./workspace-icon.cjs");

const WORKSPACE_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function validateWorkspaceId(id) {
  if (typeof id !== "string" || !WORKSPACE_ID.test(id))
    throw new Error("无效的工作区标识。");
  return id;
}

function validateWorkspaceInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["name", "icon"].includes(key)) ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.trim().length > 80 ||
    /[\r\n\0]/.test(input.name)
  )
    throw new Error("工作区名称必填，最多 80 字。");
  return {
    name: input.name.trim(),
    ...(input.icon === undefined ? {} : { icon: validateWorkspaceIcon(input.icon) }),
  };
}

module.exports = { WORKSPACE_ID, validateWorkspaceId, validateWorkspaceInput };
