const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { git } = require("./command.cjs");
const { createHash } = require("node:crypto");
const { runKey, sourceFor } = require("../domain/run-identity.cjs");
const { validateWorktreeName } = require("../domain/worktree-name.cjs");

function defaultWorktreeRoot() {
  return path.join(os.homedir(), ".codex-workspaces");
}

function worktreePlan(repository, item, baseRef = "HEAD", options = {}) {
  const source = options.source || sourceFor("tapd", item);
  const key = runKey(source);
  if (
    options.slug !== undefined &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug)
  )
    throw new Error("Invalid worktree title slug.");
  const name = options.slug
    ? `${source.channel}-${options.slug.slice(0, 64)}-${key.slice(-12)}`
    : `${source.channel === "tapd" ? "tapd-" : ""}${key}`;
  const namespace = options.workspaceId || "";
  if (namespace && !/^[a-f0-9-]{36}$/.test(namespace))
    throw new Error("Invalid application workspace ID.");
  const directoryName = validateWorktreeName(options.name ?? "") || name;
  const repositoryIdentity =
    process.platform === "win32"
      ? path.resolve(repository).toLowerCase()
      : path.resolve(repository);
  const repositoryKey = createHash("sha256")
    .update(repositoryIdentity)
    .digest("hex")
    .slice(0, 16);
  const commit = git(repository, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${baseRef}^{commit}`,
  ]);
  if (!/^[a-f\d]{40,64}$/i.test(commit))
    throw new Error("Git did not return a valid base commit.");
  return {
    repository,
    branch: `codex/${namespace ? `${namespace}/` : ""}${name}`,
    path: path.join(
      options.root || defaultWorktreeRoot(),
      repositoryKey,
      ...(namespace ? [namespace] : []),
      directoryName,
    ),
    base_commit: commit,
  };
}

function createWorktree(plan) {
  if (fs.existsSync(plan.path))
    throw new Error(
      `Worktree path already exists: ${plan.path}. Inspect the previous run before retrying.`,
    );
  let branchExists = false;
  try {
    git(plan.repository, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${plan.branch}`,
    ]);
    branchExists = true;
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (branchExists)
    throw new Error(
      `任务分支已存在：${plan.branch}。修改 worktree 根目录不会清除旧分支；请检查原工作区和运行记录，确认没有未保存工作后清理，再重新启动。`,
    );
  fs.mkdirSync(path.dirname(plan.path), { recursive: true });
  git(plan.repository, [
    "worktree",
    "add",
    "-b",
    plan.branch,
    plan.path,
    plan.base_commit,
  ]);
  return plan;
}

module.exports = { createWorktree, worktreePlan, defaultWorktreeRoot };
