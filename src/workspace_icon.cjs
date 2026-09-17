const catalog = require("../shared/workspace-icons.json");
const ids = new Set(catalog.map((entry) => entry.id));
function validateWorkspaceIcon(icon) {
  if (icon === null) return null;
  if (typeof icon !== "string" || !ids.has(icon))
    throw new Error("请选择图标库中的工作区图标。");
  return icon;
}
module.exports = { validateWorkspaceIcon };
