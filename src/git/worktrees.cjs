const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { git } = require("./command.cjs");
const { createHash } = require("node:crypto");
const { runKey, sourceFor } = require("../domain/run-identity.cjs");
const { validateWorktreeName } = require("../domain/worktree-name.cjs");
const { assertWorktreeCheckoutPaths } = require("./worktree-checkout.cjs");

function defaultWorktreeRoot() {
  return path.join(os.homedir(), ".codex-workspaces");
}

function worktreePlan(repository, item, baseRef = "HEAD", options = {}) {
  const source = options.source || sourceFor("tapd", item);
  runKey(source);
  if (
    options.slug !== undefined &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug)
  )
    throw new Error("Invalid worktree title slug.");
  const namespace = options.workspaceId || "";
  if (namespace && !/^[a-f0-9-]{36}$/.test(namespace))
    throw new Error("Invalid application workspace ID.");
  const prefix =
    validateWorktreeName(options.name ?? "") ||
    (options.slug || source.channel).slice(0, 16).replace(/-+$/, "");
  const canonicalRepository = fs.realpathSync.native(path.resolve(repository));
  const repositoryIdentity =
    process.platform === "win32"
      ? canonicalRepository.toLowerCase()
      : canonicalRepository;
  const taskId = createHash("sha256")
    .update(JSON.stringify([
      repositoryIdentity,
      namespace,
      source.channel,
      source.scope,
      source.id,
    ]))
    .digest("hex")
    .slice(0, 12);
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
    branch: `codex/${taskId}`,
    path: path.join(
      options.root || defaultWorktreeRoot(),
      `${prefix}-${taskId}`,
    ),
    base_commit: commit,
  };
}

function createWorktree(plan) {
  let pathExists = false;
  try {
    fs.lstatSync(plan.path);
    pathExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (pathExists)
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
  assertWorktreeCheckoutPaths(plan);
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
