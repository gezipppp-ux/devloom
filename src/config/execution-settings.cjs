const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { repositoryGit, resolveCommit } = require("../git/repository.cjs");
const { validateInitCommands } = require("../domain/init-commands.cjs");
const {
  defaultWorktreeDirectory,
  memberWorktreeDirectory,
  normalizeWorktreeDirectory,
  resolveWorktreeDirectory,
} = require("../domain/worktree-directory.cjs");
const { readSystemSettings } = require("./system-settings.cjs");
const { assertWorktreeLocation, defaultWorktreeRoot } = require("./worktree-location.cjs");

const { readOptional, writeConfig, updateConfig } = require("../storage/json-files.cjs");
const { absolutePath, samePath } = require("../shared/paths.cjs");

function settingsPath(configFile) {
  return path.join(path.dirname(configFile), "runner.local.json");
}
function executionConfig(config, configFile) {
  const settings = config.workspace
    ? {}
    : readOptional(settingsPath(configFile));
  const codex = { ...config.codex };
  if (settings.repository) codex.repository = settings.repository;
  if (config.workspace) {
    codex.worktree_directory = normalizeWorktreeDirectory(
      codex.worktree_directory ?? defaultWorktreeDirectory(config.workspace.id),
    );
    const dataDirectory = path.dirname(path.dirname(path.dirname(configFile)));
    codex.worktree_base_path = readSystemSettings(dataDirectory).worktreeBasePath;
    const memberRoot = config.workspace.owner_user_id
      ? path.join(codex.worktree_base_path, memberWorktreeDirectory(config.workspace.owner_user_id))
      : codex.worktree_base_path;
    codex.worktree_root = resolveWorktreeDirectory(
      memberRoot,
      codex.worktree_directory,
    );
    assertWorktreeLocation(codex.worktree_base_path, codex.worktree_root);
  } else {
    codex.worktree_root =
      settings.worktreeRoot || codex.worktree_root || defaultWorktreeRoot();
  }
  if (settings.baseRef) codex.base_ref = settings.baseRef;
  codex.init_commands = validateInitCommands(
    settings.initCommands ?? codex.init_commands ?? [],
  );
  return { ...config, codex };
}
function readSettings(configFile) {
  const config = executionConfig(readOptional(configFile), configFile);
  return {
    repository: config.codex.repository
      ? path.resolve(path.dirname(configFile), config.codex.repository)
      : "",
    worktreeRoot: path.resolve(
      path.dirname(configFile),
      config.codex.worktree_root,
    ),
    baseRef: config.codex.base_ref || "HEAD",
    initCommands: config.codex.init_commands,
    platform: process.platform,
    ...(config.workspace
      ? {
          worktreeDirectory: config.codex.worktree_directory,
          worktreeBasePath: config.codex.worktree_base_path,
          worktreeMemberPath: config.workspace.owner_user_id
            ? path.join(config.codex.worktree_base_path, memberWorktreeDirectory(config.workspace.owner_user_id))
            : config.codex.worktree_base_path,
          worktreePathMode: "relative",
        }
      : {}),
  };
}
function saveSettings(input, configFile) {
  const config = readOptional(configFile);
  const allowedFields = [
    "repository",
    "baseRef",
    "initCommands",
    config.workspace ? "worktreeDirectory" : "worktreeRoot",
  ];
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowedFields.includes(key))
  )
    throw new Error("仅允许修改仓库、Worktree 目录、基准引用和初始化命令。");
  const initCommands = validateInitCommands(
    input.initCommands ??
      (config.workspace
        ? config.codex?.init_commands ?? []
        : readSettings(configFile).initCommands),
  );
  const { repository } = repositoryGit(input.repository);
  const worktreeDirectory = config.workspace
    ? normalizeWorktreeDirectory(input.worktreeDirectory)
    : undefined;
  const location = config.workspace
    ? executionConfig(
        { ...config, codex: { ...config.codex, worktree_directory: worktreeDirectory } },
        configFile,
      ).codex
    : null;
  const worktreeRoot = location?.worktree_root ??
    absolutePath(input.worktreeRoot, "worktree 根目录");
  const baseRef = input.baseRef?.trim() || "HEAD";
  if (baseRef.length > 200 || /[\r\n\0]/.test(baseRef))
    throw new Error("无效的基准引用。");
  resolveCommit(repository, baseRef);
  // Validate without creating a worktree or changing the selected Git branch.
  fs.mkdirSync(worktreeRoot, { recursive: true });
  if (location) assertWorktreeLocation(location.worktree_base_path, worktreeRoot);
  const realRoot = fs.realpathSync.native(worktreeRoot);
  if (samePath(realRoot, repository))
    throw new Error("worktree 根目录不能等于代码仓库根目录。");
  const probe = path.join(realRoot, `.runner-write-probe-${randomUUID()}`);
  try {
    fs.writeFileSync(probe, "", { flag: "wx", mode: 0o600 });
  } finally {
    if (fs.existsSync(probe)) fs.unlinkSync(probe);
  }
  const file = config.workspace ? configFile : settingsPath(configFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const settings = {
    repository,
    worktreeRoot: realRoot,
    baseRef,
    initCommands,
  };
  if (config.workspace) {
    updateConfig(file, (current) => {
      current.codex = {
        ...current.codex,
        repository,
        worktree_directory: worktreeDirectory,
        base_ref: baseRef,
        init_commands: input.initCommands === undefined
          ? validateInitCommands(current.codex?.init_commands ?? [])
          : initCommands,
      };
      delete current.codex.repositories;
      delete current.codex.worktree_root;
      delete current.codex.worktree_base_path;
      delete current.codex.model;
      delete current.codex.reasoning_effort;
      return current;
    });
    return readSettings(file);
  }
  writeConfig(file, settings);
  return { ...settings, platform: process.platform };
}
module.exports = {
  executionConfig,
  readSettings,
  saveSettings,
};
