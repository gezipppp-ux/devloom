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
  if (typeof value !== "string" || value.length < 6 || value.length > 256)
    throw accountError("密码需为 6–256 个字符。");
  return value;
}

function displayName(value) {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value) ||
      !value.trim() || [...value.trim()].length > 80)
    throw accountError("显示名需为 1–80 个字符，且不能包含控制字符。");
  return value.trim();
}

function validateAccountProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => key !== "displayName"))
    throw accountError("个人资料仅支持修改显示名。");
  return { displayName: displayName(input.displayName) };
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
      Object.keys(input).some((key) => !["username", "displayName", "password", "role", "departmentId", "canCreateProjects"].includes(key)))
    throw accountError("包含未知账号字段。");
  const role = initial ? "admin" : input.role || "member";
  if (!["admin", "member"].includes(role)) throw accountError("账号角色无效。");
  if (role !== "admin") departmentId(input.departmentId);
  if (input.canCreateProjects !== undefined && typeof input.canCreateProjects !== "boolean") throw accountError("创建项目资格必须为布尔值。");
  const login = username(input.username);
  return { username: login, displayName: Object.hasOwn(input, "displayName") ? displayName(input.displayName) : login, password: password(input.password), role,
    departmentId: role === "admin" ? null : input.departmentId, canCreateProjects: role === "admin" ? false : input.canCreateProjects || false };
}

function departmentId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) throw accountError("请分配有效部门。");
  return value;
}

function validateAccountUpdate(input, { currentRole } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["displayName", "role", "status", "password", "departmentId", "canCreateProjects"].includes(key)))
    throw accountError("包含未知账号字段。");
  if (input.role !== undefined && !["admin", "member"].includes(input.role))
    throw accountError("账号角色无效。");
  if (input.status !== undefined && !["active", "disabled"].includes(input.status))
    throw accountError("账号状态无效。");
  if (input.password !== undefined) password(input.password);
  if (input.departmentId !== undefined && (input.role || currentRole) !== "admin") departmentId(input.departmentId);
  if (input.canCreateProjects !== undefined && typeof input.canCreateProjects !== "boolean") throw accountError("创建项目资格必须为布尔值。");
  return { ...input, ...(Object.hasOwn(input, "displayName") ? { displayName: displayName(input.displayName) } : {}) };
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
  displayName,
  validateAccountProfile,
  accountSettings,
  validateAccountCreation,
  validateAccountUpdate,
  validateAccountPreferences,
  DEFAULT_ACCOUNT_SETTINGS,
};
