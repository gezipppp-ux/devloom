const { accountError } = require("./account.cjs");
const { object, text } = require("./project-issues.cjs");
const mcpScopes = require("../../shared/mcp-scopes.json");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function mcpId(value, label = "请求标识") {
  if (typeof value !== "string" || !UUID.test(value)) throw accountError(label + "必须是 UUIDv4。", 400);
  return value.toLowerCase();
}
function tokenInput(input) {
  object(input, ["name", "expiresInDays", "scopes", "allProjects", "projectIds"]);
  const name = text(input.name, "Token 名称", 100, { required: true });
  if (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 365)
    throw accountError("有效期必须为 1–365 天。", 400);
  if (!Array.isArray(input.scopes) || !input.scopes.includes("read") || new Set(input.scopes).size !== input.scopes.length ||
      input.scopes.some(scope => !mcpScopes.some(item => item.id === scope))) throw accountError("请选择有效的 MCP 权限，读取权限必选。", 400);
  if (typeof input.allProjects !== "boolean" || !Array.isArray(input.projectIds) || input.projectIds.length > 100 ||
      new Set(input.projectIds).size !== input.projectIds.length || (input.allProjects && input.projectIds.length) ||
      (!input.allProjects && !input.projectIds.length)) throw accountError("请选择全部可访问项目或至少一个指定项目。", 400);
  return { name, expiresInDays: input.expiresInDays, scopes: input.scopes, allProjects: input.allProjects,
    projectIds: input.projectIds.map(id => mcpId(id, "项目 ID")) };
}
function assertMcpScope(token, scope, projectId) {
  if (!token.scopes.includes(scope)) throw accountError("Token 未授权此操作：" + scope, 403, "MCP_SCOPE_REQUIRED");
  if (projectId && !token.allProjects && !token.projectIds.includes(projectId))
    throw accountError("Token 未授权此项目。", 403, "MCP_PROJECT_DENIED");
}
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  return value;
}
module.exports = { mcpScopes, mcpId, tokenInput, assertMcpScope, canonicalJson };
