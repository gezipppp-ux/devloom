const path = require("node:path");
const { absolutePath } = require("../shared/paths.cjs");
const { username } = require("./account.cjs");
const { projectName } = require("./git-account.cjs");

function projectDirectoryName(remote, suffix = "") {
  const name = projectName(remote);
  if (!suffix) return name;
  if (!/^[a-f0-9]{8}(?:-\d{1,2})?$/.test(suffix)) throw new Error("项目目录后缀无效。");
  return validateDirectoryName(`${name.slice(0, 119 - suffix.length)}-${suffix}`);
}

function defaultProjectName(workspaceId) {
  return `w-${workspaceId.slice(0, 8)}`;
}

function memberDirectoryName(ownerUsername) {
  const name = username(ownerUsername);
  // '~' is excluded from account names, keeping encoded names collision-free.
  try {
    return validateDirectoryName(name);
  } catch {
    /* Valid usernames may still be reserved filesystem names. */
  }
  return `user~${Buffer.from(name, "utf8").toString("hex")}`;
}

function validateDirectoryName(value) {
  if (typeof value !== "string" || !value || value.length > 120)
    throw new Error("目录名称必填，最多 120 个字符。");
  if (
    value === "." ||
    value === ".." ||
    value !== value.trim() ||
    /[. ]$/.test(value) ||
    /[\\/<>:"|?*\u0000-\u001f\u007f]/.test(value) ||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value)
  )
    throw new Error("目录名称不能包含路径、系统保留名称或非法字符。");
  return value;
}

function resolveProjectDirectory(base, directory, platform = process.platform) {
  const api = platform === "win32" ? path.win32 : path.posix;
  const root = absolutePath(base, "成员目录基础路径", platform);
  const resolved = api.join(root, validateDirectoryName(directory));
  const relative = api.relative(root, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${api.sep}`) ||
    api.isAbsolute(relative)
  )
    throw new Error("项目目录必须位于成员目录内。");
  return resolved;
}

module.exports = {
  projectDirectoryName,
  defaultProjectName,
  memberDirectoryName,
  validateDirectoryName,
  resolveProjectDirectory,
};
