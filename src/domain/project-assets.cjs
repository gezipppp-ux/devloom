const { accountError } = require("./account.cjs");
const { object, text, revision, identifier, identifiers, choice } = require("./project-issues.cjs");

const ASSET_TYPES = ["note", "document", "link", "credential", "token"];
const ENVIRONMENTS = ["development", "test", "staging"];
const assetFields = ["type", "title", "content", "url", "username", "category", "tags", "environment", "ownerId", "expiresAt", "issueIds", "secret"];
function assetInput(input, current) {
  object(input, [...assetFields, ...(current ? ["revision"] : [])]);
  if (current) revision(input.revision);
  const value = current ? {} : { type: "note", title: "", content: "", url: "", username: "", category: "", tags: [], environment: "development", ownerId: null, expiresAt: null, issueIds: [] };
  for (const field of ["title", "content", "url", "username", "category"]) if (Object.hasOwn(input, field))
    value[field] = text(input[field], field === "title" ? "标题" : "资产内容", field === "content" ? 60000 : field === "url" ? 2000 : 200, { required: field === "title" });
  if (!current && !value.title) throw accountError("请填写资产标题。", 400);
  if (Object.hasOwn(input, "type")) value.type = choice(input.type, ASSET_TYPES, "资产类型");
  if (Object.hasOwn(input, "environment")) value.environment = choice(input.environment, ENVIRONMENTS, "非生产环境");
  if (value.url) {
    let url; try { url = new URL(value.url); } catch { throw accountError("资产链接无效。", 400); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw accountError("资产链接只支持不含凭据的 HTTP(S) 地址。", 400);
  }
  if (Object.hasOwn(input, "ownerId")) value.ownerId = input.ownerId === null ? null : identifier(input.ownerId, "负责人");
  if (Object.hasOwn(input, "issueIds")) value.issueIds = identifiers(input.issueIds, "关联事项", 100);
  if (Object.hasOwn(input, "tags")) {
    if (!Array.isArray(input.tags) || input.tags.length > 20) throw accountError("最多填写 20 个标签。", 400);
    value.tags = [...new Set(input.tags.map(tag => text(tag, "标签", 50, { required: true })))];
  }
  if (Object.hasOwn(input, "expiresAt")) {
    if (input.expiresAt !== null && (typeof input.expiresAt !== "string" || !Number.isFinite(Date.parse(input.expiresAt))))
      throw accountError("有效期需为日期文本或 null。", 400);
    value.expiresAt = input.expiresAt === null ? null : new Date(input.expiresAt);
  }
  if (Object.hasOwn(input, "secret")) {
    if (input.secret !== null && (typeof input.secret !== "string" || input.secret.length > 60000)) throw accountError("敏感值需为最多 60000 字文本或 null。", 400);
    value.secret = input.secret || null;
  }
  const type = value.type || current?.type;
  if (!["credential", "token"].includes(type) && (value.secret || (current?.secret && !Object.hasOwn(value, "secret"))))
    throw accountError("敏感值只能保存在非生产账号或 Token 资产。", 400);
  return value;
}

module.exports = { ASSET_TYPES, ENVIRONMENTS, assetInput };
