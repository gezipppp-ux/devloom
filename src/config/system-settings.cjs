const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { dataRoot } = require("./runtime.cjs");
const { defaultWorktreeRoot } = require("../git/worktrees.cjs");
const { absolutePath } = require("../shared/paths.cjs");
const { readOptional, updateConfig } = require("../storage/json-files.cjs");

function settingsFile(directory) {
  return path.join(directory, "system-settings.json");
}

function basePath(value) {
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(
      "Worktree 基础目录必须是服务端的绝对路径，且不能包含控制字符。",
    );
  const directory = absolutePath(value.trim(), "Worktree 基础目录");
  if (process.platform === "win32") {
    const relative = directory.slice(path.parse(directory).root.length);
    if (
      relative
        .split(/[\\/]/)
        .some(
          (part) =>
            /[<>:"|?*]/.test(part) ||
            /[. ]$/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
    )
      throw new Error("Worktree 基础目录包含 Windows 不支持的目录名称。");
  }
  return directory;
}

function readSystemSettings(directory = dataRoot) {
  const config = readOptional(settingsFile(directory));
  return {
    worktreeBasePath: basePath(
      config.worktreeBasePath ?? defaultWorktreeRoot(),
    ),
    platform: process.platform,
  };
}

function saveSystemSettings(input, directory = dataRoot) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "worktreeBasePath")
  )
    throw new Error("系统设置仅支持修改 Worktree 基础目录。");
  const selected = basePath(input.worktreeBasePath);
  fs.mkdirSync(selected, { recursive: true });
  const canonical = fs.realpathSync.native(selected);
  const probe = path.join(canonical, `.runner-write-probe-${randomUUID()}`);
  try {
    fs.writeFileSync(probe, "", { flag: "wx", mode: 0o600 });
  } catch {
    throw new Error("Worktree 基础目录不可写，请选择服务端有写入权限的目录。");
  } finally {
    if (fs.existsSync(probe)) fs.unlinkSync(probe);
  }
  updateConfig(settingsFile(directory), (current) => ({
    ...current,
    version: 1,
    worktreeBasePath: canonical,
  }));
  return readSystemSettings(directory);
}

module.exports = { readSystemSettings, saveSystemSettings };
