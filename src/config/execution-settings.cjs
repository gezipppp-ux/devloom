const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { repositoryGit } = require("../git/repository.cjs");
const { defaultWorktreeRoot } = require("../git/worktrees.cjs");
const { validateInitCommands } = require("../domain/init-commands.cjs");

const { readOptional, writeConfig } = require("../storage/json-files.cjs");
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
  codex.worktree_root =
    settings.worktreeRoot || codex.worktree_root || defaultWorktreeRoot();
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
  };
}
function saveSettings(input, configFile) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        !["repository", "worktreeRoot", "baseRef", "initCommands"].includes(
          key,
        ),
    )
  )
    throw new Error("仅允许修改仓库、worktree 根目录、基准引用和初始化命令。");
  const config = readOptional(configFile);
  const initCommands = validateInitCommands(
    input.initCommands ?? readSettings(configFile).initCommands,
  );
  const { repository, git } = repositoryGit(input.repository);
  const worktreeRoot = absolutePath(input.worktreeRoot, "worktree 根目录");
  const baseRef = input.baseRef?.trim() || "HEAD";
  if (baseRef.length > 200 || /[\r\n\0]/.test(baseRef))
    throw new Error("无效的基准引用。");
  git(["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
  // Validate without creating a worktree or changing the selected Git branch.
  fs.mkdirSync(worktreeRoot, { recursive: true });
  const realRoot = fs.realpathSync(worktreeRoot);
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
    config.codex = {
      ...config.codex,
      repository,
      worktree_root: realRoot,
      base_ref: baseRef,
      init_commands: initCommands,
    };
    delete config.codex.repositories;
    delete config.codex.model;
    delete config.codex.reasoning_effort;
    writeConfig(file, config);
    return readSettings(file);
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
  return { ...settings, platform: process.platform };
}
module.exports = {
  executionConfig,
  readSettings,
  saveSettings,
};
