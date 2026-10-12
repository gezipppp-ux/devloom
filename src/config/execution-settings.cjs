const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { repositoryGit } = require("../git/repository.cjs");
const { validateBaseBranch } = require("../domain/development-baseline.cjs");
const { validateInitCommands } = require("../domain/init-commands.cjs");
const { agentConfig, executionOptions } = require("../domain/agent-config.cjs");
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
async function executionConfig(config, configFile, { baseBranch } = {}) {
  const settings = config.workspace
    ? {}
    : (await readOptional(settingsPath(configFile)));
  const execution = executionOptions(config);
  if (settings.repository) execution.repository = settings.repository;
  if (config.workspace) {
    execution.projectName = validateDirectoryName(execution.projectName);
    const dataDirectory = path.dirname(path.dirname(path.dirname(configFile)));
    execution.memberStorageRoot =
      (await readSystemSettings(dataDirectory)).memberStorageRoot;
    execution.memberRoot = config.workspace.project_id && config.workspace.owner_user_id
      ? path.join(execution.memberStorageRoot, "projects", validateDirectoryName(config.workspace.project_id),
          "members", validateDirectoryName(config.workspace.owner_user_id))
      : config.workspace.owner_user_id
      ? path.join(
          execution.memberStorageRoot,
          memberDirectoryName(config.workspace.owner_username),
        )
      : undefined;
    const memberRoot = execution.memberRoot || execution.memberStorageRoot;
    // Project identity is already present in the stable member root. Repeating
    // a full UUID below it can exceed Git for Windows' worktree path limit.
    execution.worktreeRoot = config.workspace.project_id
      ? resolveProjectDirectory(memberRoot, "worktree")
      : resolveProjectDirectory(path.join(memberRoot, "worktree"), execution.projectName);
    if (execution.memberRoot)
      assertMemberWorktreeLocation(
        execution.memberStorageRoot,
        memberRoot,
        execution.worktreeRoot,
      );
    else assertWorktreeLocation(execution.memberStorageRoot, execution.worktreeRoot);
  } else {
    execution.worktreeRoot =
      settings.worktreeRoot || execution.worktreeRoot || defaultWorktreeRoot();
  }
  if (settings.baseBranch !== undefined) execution.baseBranch = settings.baseBranch;
  if (baseBranch !== undefined) execution.baseBranch = validateBaseBranch(baseBranch, { allowEmpty: true });
  execution.initCommands = validateInitCommands(
    settings.initCommands ?? execution.initCommands ?? [],
  );
  const agent = agentConfig(config);
  return { ...config, execution, agent };
}
async function readSettings(configFile) {
  const config = (await executionConfig((await readOptional(configFile)), configFile));
  const repository = config.execution.repository
    ? path.resolve(path.dirname(configFile), config.execution.repository)
    : "";
  return {
    repository,
    worktreeRoot: path.resolve(
      path.dirname(configFile),
      config.execution.worktreeRoot,
    ),
    baseBranch: config.execution.baseBranch || "",
    initCommands: config.execution.initCommands,
    platform: process.platform,
    ...(config.workspace
      ? {
          projectName: config.execution.projectName,
          memberStorageRoot: config.execution.memberStorageRoot,
          memberRoot:
            config.execution.memberRoot || config.execution.memberStorageRoot,
          projectsRoot: repository ? path.dirname(repository) : "",
        }
      : {}),
  };
}
async function saveSettings(input, configFile) {
  const config = (await readOptional(configFile));
  const execution = executionOptions(config);
  const allowedFields = config.workspace
    ? ["baseBranch", "initCommands"]
    : ["repository", "baseBranch", "initCommands", "worktreeRoot"];
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowedFields.includes(key))
  )
    throw new Error("仅允许修改开发基线分支和初始化命令。");
  const initCommands = validateInitCommands(
    input.initCommands ??
      (config.workspace
        ? (execution.initCommands ?? [])
        : (await readSettings(configFile)).initCommands),
  );
  const repository = config.workspace
    ? repositoryGit(execution.repository).repository
    : repositoryGit(input.repository ?? (await readSettings(configFile)).repository)
        .repository;
  const projectName = config.workspace
    ? validateDirectoryName(execution.projectName)
    : undefined;
  const location = config.workspace
    ? (await executionConfig(
        { ...config, execution: { ...execution, projectName } },
        configFile,
      )).execution
    : null;
  const worktreeRoot =
    location?.worktreeRoot ??
    absolutePath(
      input.worktreeRoot ?? (await readSettings(configFile)).worktreeRoot,
      "worktree 根目录",
    );
  const baseBranch = validateBaseBranch(input.baseBranch ?? (await readSettings(configFile)).baseBranch, { allowEmpty: true });
  // Validate without creating a worktree or changing the selected Git branch.
  fs.mkdirSync(worktreeRoot, { recursive: true });
  if (location?.memberRoot)
    assertMemberWorktreeLocation(
      location.memberStorageRoot,
      location.memberRoot,
      worktreeRoot,
    );
  else if (location)
    assertWorktreeLocation(location.memberStorageRoot, worktreeRoot);
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
    baseBranch,
    initCommands,
  };
  if (config.workspace) {
    (await updateConfig(file, (current) => {
      const nextInitCommands = input.initCommands === undefined
        ? validateInitCommands(executionOptions(current).initCommands ?? [])
        : initCommands;
      current.execution = {
        ...current.execution, baseBranch, initCommands: nextInitCommands,
      };
      delete current.execution.repositories;
      delete current.execution.worktreeRoot;
      delete current.execution.memberStorageRoot;
      delete current.execution.memberRoot;
      return current;
    }));
    return (await readSettings(file));
  }
  (await writeConfig(file, settings));
  return { ...settings, platform: process.platform };
}
module.exports = {
  executionConfig,
  readSettings,
  saveSettings,
};
