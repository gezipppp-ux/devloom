const PERMISSION_MODES = require("../../shared/agent-permissions.json");

function validatePermissionMode(value = "ask") {
  if (
    typeof value !== "string" ||
    !PERMISSION_MODES.some(({ id }) => id === value)
  )
    throw new Error("无效的权限模式，请重新选择。");
  return value;
}

module.exports = { PERMISSION_MODES, validatePermissionMode };
