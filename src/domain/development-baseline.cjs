const { accountError } = require("./account.cjs");

function validateBaseBranch(value, { allowEmpty = false } = {}) {
  if (allowEmpty && value === "") return "";
  if (typeof value !== "string" || !value || value.length > 200 || value === "HEAD" || value === "@" ||
      /^(?:refs|origin)\//.test(value) || /^[0-9a-f]{7,64}$/i.test(value) ||
      /[\s\x00-\x1f\x7f~^:?*\[\\]/.test(value) || value.includes("..") || value.includes("@{") ||
      value.startsWith("-") || value.endsWith(".") || value.split("/").some(part => !part || part.startsWith(".") || part.endsWith(".lock")))
    throw accountError("开发基线需为有效的远端短分支名，例如 main 或 release/1.0。", 400);
  return value;
}

function resolveBaseBranch(issues, projectBranch, explicitBranch) {
  if (explicitBranch !== undefined) return validateBaseBranch(explicitBranch);
  const branches = issues.map(issue => issue.baseBranch || projectBranch || "");
  if (branches.some(branch => !branch)) throw accountError("请配置项目或事项的开发基线，或为本次开发明确选择分支。", 400);
  if (new Set(branches).size !== 1) throw accountError("所选事项的开发基线不同，请为本次开发明确选择分支。", 400);
  return validateBaseBranch(branches[0]);
}

module.exports = { validateBaseBranch, resolveBaseBranch };
