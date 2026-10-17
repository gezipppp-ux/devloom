const fs = require("node:fs");
const path = require("node:path");
const { runWorktreeGit } = require("./worktree-command.cjs");
const { resolveCommit } = require("./repository.cjs");
const { createHash } = require("node:crypto");
const { runKey } = require("../domain/run-identity.cjs");
const { validateWorktreeName } = require("../domain/worktree-name.cjs");
const { assertWorktreeCheckoutPaths } = require("./worktree-checkout.cjs");
const { validateWorkspaceId } = require("../domain/workspace.cjs");
const { absolutePath } = require("../shared/paths.cjs");

function worktreePlan(repository, _item, baseRef = "HEAD", options = {}) {
  const root = absolutePath(options.root, "Worktree 根目录");
  const source = options.source;
  runKey(source);
  if (
    options.slug !== undefined &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug)
  )
    throw new Error("Invalid worktree title slug.");
  const namespace = options.workspaceId || "";
  if (namespace) validateWorkspaceId(namespace);
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
  const commit = resolveCommit(repository, baseRef);
  return {
    repository,
    branch: `codex/${taskId}`,
    path: path.join(
      root,
      `${prefix}-${taskId}`,
    ),
    base_commit: commit,
  };
}

async function createWorktree(plan, { signal, timeout = 60000, authorize = async () => {} } = {}) {
  const checkStopped = () => {
    if (signal?.aborted) throw new Error("任务准备已停止。");
  };
  checkStopped();
  let pathExists = false;
  try {
    await fs.promises.lstat(plan.path);
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
    await runWorktreeGit(plan.repository, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${plan.branch}`,
    ], { signal, timeout });
    branchExists = true;
  } catch (error) {
    if (error.code !== 1) throw error;
  }
  if (branchExists)
    throw new Error(
      `任务分支已存在：${plan.branch}。修改 worktree 根目录不会清除旧分支；请检查原工作区和运行记录，确认没有未保存工作后清理，再重新启动。`,
    );
  await assertWorktreeCheckoutPaths(plan, { signal, timeout });
  await authorize();
  checkStopped();
  await fs.promises.mkdir(path.dirname(plan.path), { recursive: true });
  await runWorktreeGit(plan.repository, [
    "worktree",
    "add",
    "-b",
    plan.branch,
    plan.path,
    plan.base_commit,
  ], { signal, timeout });
  return plan;
}

module.exports = { createWorktree, worktreePlan };
