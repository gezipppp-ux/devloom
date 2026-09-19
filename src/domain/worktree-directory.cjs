const path = require("node:path");
const { absolutePath } = require("../shared/paths.cjs");

function defaultWorktreeDirectory(workspaceId) {
  return `w-${workspaceId.slice(0, 8)}`;
}

function memberWorktreeDirectory(ownerId) {
  if (typeof ownerId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(ownerId))
    throw new Error("工作区所有者标识无效。");
  return "u-" + ownerId;
}

function normalizeWorktreeDirectory(value) {
  if (typeof value !== "string" || !value || value.length > 240)
    throw new Error("工作区 Worktree 目录必填，最多 240 个字符。");
  const directory = value.replaceAll("\\", "/");
  const segments = directory.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment !== segment.trim() ||
        /[. ]$/.test(segment) ||
        /[<>:"|?*\u0000-\u001f\u007f]/.test(segment) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment),
    )
  )
    throw new Error(
      "工作区 Worktree 目录必须是相对目录，例如 project-a 或 team/project-a；不能包含空目录、.、..、绝对路径、系统保留名称或非法字符。",
    );
  return directory;
}

function resolveWorktreeDirectory(base, directory, platform = process.platform) {
  const api = platform === "win32" ? path.win32 : path.posix;
  const root = absolutePath(base, "Worktree 基础目录", platform);
  const normalized = normalizeWorktreeDirectory(directory);
  const resolved = api.join(root, ...normalized.split("/"));
  const relative = api.relative(root, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${api.sep}`) ||
    api.isAbsolute(relative)
  )
    throw new Error("工作区 Worktree 目录必须位于系统基础目录内。");
  return resolved;
}

module.exports = { defaultWorktreeDirectory, memberWorktreeDirectory, normalizeWorktreeDirectory, resolveWorktreeDirectory };
