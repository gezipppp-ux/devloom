const DEFAULT_ACCOUNT_SETTINGS = Object.freeze({
  model: null,
  reasoningEffort: null,
  permissionMode: "ask",
  notificationsEnabled: true,
  grouping: "type",
});

function accountError(message, statusCode = 400, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function username(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value.trim())
  )
    throw accountError("账号需为 3–64 位字母、数字、点、短横线或下划线。");
  return value.trim().toLowerCase();
}

function password(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 256)
    throw accountError("密码需为 12–256 个字符。");
  return value;
}

function accountSettings(input, previous = DEFAULT_ACCOUNT_SETTINGS) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw accountError("个人设置格式无效。");
  const next = { ...previous };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_ACCOUNT_SETTINGS, key))
      throw accountError("包含未知的个人设置。");
    if (["model", "reasoningEffort"].includes(key)) {
      if (
        value !== null &&
        (typeof value !== "string" || !value.trim() || value.length > 160)
      )
        throw accountError("模型或思考强度无效。");
      next[key] = value === null ? null : value.trim();
    } else if (key === "permissionMode") {
      if (!["ask", "auto", "full"].includes(value))
        throw accountError("权限模式无效。");
      next[key] = value;
    } else if (key === "grouping") {
      if (!["type", "progress", "none"].includes(value))
        throw accountError("分组方式无效。");
      next[key] = value;
    } else {
      if (typeof value !== "boolean")
        throw accountError("通知开关必须为布尔值。");
      next[key] = value;
    }
  }
  return next;
}

function validateAccountCreation(input, { initial = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["username", "password", "role"].includes(key)))
    throw accountError("包含未知账号字段。");
  const role = initial ? "admin" : input.role || "member";
  if (!["admin", "member"].includes(role)) throw accountError("账号角色无效。");
  return { username: username(input.username), password: password(input.password), role };
}

function validateAccountUpdate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["role", "status", "password"].includes(key)))
    throw accountError("包含未知账号字段。");
  if (input.role !== undefined && !["admin", "member"].includes(input.role))
    throw accountError("账号角色无效。");
  if (input.status !== undefined && !["active", "disabled"].includes(input.status))
    throw accountError("账号状态无效。");
  if (input.password !== undefined) password(input.password);
  return { ...input };
}

function validateAccountPreferences(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Array.isArray(input.unreadRunKeys) || input.unreadRunKeys.length > 5000 ||
      input.unreadRunKeys.some((key) => typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(key)))
    throw accountError("未读任务列表无效。");
  return { unreadRunKeys: [...new Set(input.unreadRunKeys)] };
}

module.exports = {
  accountError,
  username,
  password,
  accountSettings,
  validateAccountCreation,
  validateAccountUpdate,
  validateAccountPreferences,
  DEFAULT_ACCOUNT_SETTINGS,
};
