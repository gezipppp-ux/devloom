const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { configPath } = require("./config.cjs");
const { validateInitCommands } = require("./worktree_init.cjs");

function settingsPath(configFile = configPath()) {
  return path.join(path.dirname(configFile), "runner.local.json");
}
function readOptional(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}
function absolutePath(value, label, platform = process.platform) {
  const api = platform === "win32" ? path.win32 : path.posix;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    !api.isAbsolute(value) ||
    (platform !== "win32" && (/^[A-Za-z]:/.test(value) || value.includes("\\")))
  )
    throw new Error(`${label}必须是服务端的绝对路径。`);
  return api.normalize(value.trim());
}
function defaultWorktreeRoot() {
  return path.join(os.homedir(), ".codex-workspaces");
}
function executionConfig(config, configFile = configPath()) {
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
function readSettings(configFile = configPath()) {
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
function repositoryGit(value) {
  const repository = fs.realpathSync(absolutePath(value, "代码仓库"));
  const git = (args) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (
    !samePath(
      fs.realpathSync(git(["rev-parse", "--show-toplevel"])),
      repository,
    )
  )
    throw new Error("请选择 Git 仓库根目录。");
  return { repository, git };
}
function listBaseRefs(value) {
  const { git } = repositoryGit(value);
  const output = git([
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname)%00%(objecttype)%00%(*objecttype)%00%(symref)",
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ]);
  const refs = output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [ref, type, targetType, symbolic] = line.trim().split("\0");
      if (symbolic || (type !== "commit" && targetType !== "commit")) return [];
      const kind = ref.startsWith("refs/heads/")
        ? "local"
        : ref.startsWith("refs/remotes/")
          ? "remote"
          : "tag";
      const name = ref.replace(/^refs\/(heads|remotes|tags)\//, "");
      return [
        {
          value: ref,
          label: `${{ local: "本地分支", remote: "远程分支", tag: "标签" }[kind]} · ${name}`,
          kind,
          name,
        },
      ];
    });
  return [
    { value: "HEAD", label: "HEAD · 当前检出提交", kind: "head", name: "HEAD" },
    ...refs,
  ];
}
function saveSettings(input, configFile = configPath()) {
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
function writeConfig(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function samePath(a, b, platform = process.platform) {
  const api = platform === "win32" ? path.win32 : path.posix;
  return platform === "win32"
    ? api.resolve(a).toLowerCase() === api.resolve(b).toLowerCase()
    : api.resolve(a) === api.resolve(b);
}
module.exports = {
  writeConfig,
  absolutePath,
  defaultWorktreeRoot,
  executionConfig,
  readOptional,
  readSettings,
  listBaseRefs,
  saveSettings,
  samePath,
};
