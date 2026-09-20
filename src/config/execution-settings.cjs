const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { repositoryGit, resolveCommit } = require("../git/repository.cjs");
const { validateInitCommands } = require("../domain/init-commands.cjs");
const {
  memberDirectoryName,
  validateDirectoryName,
  resolveProjectDirectory,
} = require("../domain/member-project-paths.cjs");
const { readSystemSettings } = require("./system-settings.cjs");
const {
  assertWorktreeLocation,
  assertMemberWorktreeLocation,
  defaultWorktreeRoot,
} = require("./worktree-location.cjs");

const {
  readOptional,
  writeConfig,
  updateConfig,
} = require("../storage/json-files.cjs");
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
    codex.project_name = validateDirectoryName(codex.project_name);
    const dataDirectory = path.dirname(path.dirname(path.dirname(configFile)));
    codex.member_storage_root =
      readSystemSettings(dataDirectory).memberStorageRoot;
    codex.member_root = config.workspace.owner_user_id
      ? path.join(
          codex.member_storage_root,
          memberDirectoryName(config.workspace.owner_username),
        )
      : undefined;
    const memberRoot = codex.member_root || codex.member_storage_root;
    codex.worktree_root = resolveProjectDirectory(
      path.join(memberRoot, "worktree"),
      codex.project_name,
    );
    if (codex.member_root)
      assertMemberWorktreeLocation(
        codex.member_storage_root,
        memberRoot,
        codex.worktree_root,
      );
    else assertWorktreeLocation(codex.member_storage_root, codex.worktree_root);
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
  const repository = config.codex.repository
    ? path.resolve(path.dirname(configFile), config.codex.repository)
    : "";
  return {
    repository,
    worktreeRoot: path.resolve(
      path.dirname(configFile),
      config.codex.worktree_root,
    ),
    baseRef: config.codex.base_ref || "HEAD",
    initCommands: config.codex.init_commands,
    platform: process.platform,
    ...(config.workspace
      ? {
          projectName: config.codex.project_name,
          memberStorageRoot: config.codex.member_storage_root,
          memberRoot:
            config.codex.member_root || config.codex.member_storage_root,
          projectsRoot: repository ? path.dirname(repository) : "",
        }
      : {}),
  };
}
function saveSettings(input, configFile) {
  const config = readOptional(configFile);
  const allowedFields = config.workspace
    ? ["baseRef", "initCommands"]
    : ["repository", "baseRef", "initCommands", "worktreeRoot"];
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowedFields.includes(key))
  )
    throw new Error("仅允许修改基准引用和初始化命令。");
  const initCommands = validateInitCommands(
    input.initCommands ??
      (config.workspace
        ? (config.codex?.init_commands ?? [])
        : readSettings(configFile).initCommands),
  );
  const repository = config.workspace
    ? repositoryGit(config.codex?.repository).repository
    : repositoryGit(input.repository ?? readSettings(configFile).repository)
        .repository;
  const projectName = config.workspace
    ? validateDirectoryName(config.codex?.project_name)
    : undefined;
  const location = config.workspace
    ? executionConfig(
        { ...config, codex: { ...config.codex, project_name: projectName } },
        configFile,
      ).codex
    : null;
  const worktreeRoot =
    location?.worktree_root ??
    absolutePath(
      input.worktreeRoot ?? readSettings(configFile).worktreeRoot,
      "worktree 根目录",
    );
  const baseRef = input.baseRef?.trim() || "HEAD";
  if (baseRef.length > 200 || /[\r\n\0]/.test(baseRef))
    throw new Error("无效的基准引用。");
  resolveCommit(repository, baseRef);
  // Validate without creating a worktree or changing the selected Git branch.
  fs.mkdirSync(worktreeRoot, { recursive: true });
  if (location?.member_root)
    assertMemberWorktreeLocation(
      location.member_storage_root,
      location.member_root,
      worktreeRoot,
    );
  else if (location)
    assertWorktreeLocation(location.member_storage_root, worktreeRoot);
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
        base_ref: baseRef,
        init_commands:
          input.initCommands === undefined
            ? validateInitCommands(current.codex?.init_commands ?? [])
            : initCommands,
      };
      delete current.codex.repositories;
      delete current.codex.worktree_root;
      delete current.codex.member_storage_root;
      delete current.codex.member_root;
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
