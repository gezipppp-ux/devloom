const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { dataRoot } = require("./runtime.cjs");
const { absolutePath } = require("../shared/paths.cjs");
const { readOptional, updateConfig } = require("../storage/json-files.cjs");

function settingsFile(directory) {
  return path.join(directory, "system-settings.json");
}

function basePath(value) {
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(
      "成员目录基础路径必须是服务端的绝对路径，且不能包含控制字符。",
    );
  const directory = absolutePath(value.trim(), "成员目录基础路径");
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
      throw new Error("成员目录基础路径包含 Windows 不支持的目录名称。");
  }
  return directory;
}

async function readSystemSettings(directory = dataRoot) {
  const config = (await readOptional(settingsFile(directory)));
  return {
    memberStorageRoot: basePath(
      config.memberStorageRoot ?? path.join(os.homedir(), ".web-coding-workspaces"),
    ),
    platform: process.platform,
  };
}

function prepareSystemSettings(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "memberStorageRoot")
  )
    throw new Error("系统设置仅支持修改成员目录基础路径。");
  const selected = basePath(input.memberStorageRoot);
  fs.mkdirSync(selected, { recursive: true });
  const canonical = fs.realpathSync.native(selected);
  const probe = path.join(canonical, `.runner-write-probe-${randomUUID()}`);
  try {
    fs.writeFileSync(probe, "", { flag: "wx", mode: 0o600 });
  } catch {
    throw new Error("成员目录基础路径不可写，请选择服务端有写入权限的目录。");
  } finally {
    if (fs.existsSync(probe)) fs.unlinkSync(probe);
  }
  return { memberStorageRoot: canonical };
}

async function savePreparedSystemSettings(prepared, directory = dataRoot) {
  (await updateConfig(settingsFile(directory), (current) => ({
    ...current,
    version: 1,
    memberStorageRoot: prepared.memberStorageRoot,
  })));
  return (await readSystemSettings(directory));
}

async function saveSystemSettings(input, directory = dataRoot) {
  return savePreparedSystemSettings(prepareSystemSettings(input), directory);
}

module.exports = { readSystemSettings, saveSystemSettings, prepareSystemSettings, savePreparedSystemSettings };
