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

module.exports = { validateBaseBranch };
